import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OperadorCda } from '@cne/shared-types';

import { CarnetsQrModal } from './CarnetsQrModal';
import { api } from '../../lib/api';
import { guardarArchivo } from '../../lib/queries/custodia';
import { sileo } from 'sileo';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../lib/queries/custodia', () => ({ guardarArchivo: vi.fn() }));
vi.mock('sileo', () => ({ sileo: { error: vi.fn(), success: vi.fn() } }));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const postMock = api.post as unknown as ReturnType<typeof vi.fn>;
const deleteMock = (api as unknown as { delete: ReturnType<typeof vi.fn> }).delete;

const op = (id: string, apellidosNombres: string): OperadorCda => ({
  id,
  numero: null,
  apellidosNombres,
  cedula: '1710034065',
  telefono: null,
  cargo: 'OPERADOR CDA',
  unidad: null,
  fechaInicio: null,
  tieneFoto: false,
  activo: true,
  creadoEn: '2026-10-20T10:00:00Z',
});
const ANA = op('a', 'ANDRADE ANA');
const LUIS = op('l', 'VEGA LUIS');

function renderModal() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CarnetsQrModal operadores={[ANA, LUIS]} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('CarnetsQrModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Luis ya tiene carnet.
    getMock.mockResolvedValue({ data: [{ operadorId: 'l', emitidaEn: '2026-10-20T15:00:00Z' }] });
    postMock.mockResolvedValue({ data: new Blob(['%PDF']) });
  });

  it('por defecto elige a quienes no tienen carnet y genera su PDF', async () => {
    renderModal();
    expect(await screen.findByText('Carnet del 20/10/2026')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'ANDRADE ANA' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'VEGA LUIS' })).not.toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: 'Generar 1 carnet' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/operadores-cda/credenciales/carnets.pdf', { operadorIds: ['a'] }, {
        responseType: 'blob',
      }),
    );
    expect(guardarArchivo).toHaveBeenCalledWith(expect.any(Blob), expect.stringMatching(/^carnets_cda_\d{4}-\d{2}-\d{2}\.pdf$/));
  });

  it('avisa que reimprimir anula el carnet anterior', async () => {
    renderModal();
    await screen.findByText('Carnet del 20/10/2026');
    expect(screen.queryByText(/deja de funcionar/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Elegir todos' }));
    expect(screen.getByText(/1 persona elegida ya tiene carnet/)).toHaveTextContent(
      '1 persona elegida ya tiene carnet: al generar, su carnet anterior deja de funcionar.',
    );
    // Generar con Luis elegido pide confirmar: sin aceptar, no se emite nada.
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    await userEvent.click(screen.getByRole('button', { name: 'Generar 2 carnets' }));
    expect(confirmar).toHaveBeenCalledWith(expect.stringContaining('1 persona ya tiene carnet'));
    expect(postMock).not.toHaveBeenCalled();
    confirmar.mockRestore();

    await userEvent.click(screen.getByRole('button', { name: 'Ninguno' }));
    expect(screen.getByRole('button', { name: 'Generar 0 carnets' })).toBeDisabled();
  });

  it('anular pide confirmación', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    deleteMock.mockResolvedValueOnce({});
    renderModal();
    const anular = await screen.findByRole('button', { name: 'Anular carnet de VEGA LUIS' });

    await userEvent.click(anular);
    expect(deleteMock).not.toHaveBeenCalled();

    await userEvent.click(anular);
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('/operadores-cda/l/credencial'));
    expect(sileo.success).toHaveBeenCalledWith({ title: 'Carnet anulado', description: 'VEGA LUIS' });
    confirmar.mockRestore();
  });
});
