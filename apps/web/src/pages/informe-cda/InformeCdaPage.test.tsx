import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EstadoFotoInformeCda, VisitaInformeCdaPublica } from '@cne/shared-types';

import { InformeCdaPage } from './InformeCdaPage';
import { api } from '../../lib/api';
import { reducirFoto } from '../foto-cda/reducirFoto';
import { guardarArchivo } from '../../lib/queries/custodia';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../foto-cda/reducirFoto', async (original) => ({
  ...(await original<typeof import('../foto-cda/reducirFoto')>()),
  reducirFoto: vi.fn(),
}));
vi.mock('../../lib/queries/custodia', async (original) => ({
  ...(await original<typeof import('../../lib/queries/custodia')>()),
  guardarArchivo: vi.fn(),
}));

const postMock = api.post as unknown as ReturnType<typeof vi.fn>;
const reducirMock = reducirFoto as unknown as ReturnType<typeof vi.fn>;

const TOKEN = 't'.repeat(43);
const fotos = (cargadas: number[], deAntes: number[] = []): EstadoFotoInformeCda[] =>
  [1, 2, 3, 4, 5, 6].map((p) => ({ posicion: p, cargada: cargadas.includes(p), deEstaVisita: cargadas.includes(p) && !deAntes.includes(p) }));

function visita(f: EstadoFotoInformeCda[] = fotos([])): VisitaInformeCdaPublica {
  return { token: TOKEN, expiraEn: '2026-11-26T20:00:00Z', nombreCorto: 'Lizeth A.', cedula: '1050xxxx12', cargo: 'OPERADOR CDA', tieneInforme: true, fotos: f };
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <InformeCdaPage />
    </QueryClientProvider>,
  );
}

async function entrar(user: ReturnType<typeof userEvent.setup>, v = visita()) {
  postMock.mockResolvedValueOnce({ data: v });
  renderPage();
  await user.type(screen.getByLabelText('Número de cédula'), '1003199443');
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
  await screen.findByRole('heading', { name: 'Hola, Lizeth A.' });
}

describe('InformeCdaPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reducirMock.mockResolvedValue(new Blob(['jpg'], { type: 'image/jpeg' }));
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:vista');
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it('pide la cédula con validación y la manda en el cuerpo, no en la URL', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Número de cédula'), '123');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(postMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Número de cédula')).toHaveAttribute('aria-invalid', 'true');

    postMock.mockResolvedValueOnce({ data: visita() });
    await user.clear(screen.getByLabelText('Número de cédula'));
    await user.type(screen.getByLabelText('Número de cédula'), '1003199443');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await screen.findByRole('heading', { name: 'Hola, Lizeth A.' });
    expect(postMock).toHaveBeenCalledWith('/publico/informe-cda/consultar', { cedula: '1003199443' });
  });

  it('no deja subir sin la autorización; con ella sube, muestra la vista previa y permite reemplazar', async () => {
    const user = userEvent.setup();
    await entrar(user);
    const input = document.getElementById('icda-foto-2') as HTMLInputElement;
    expect(input).toBeDisabled();

    await user.click(screen.getByRole('checkbox'));
    postMock.mockResolvedValueOnce({ data: { fotos: fotos([2]) } });
    await user.upload(input, new File(['x'], 'foto.jpg', { type: 'image/jpeg' }));

    const casilla = (await screen.findByRole('button', { name: 'Ver la foto 2 en grande' })).closest('li')!;
    expect(within(casilla).getByText('Cargada ✓')).toBeInTheDocument();
    expect(within(casilla).getByText('Reemplazar')).toBeInTheDocument();
    expect(screen.getByLabelText(/de 6 fotos/)).toHaveValue(1);

    const [url, fd] = postMock.mock.calls[1];
    expect(url).toBe('/publico/informe-cda/foto');
    expect((fd as FormData).get('posicion')).toBe('2');
    expect((fd as FormData).get('token')).toBe(TOKEN);
    expect(reducirMock).toHaveBeenCalledWith(expect.any(File), { ladoMaximo: 1600, bytesObjetivo: 600 * 1024 });
  });

  it('las fotos de otra visita salen como cargadas sin imagen y bloquean la descarga aquí', async () => {
    const user = userEvent.setup();
    await entrar(user, visita(fotos([1, 2, 3, 4, 5, 6], [4])));

    expect(screen.getByText('Cargada antes ✓ (no se muestra por seguridad)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ver la foto/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Las fotos 4 se subieron en otra visita/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generar informe' })).toBeDisabled();
  });

  it('con las 6 fotos de esta visita genera y descarga el informe', async () => {
    const user = userEvent.setup();
    await entrar(user, visita(fotos([1, 2, 3, 4, 5, 6])));
    const blob = new Blob(['docx']);
    postMock.mockResolvedValueOnce({ data: blob });

    await user.click(screen.getByRole('button', { name: 'Generar informe' }));

    await waitFor(() => expect(guardarArchivo).toHaveBeenCalledWith(blob, 'informe_productos.docx'));
    expect(postMock).toHaveBeenLastCalledWith('/publico/informe-cda/generar', { token: TOKEN }, { responseType: 'blob' });
  });

  it('al reemplazar libera la vista previa anterior; un error de la API se muestra en la casilla', async () => {
    const user = userEvent.setup();
    (URL.createObjectURL as ReturnType<typeof vi.fn>).mockReturnValueOnce('blob:a').mockReturnValueOnce('blob:b');
    await entrar(user);
    await user.click(screen.getByRole('checkbox'));
    const input = document.getElementById('icda-foto-3') as HTMLInputElement;
    postMock.mockResolvedValue({ data: { fotos: fotos([3]) } });
    await user.upload(input, new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
    await user.upload(input, new File(['y'], 'b.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:a'));

    postMock.mockRejectedValueOnce({
      response: { status: 429, data: { message: 'Se ingresó muchas veces con esta cédula. Espere 15 minutos e intente de nuevo.' } },
    });
    await user.upload(document.getElementById('icda-foto-5') as HTMLInputElement, new File(['z'], 'c.jpg', { type: 'image/jpeg' }));
    expect(await screen.findByText(/Espere 15 minutos/, { selector: '.icda-estado' })).toBeInTheDocument();
  });

  it('si la visita venció, pide volver a ingresar', async () => {
    const user = userEvent.setup();
    await entrar(user);
    await user.click(screen.getByRole('checkbox'));
    postMock.mockRejectedValueOnce({ response: { status: 410, data: { message: 'La visita venció' } } });
    await user.upload(document.getElementById('icda-foto-1') as HTMLInputElement, new File(['x'], 'f.jpg', { type: 'image/jpeg' }));

    expect(await screen.findByRole('heading', { name: 'La visita venció' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Volver a ingresar' }));
    expect(screen.getByLabelText('Número de cédula')).toBeInTheDocument();
  });
});
