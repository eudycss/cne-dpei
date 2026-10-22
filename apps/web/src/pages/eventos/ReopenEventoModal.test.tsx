import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EventoElectoral } from '@cne/shared-types';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { roles: ['ADMINISTRADOR'] } }),
}));
vi.mock('../../lib/queries/tipos-evento', () => ({
  getTiposEvento: vi.fn().mockResolvedValue({ data: [] }),
}));

import { api } from '../../lib/api';
import { EventosPage, ReopenEventoModal } from './EventosPage';

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const postMock = api.post as unknown as ReturnType<typeof vi.fn>;

function evento(over: Partial<EventoElectoral> = {}): EventoElectoral {
  return {
    id: 'ev1',
    nombre: 'Elecciones 16 odc',
    tipo: 'SECCIONALES',
    fechaJornada: '2026-10-16',
    descripcion: null,
    estado: 'CERRADO',
    creadoEn: '2026-10-01T10:00:00.000Z',
    cerradoEn: '2026-10-17T04:03:13.000Z',
    reabiertoEn: null,
    ...over,
  };
}

function conQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('ReopenEventoModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postMock.mockResolvedValue({ data: {} });
  });

  it('envía la justificación recortada y avisa al terminar', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    conQuery(<ReopenEventoModal evento={evento()} onClose={vi.fn()} onDone={onDone} />);

    expect(screen.getByRole('dialog', { name: 'Reabrir evento' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Justificación (requerida)'), '  Sacar informe de custodia ');
    await user.click(screen.getByRole('button', { name: 'Reabrir' }));

    expect(postMock).toHaveBeenCalledWith('/eventos/ev1/reopen', {
      justificacion: 'Sacar informe de custodia',
    });
    expect(onDone).toHaveBeenCalled();
  });

  it('con una justificación corta avisa y no envía', async () => {
    const user = userEvent.setup();
    conQuery(<ReopenEventoModal evento={evento()} onClose={vi.fn()} onDone={vi.fn()} />);

    await user.type(screen.getByLabelText('Justificación (requerida)'), 'dato');
    await user.click(screen.getByRole('button', { name: 'Reabrir' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/al menos 10 caracteres/);
    expect(screen.getByLabelText('Justificación (requerida)')).toHaveAttribute('aria-invalid', 'true');
    expect(postMock).not.toHaveBeenCalled();
  });

  it('se cierra con Escape sin enviar', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    conQuery(<ReopenEventoModal evento={evento()} onClose={onClose} onDone={vi.fn()} />);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('si el servidor responde varios mensajes los muestra como texto', async () => {
    postMock.mockRejectedValueOnce({ response: { data: { message: ['Campo inválido', 'Otro error'] } } });
    const user = userEvent.setup();
    conQuery(<ReopenEventoModal evento={evento()} onClose={vi.fn()} onDone={vi.fn()} />);

    await user.type(screen.getByLabelText('Justificación (requerida)'), 'Sacar informe de custodia');
    await user.click(screen.getByRole('button', { name: 'Reabrir' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Campo inválido Otro error');
  });

  it('si ya hay otro evento activo muestra el mensaje del servidor', async () => {
    postMock.mockRejectedValueOnce({
      response: { data: { message: 'Ya existe un evento activo: "Otro"' } },
    });
    const user = userEvent.setup();
    const onDone = vi.fn();
    conQuery(<ReopenEventoModal evento={evento()} onClose={vi.fn()} onDone={onDone} />);

    await user.type(screen.getByLabelText('Justificación (requerida)'), 'Sacar informe de custodia');
    await user.click(screen.getByRole('button', { name: 'Reabrir' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ya existe un evento activo');
    expect(screen.getByRole('button', { name: 'Reabrir' })).toBeEnabled();
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('EventosPage — reabrir', () => {
  beforeEach(() => vi.clearAllMocks());

  it('muestra "Reabrir" solo en eventos cerrados y marca el reabierto', async () => {
    getMock.mockResolvedValue({
      data: [
        evento(),
        evento({
          id: 'ev2',
          nombre: 'Elecciones seccionales',
          estado: 'ACTIVO',
          cerradoEn: null,
          reabiertoEn: '2026-10-22T13:00:00.000Z',
        }),
      ],
    });
    conQuery(<EventosPage />);

    expect(
      await screen.findByRole('button', { name: 'Reabrir el evento Elecciones 16 odc para consulta' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Reabrir el evento/ })).toHaveLength(1);
    expect(screen.getByText('Reabierto (solo consulta)')).toBeInTheDocument();
  });
});
