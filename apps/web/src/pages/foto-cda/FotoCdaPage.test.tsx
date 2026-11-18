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

describe('FotoCdaPage (enlace único: la persona escribe su cédula)', () => {
  const POR_CEDULA = { nombreCorto: 'Lucía C.', cedula: '1050xxxx12', cargo: 'OPERADOR CDA', tieneFoto: false };
  // Cédula ecuatoriana válida (dígito verificador correcto).
  const CEDULA = '1710034065';

  beforeEach(() => {
    vi.clearAllMocks();
    postMock.mockReset();
    reducirMock.mockReset();
    URL.createObjectURL = vi.fn(() => 'blob:foto');
    URL.revokeObjectURL = vi.fn();
  });

  async function escribirCedula(user = userEvent.setup(), cedula = CEDULA) {
    abrir('');
    expect(await screen.findByRole('heading', { name: 'Registro de foto' })).toHaveFocus();
    await user.type(screen.getByLabelText('Número de cédula'), cedula);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    return user;
  }

  it('sin token pide la cédula y no llama a la API si es inválida', async () => {
    await escribirCedula(userEvent.setup(), '1234567890');
    expect(await screen.findByText('Cédula ecuatoriana inválida')).toBeInTheDocument();
    expect(screen.getByLabelText('Número de cédula')).toHaveAttribute('aria-invalid', 'true');
    expect(postMock).not.toHaveBeenCalled();
  });

  it('consulta la cédula en el cuerpo y muestra solo el nombre corto, sin teléfono ni vencimiento', async () => {
    postMock.mockResolvedValueOnce({ data: POR_CEDULA });
    await escribirCedula();
    expect(await screen.findByRole('heading', { name: 'Hola, Lucía' })).toBeInTheDocument();
    expect(postMock).toHaveBeenCalledWith('/publico/foto-cda/cedula/consultar', { cedula: CEDULA });
    expect(screen.getByText('Lucía C.')).toBeInTheDocument();
    expect(screen.getByText('1050xxxx12')).toBeInTheDocument();
    expect(screen.queryByText('Teléfono')).not.toBeInTheDocument();
    expect(screen.queryByText(/Enlace personal/)).not.toBeInTheDocument();
  });

  it('sube la foto con la cédula y el consentimiento', async () => {
    postMock.mockResolvedValueOnce({ data: POR_CEDULA });
    reducirMock.mockResolvedValue(new Blob([new Uint8Array(150 * 1024)], { type: 'image/jpeg' }));
    const user = await escribirCedula();
    await screen.findByRole('heading', { name: 'Hola, Lucía' });
    await user.click(screen.getByRole('checkbox', { name: /Autorizo al CNE/ }));
    await user.upload(screen.getByTestId('galeria'), new File(['x'], 'foto.jpg', { type: 'image/jpeg' }));
    await screen.findByRole('heading', { name: '¿Se ve bien?' });

    postMock.mockResolvedValueOnce({ data: { ok: true } });
    await user.click(screen.getByRole('button', { name: 'Usar esta foto' }));
    expect(await screen.findByRole('heading', { name: '¡Listo, foto registrada!' })).toBeInTheDocument();
    const [ruta, fd] = postMock.mock.calls[1];
    expect(ruta).toBe('/publico/foto-cda/cedula/subir');
    expect((fd as FormData).get('cedula')).toBe(CEDULA);
    expect((fd as FormData).get('consentimiento')).toBe('true');
    expect((fd as FormData).get('version')).toBe('LOPDP-2026-10');
    expect((fd as FormData).get('token')).toBeNull();
  });

  /** Sube la primera foto por cédula y llega a "¡Listo!" con un enlace de cambio. */
  async function hastaRegistrada() {
    postMock.mockResolvedValueOnce({ data: POR_CEDULA });
    reducirMock.mockResolvedValue(new Blob([new Uint8Array(10)], { type: 'image/jpeg' }));
    const user = await escribirCedula();
    await screen.findByRole('heading', { name: 'Hola, Lucía' });
    await user.click(screen.getByRole('checkbox', { name: /Autorizo al CNE/ }));
    await user.upload(screen.getByTestId('galeria'), new File(['x'], 'foto.jpg', { type: 'image/jpeg' }));
    await screen.findByRole('heading', { name: '¿Se ve bien?' });
    postMock.mockResolvedValueOnce({ data: { ok: true, cambio: { token: CAMBIO, expiraEn: '2026-11-18T01:30:00.000Z' } } });
    await user.click(screen.getByRole('button', { name: 'Usar esta foto' }));
    await screen.findByRole('heading', { name: '¡Listo, foto registrada!' });
    return user;
  }
  const CAMBIO = 'c'.repeat(43);

  it('tras subir puede cambiar la foto: usa el enlace de cambio, no la cédula', async () => {
    const user = await hastaRegistrada();
    expect(screen.getByText(/Puede cambiarla desde este celular hasta las 20:30/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cambiar foto' }));
    await screen.findByRole('heading', { name: 'Hola, Lucía' });
    expect(screen.queryByRole('button', { name: 'No soy yo: cambiar cédula' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /Autorizo al CNE/ }));
    await user.upload(screen.getByTestId('galeria'), new File(['y'], 'otra.jpg', { type: 'image/jpeg' }));
    await screen.findByRole('heading', { name: '¿Se ve bien?' });
    postMock.mockResolvedValueOnce({ data: { ok: true, cambio: { token: 'd'.repeat(43), expiraEn: '2026-11-18T01:40:00.000Z' } } });
    await user.click(screen.getByRole('button', { name: 'Usar esta foto' }));
    await screen.findByRole('heading', { name: '¡Listo, foto registrada!' });
    const [ruta, fd] = postMock.mock.calls[2];
    expect(ruta).toBe('/publico/foto-cda/subir');
    expect((fd as FormData).get('token')).toBe(CAMBIO);
    expect((fd as FormData).get('cedula')).toBeNull();
    expect(screen.getByText(/hasta las 20:40/)).toBeInTheDocument();
  });

  it('si los 30 min ya pasaron (410), dice que el tiempo terminó', async () => {
    const user = await hastaRegistrada();
    await user.click(screen.getByRole('button', { name: 'Cambiar foto' }));
    await user.click(await screen.findByRole('checkbox', { name: /Autorizo al CNE/ }));
    await user.upload(screen.getByTestId('galeria'), new File(['y'], 'otra.jpg', { type: 'image/jpeg' }));
    await screen.findByRole('heading', { name: '¿Se ve bien?' });
    postMock.mockRejectedValueOnce({ response: { status: 410, data: { message: 'inactivo' } } });
    await user.click(screen.getByRole('button', { name: 'Usar esta foto' }));
    expect(await screen.findByRole('heading', { name: 'El tiempo para cambiar la foto terminó' })).toBeInTheDocument();
  });

  it('si ya tiene foto, puede subir una nueva que queda en revisión (sin "Cambiar foto")', async () => {
    postMock.mockResolvedValueOnce({ data: { ...POR_CEDULA, tieneFoto: true } });
    reducirMock.mockResolvedValue(new Blob([new Uint8Array(10)], { type: 'image/jpeg' }));
    const user = await escribirCedula();
    expect(await screen.findByRole('heading', { name: 'Usted ya tiene una foto registrada' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tomar foto' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Subir una foto nueva' }));
    await screen.findByRole('heading', { name: 'Hola, Lucía' });
    await user.click(screen.getByRole('checkbox', { name: /Autorizo al CNE/ }));
    await user.upload(screen.getByTestId('galeria'), new File(['x'], 'foto.jpg', { type: 'image/jpeg' }));
    await screen.findByRole('heading', { name: '¿Se ve bien?' });
    postMock.mockResolvedValueOnce({ data: { ok: true, cambio: null, pendiente: true } });
    await user.click(screen.getByRole('button', { name: 'Usar esta foto' }));

    expect(await screen.findByRole('heading', { name: 'Foto enviada' })).toBeInTheDocument();
    expect(screen.getByText(/La Delegación revisará su foto nueva/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cambiar foto' })).not.toBeInTheDocument();
    expect(postMock.mock.calls[1][0]).toBe('/publico/foto-cda/cedula/subir');
  });

  it('si otra subida ganó mientras tanto (409), muestra el aviso y deja reintentar', async () => {
    postMock.mockResolvedValueOnce({ data: POR_CEDULA });
    reducirMock.mockResolvedValue(new Blob([new Uint8Array(10)], { type: 'image/jpeg' }));
    const user = await escribirCedula();
    await screen.findByRole('heading', { name: 'Hola, Lucía' });
    await user.click(screen.getByRole('checkbox', { name: /Autorizo al CNE/ }));
    await user.upload(screen.getByTestId('galeria'), new File(['x'], 'foto.jpg', { type: 'image/jpeg' }));
    await screen.findByRole('heading', { name: '¿Se ve bien?' });
    postMock.mockRejectedValueOnce({ response: { status: 409, data: { message: 'Su foto se actualizó mientras subía' } } });
    await user.click(screen.getByRole('button', { name: 'Usar esta foto' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Su foto se actualizó mientras subía');
    expect(screen.getByRole('button', { name: 'Usar esta foto' })).toBeEnabled();
  });

  it('cédula no registrada: muestra el mensaje de la API y deja corregirla', async () => {
    postMock.mockRejectedValueOnce({
      response: { status: 404, data: { message: 'Cédula no registrada en el personal CDA ni CPE' } },
    });
    await escribirCedula();
    expect(await screen.findByRole('alert')).toHaveTextContent('Cédula no registrada en el personal CDA ni CPE');
    expect(screen.getByLabelText('Número de cédula')).toBeEnabled();
  });

  it('demasiados intentos (429): mensaje en español', async () => {
    postMock.mockRejectedValueOnce({ response: { status: 429, data: { message: 'ThrottlerException: Too Many Requests' } } });
    await escribirCedula();
    expect(await screen.findByRole('alert')).toHaveTextContent('Demasiados intentos. Espere un minuto');
  });

  it('"No soy yo" vuelve a pedir la cédula', async () => {
    postMock.mockResolvedValueOnce({ data: POR_CEDULA });
    const user = await escribirCedula();
    await screen.findByRole('heading', { name: 'Hola, Lucía' });
    await user.click(screen.getByRole('button', { name: 'No soy yo: cambiar cédula' }));
    expect(await screen.findByRole('heading', { name: 'Registro de foto' })).toBeInTheDocument();
  });
});
