import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { FotoCdaPage } from './FotoCdaPage';
import { api } from '../../lib/api';
import { reducirFoto } from './reducirFoto';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('./reducirFoto', async (original) => ({
  ...(await original<typeof import('./reducirFoto')>()),
  reducirFoto: vi.fn(),
}));

const postMock = api.post as unknown as ReturnType<typeof vi.fn>;
const reducirMock = reducirFoto as unknown as ReturnType<typeof vi.fn>;
const TOKEN = 'x'.repeat(43);

const ACTIVO = {
  estado: 'ACTIVO',
  apellidosNombres: 'CHÁVEZ MORA LUCÍA ESTEFANÍA',
  cedula: '1050xxxx12',
  telefono: '0968 xxx 444',
  cargo: 'OPERADOR CDA',
  expiraEn: '2026-10-24T19:00:00.000Z',
};

function abrir(hash = `#${TOKEN}`) {
  window.history.replaceState(null, '', `/foto-cda${hash}`);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FotoCdaPage />
    </QueryClientProvider>,
  );
}

/** Abre el enlace activo, autoriza y elige una foto de la galería. */
async function hastaVistaPrevia(user = userEvent.setup()) {
  postMock.mockResolvedValueOnce({ data: ACTIVO });
  reducirMock.mockResolvedValue(new Blob([new Uint8Array(150 * 1024)], { type: 'image/jpeg' }));
  abrir();
  await screen.findByRole('heading', { name: 'Hola, Lucía' });
  await user.click(screen.getByRole('checkbox', { name: /Autorizo al CNE/ }));
  await user.upload(screen.getByTestId('galeria'), new File(['x'], 'foto.heic', { type: 'image/heic' }));
  await screen.findByRole('heading', { name: '¿Se ve bien?' });
  return user;
}

describe('FotoCdaPage (enlace público de foto)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postMock.mockReset();
    reducirMock.mockReset();
    URL.createObjectURL = vi.fn(() => 'blob:foto');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    document.head.querySelectorAll('meta[name="referrer"], meta[name="robots"]').forEach((m) => m.remove());
  });

  it('consulta el enlace enviando el token en el cuerpo (no en la URL) y oculta la página a buscadores', async () => {
    postMock.mockResolvedValueOnce({ data: ACTIVO });
    abrir();
    await screen.findByRole('heading', { name: 'Hola, Lucía' });
    expect(postMock).toHaveBeenCalledWith('/publico/foto-cda/consultar', { token: TOKEN });
    expect(document.head.querySelector('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  });

  it('M1: datos enmascarados y no deja continuar sin autorizar (LOPDP)', async () => {
    postMock.mockResolvedValueOnce({ data: ACTIVO });
    abrir();
    expect(await screen.findByRole('heading', { name: 'Hola, Lucía' })).toHaveFocus();
    expect(screen.getByText('1050xxxx12')).toBeInTheDocument();
    expect(screen.getByText('0968 xxx 444')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Paso 1 de 3' })).toBeInTheDocument();

    const tomar = screen.getByRole('button', { name: 'Tomar foto' });
    expect(tomar).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Elegir de la galería' })).toBeDisabled();
    expect(screen.getByText('Marque la autorización para continuar.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: /Autorizo al CNE/ }));
    expect(tomar).toBeEnabled();
    expect(screen.getByTestId('camara')).toHaveAttribute('capture', 'user');
  });

  it('M2 → M3: reduce la foto, la sube con el token y muestra la credencial', async () => {
    const user = await hastaVistaPrevia();
    expect(screen.getByText('150 KB · JPG')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Vista previa de su foto' })).toHaveAttribute('src', 'blob:foto');

    postMock.mockResolvedValueOnce({ data: { ok: true } });
    await user.click(screen.getByRole('button', { name: 'Usar esta foto' }));

    expect(await screen.findByRole('heading', { name: '¡Listo, foto registrada!' })).toHaveFocus();
    const [ruta, fd] = postMock.mock.calls[1];
    expect(ruta).toBe('/publico/foto-cda/subir');
    expect((fd as FormData).get('token')).toBe(TOKEN);
    expect((fd as FormData).get('consentimiento')).toBe('true');
    expect((fd as FormData).get('version')).toBe('LOPDP-2026-10');
    expect((fd as FormData).get('foto')).toBeInstanceOf(Blob);
    expect(screen.getByText('C.I. 1050xxxx12')).toBeInTheDocument();
    expect(window.location.hash).toBe(''); // el token ya no queda en la barra de direcciones
  });

  it('"Tomar otra" vuelve a la primera pantalla', async () => {
    const user = await hastaVistaPrevia();
    await user.click(screen.getByRole('button', { name: 'Tomar otra' }));
    expect(await screen.findByRole('heading', { name: 'Hola, Lucía' })).toBeInTheDocument();
  });

  it('si la API rechaza la foto, muestra el motivo y deja intentarlo de nuevo', async () => {
    const user = await hastaVistaPrevia();
    postMock.mockRejectedValueOnce({ response: { status: 400, data: { message: 'La foto debe ser una imagen JPG válida' } } });
    await user.click(screen.getByRole('button', { name: 'Usar esta foto' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La foto debe ser una imagen JPG válida');
    expect(screen.getByRole('button', { name: 'Usar esta foto' })).toBeEnabled();
  });

  it('si el enlace se gastó mientras tanto (410), muestra M4', async () => {
    const user = await hastaVistaPrevia();
    postMock.mockRejectedValueOnce({ response: { status: 410, data: { message: 'inactivo' } } });
    await user.click(screen.getByRole('button', { name: 'Usar esta foto' }));
    expect(await screen.findByRole('heading', { name: 'Este enlace ya no está activo' })).toBeInTheDocument();
  });

  it('si la foto no se puede abrir, lo dice y sigue en M1', async () => {
    postMock.mockResolvedValueOnce({ data: ACTIVO });
    reducirMock.mockRejectedValue(new Error('No se pudo abrir la foto.'));
    abrir();
    await screen.findByRole('heading', { name: 'Hola, Lucía' });
    await userEvent.click(screen.getByRole('checkbox', { name: /Autorizo al CNE/ }));
    await userEvent.upload(screen.getByTestId('galeria'), new File(['x'], 'x.jpg', { type: 'image/jpeg' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo abrir la foto.');
    expect(screen.getByRole('button', { name: 'Tomar foto' })).toBeEnabled();
  });

  it('M4 si el enlace está inactivo, sin mostrar datos', async () => {
    postMock.mockResolvedValueOnce({ data: { estado: 'INACTIVO' } });
    abrir();
    expect(await screen.findByRole('heading', { name: 'Este enlace ya no está activo' })).toBeInTheDocument();
    expect(screen.queryByText(/CHÁVEZ/)).not.toBeInTheDocument();
  });

  it('M4 sin llamar a la API si el enlace está mal copiado', async () => {
    abrir('#cortado');
    expect(await screen.findByRole('heading', { name: 'Este enlace ya no está activo' })).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });
});
