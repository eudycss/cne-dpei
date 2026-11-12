import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VERSION_AVISO_EVATICS } from '@cne/shared-validation';
import type { ConsultaEvaticsPublica } from '@cne/shared-types';

import { EvaticsPublicoPage, LADO_CERTIFICADO, BYTES_CERTIFICADO } from './EvaticsPublicoPage';
import { fechaLarga } from '../operadores-cda/utils';
import { api } from '../../lib/api';
import { reducirFoto } from '../foto-cda/reducirFoto';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../foto-cda/reducirFoto', async (original) => ({
  ...(await original<typeof import('../foto-cda/reducirFoto')>()),
  reducirFoto: vi.fn(),
}));

const postMock = api.post as unknown as ReturnType<typeof vi.fn>;
const reducirMock = reducirFoto as unknown as ReturnType<typeof vi.fn>;
const CEDULA = '1710034065';

const consulta = (c: Partial<ConsultaEvaticsPublica> = {}): ConsultaEvaticsPublica => ({
  nombreCorto: 'Lucía C.',
  cargo: 'OPERADOR CDA',
  estado: 'SIN_SUBIR',
  motivoRechazo: null,
  fechaLimite: '2026-11-20',
  plazoVencido: false,
  puedeSubir: true,
  ...c,
});

function abrir() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EvaticsPublicoPage />
    </QueryClientProvider>,
  );
}

async function entrar(datos = consulta(), user = userEvent.setup()) {
  postMock.mockResolvedValueOnce({ data: datos });
  abrir();
  await user.type(screen.getByLabelText('Número de cédula'), CEDULA);
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
  await screen.findByRole('heading', { name: `Hola, ${datos.nombreCorto}` });
  return user;
}

async function hastaVistaPrevia(user = userEvent.setup()) {
  await entrar(consulta(), user);
  reducirMock.mockResolvedValue(new Blob([new Uint8Array(400 * 1024)], { type: 'image/jpeg' }));
  await user.click(screen.getByRole('checkbox', { name: /Autorizo al CNE/ }));
  await user.upload(screen.getByTestId('galeria'), new File(['x'], 'cert.png', { type: 'image/png' }));
  await screen.findByRole('heading', { name: '¿Se lee su nombre?' });
  return user;
}

describe('EvaticsPublicoPage (subir el certificado con la cédula)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postMock.mockReset();
    reducirMock.mockReset();
    URL.createObjectURL = vi.fn(() => 'blob:cert');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    document.head.querySelectorAll('meta[name="referrer"], meta[name="robots"]').forEach((m) => m.remove());
  });

  it('consulta con la cédula en el cuerpo (no en la URL) y oculta la página a buscadores', async () => {
    await entrar();
    expect(postMock).toHaveBeenCalledWith('/publico/evatics/consultar', { cedula: CEDULA });
    expect(window.location.search).toBe('');
    expect(document.head.querySelector('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    expect(screen.getByText(`Hasta el ${fechaLarga('2026-11-20')}`)).toBeInTheDocument();
  });

  it('una cédula inválida no llega a la API y el error queda en el campo', async () => {
    const user = userEvent.setup();
    abrir();
    const campo = screen.getByLabelText('Número de cédula');
    await user.type(campo, '12ab34');
    expect(campo).toHaveValue('1234'); // solo dígitos
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(postMock).not.toHaveBeenCalled();
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect(campo).toHaveAccessibleDescription(/10 dígitos/);
    expect(campo).toHaveFocus();
  });

  it('cédula que no está en el personal: muestra el mensaje de la API', async () => {
    const user = userEvent.setup();
    postMock.mockRejectedValueOnce({ response: { status: 404, data: { message: 'Cédula no registrada en el personal' } } });
    abrir();
    await user.type(screen.getByLabelText('Número de cédula'), CEDULA);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cédula no registrada en el personal');
  });

  it('sin autorizar no se puede elegir la foto', async () => {
    await entrar();
    expect(screen.getByRole('button', { name: 'Tomar foto' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Elegir de la galería' })).toHaveAccessibleDescription(
      'Marque la autorización para continuar.',
    );
  });

  it('el aviso dice que la foto va a un servicio de IA (Gemini o Groq)', async () => {
    await entrar();
    expect(screen.getByText(/se envía a un servicio de inteligencia artificial/)).toBeInTheDocument();
    expect(screen.getByText(/Google Gemini o, si no responde, a Groq/)).toBeInTheDocument();
  });

  it('cámara trasera o galería; la foto se reduce con la resolución del certificado', async () => {
    await entrar();
    expect(screen.getByTestId('camara')).toHaveAttribute('capture', 'environment');
    expect(screen.getByTestId('galeria')).not.toHaveAttribute('capture');
    cleanup();
    await hastaVistaPrevia();
    expect(reducirMock).toHaveBeenCalledWith(expect.any(File), {
      ladoMaximo: LADO_CERTIFICADO,
      bytesObjetivo: BYTES_CERTIFICADO,
    });
    expect(screen.getByRole('img', { name: 'Vista previa del certificado' })).toHaveAttribute('src', 'blob:cert');
  });

  it('sube cédula, consentimiento, versión del aviso y la foto; luego confirma', async () => {
    const user = await hastaVistaPrevia();
    postMock.mockResolvedValueOnce({ data: { ok: true, estado: 'PENDIENTE', aviso: null } });
    await user.click(screen.getByRole('button', { name: 'Subir esta foto' }));
    await screen.findByRole('heading', { name: '¡Listo, certificado recibido!' });
    // También es lo que ve si la IA (Gemini o Groq) falló o no respondió: lo decide el supervisor.
    expect(screen.getByText(/Un supervisor revisará su imagen/)).toBeInTheDocument();

    const [url, fd] = postMock.mock.calls[1];
    expect(url).toBe('/publico/evatics/subir');
    expect((fd as FormData).get('cedula')).toBe(CEDULA);
    expect((fd as FormData).get('consentimiento')).toBe('true');
    expect((fd as FormData).get('version')).toBe(VERSION_AVISO_EVATICS);
    expect((fd as FormData).get('foto')).toBeInstanceOf(Blob);
  });

  it('si la IA avisa que no se lee, puede subir otra sin volver a escribir la cédula', async () => {
    const user = await hastaVistaPrevia();
    postMock.mockResolvedValueOnce({ data: { ok: true, estado: 'PENDIENTE', aviso: 'No se lee el nombre' } });
    await user.click(screen.getByRole('button', { name: 'Subir esta foto' }));
    await screen.findByRole('heading', { name: 'Foto recibida, pero revísela' });
    expect(screen.getByText('No se lee el nombre')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Subir otra foto' }));
    await screen.findByRole('heading', { name: 'Hola, Lucía C.' });
    expect(screen.getByText('En revisión')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tomar otra foto' })).toBeInTheDocument();
  });

  it('un error al subir se muestra y permite reintentar', async () => {
    const user = await hastaVistaPrevia();
    postMock.mockRejectedValueOnce({ response: { status: 429, data: { message: 'Ya se subieron 5 fotos hoy' } } });
    await user.click(screen.getByRole('button', { name: 'Subir esta foto' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya se subieron 5 fotos hoy');
    expect(screen.getByRole('button', { name: 'Subir esta foto' })).toBeEnabled();
  });

  it('rechazado: muestra el motivo para que corrija', async () => {
    await entrar(consulta({ estado: 'RECHAZADO', motivoRechazo: 'No se ve el nombre completo' }));
    expect(screen.getByText('No se ve el nombre completo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tomar otra foto' })).toBeInTheDocument();
  });

  it('aprobado o con el plazo vencido: no ofrece subir', async () => {
    await entrar(consulta({ estado: 'APROBADO', puedeSubir: false }));
    expect(screen.getByText(/Sus notas ya fueron recibidas/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tomar/ })).not.toBeInTheDocument();
  });

  it('plazo vencido sin aprobar: lo dice y no hay botones de foto', async () => {
    await entrar(consulta({ plazoVencido: true, puedeSubir: false }));
    expect(screen.getByText(/El plazo para subir el certificado terminó/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tomar/ })).not.toBeInTheDocument();
  });

  it('si sale mientras se prepara la foto, esa foto no aparece en la pantalla de otra persona', async () => {
    const user = await entrar();
    let terminar: (b: Blob) => void = () => {};
    reducirMock.mockReturnValue(new Promise<Blob>((r) => (terminar = r)));
    await user.click(screen.getByRole('checkbox', { name: /Autorizo al CNE/ }));
    await user.upload(screen.getByTestId('galeria'), new File(['x'], 'cert.png', { type: 'image/png' }));
    expect(screen.getByRole('status')).toHaveTextContent('Preparando la foto…');
    await user.click(screen.getByRole('button', { name: 'Escribir otra cédula' }));
    terminar(new Blob(['x'], { type: 'image/jpeg' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByLabelText('Número de cédula')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '¿Se lee su nombre?' })).not.toBeInTheDocument();
  });

  it('si la foto no se puede abrir, el foco va al error', async () => {
    const user = await entrar();
    reducirMock.mockRejectedValueOnce(new Error('No se pudo abrir la foto.'));
    await user.click(screen.getByRole('checkbox', { name: /Autorizo al CNE/ }));
    await user.upload(screen.getByTestId('galeria'), new File(['x'], 'cert.png', { type: 'image/png' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('No se pudo abrir la foto.');
    expect(alerta).toHaveFocus();
  });

  it('"Elegir otra" libera la vista previa anterior', async () => {
    const user = await hastaVistaPrevia();
    await user.click(screen.getByRole('button', { name: 'Elegir otra' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cert');
  });

  it('el aviso dice hasta cuándo se guarda y que la bitácora no lleva cédula ni foto', async () => {
    await entrar();
    expect(screen.getByText(/se eliminan 90 días después de la fecha límite/)).toHaveTextContent(
      /si no hay fecha límite, 90 días después de subirla/,
    );
    expect(screen.getByText(/sin su cédula ni su foto/)).toBeInTheDocument();
  });

  it('"Escribir otra cédula" vuelve al inicio sin datos de la persona', async () => {
    const user = await entrar();
    await user.click(screen.getByRole('button', { name: 'Escribir otra cédula' }));
    expect(screen.getByLabelText('Número de cédula')).toHaveValue('');
    expect(screen.queryByText('Lucía C.')).not.toBeInTheDocument();
  });
});
