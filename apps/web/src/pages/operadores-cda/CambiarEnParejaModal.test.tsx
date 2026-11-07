import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CampoParejaCda, ParejaCdaFila, PersonaParejaCda } from '@cne/shared-types';

import { CambiarEnParejaModal } from './CambiarEnParejaModal';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const patchMock = api.patch as unknown as ReturnType<typeof vi.fn>;
const postMock = api.post as unknown as ReturnType<typeof vi.fn>;

const persona = (id: string, nombre: string, grupo: 'OPERADOR' | 'ASISTENTE'): PersonaParejaCda => ({
  id,
  apellidosNombres: nombre,
  cedula: `ced-${id}`,
  telefono: null,
  dispositivo: 'ANDROID',
  grupo,
});
const OP1 = persona('op1', 'PÉREZ ANA', 'OPERADOR');
const OP2 = persona('op2', 'LEÓN LUIS', 'OPERADOR');
const AS1 = persona('as1', 'DÍAZ JUMINE', 'ASISTENTE');
const AS2 = persona('as2', 'VENEGAS ANGÉLICA', 'ASISTENTE');

const fila = (over: Partial<ParejaCdaFila> = {}): ParejaCdaFila => ({
  portador: OP1,
  id: 'p1',
  fecha: '2026-11-15',
  recinto: { id: 'r1', codigo: '1126', nombre: 'UE CHALTURA' },
  operador: OP1,
  asistente: AS1,
  kitCodigo: null,
  estado: 'PENDIENTE_EVENTO',
  parejasEnRecinto: 1,
  articulos: null,
  kitSalio: false,
  quienLleva: null,
  ...over,
});

const RESULTADO = { enApp: 0, kitsCreados: 0, sinKit: 0, errores: [] };

function montar(campo: CampoParejaCda, parejas: ParejaCdaFila[] = [fila()]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onResultado = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <CambiarEnParejaModal dia="2026-11-15" pareja={parejas[0]} campo={campo} parejas={parejas} onResultado={onResultado} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  return { onResultado };
}

describe('CambiarEnParejaModal: qué pasa con quien sale', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockResolvedValue({ data: { operadores: [OP2], asistentes: [AS2], recintos: [] } });
    patchMock.mockResolvedValue({ data: RESULTADO });
    postMock.mockResolvedValue({ data: RESULTADO });
  });

  it('al cambiar el asistente pregunta por quien sale, con "Pasa a reserva" marcado, y lo envía', async () => {
    const user = userEvent.setup();
    montar('ASISTENTE');
    await screen.findByRole('option', { name: /VENEGAS ANGÉLICA/ });
    // Sin elegir a nadie nuevo no se pregunta nada.
    expect(screen.queryByRole('group', { name: /Qué pasa con/ })).toBeNull();

    await user.selectOptions(screen.getByLabelText('Nuevo asistente'), 'as2');
    expect(screen.getByRole('group', { name: '¿Qué pasa con DÍAZ JUMINE?' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Pasa a reserva' })).toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('DÍAZ JUMINE pasa a Reserva');

    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(patchMock).toHaveBeenCalledWith('/parejas-cda/p1', { asistenteCdaId: 'as2', saleAReserva: true });
  });

  it('"Queda libre" envía saleAReserva: false y lo dice en el resumen', async () => {
    const user = userEvent.setup();
    montar('OPERADOR');
    await screen.findByRole('option', { name: /LEÓN LUIS/ });
    await user.selectOptions(screen.getByLabelText('Nuevo operador'), 'op2');
    await user.click(screen.getByRole('radio', { name: 'Queda libre' }));
    expect(screen.getByRole('status')).toHaveTextContent('PÉREZ ANA queda libre');

    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(patchMock).toHaveBeenCalledWith('/parejas-cda/p1', { operadorCdaId: 'op2', saleAReserva: false });
  });

  it('dejar la pareja "Sin asistente" también pregunta por quien sale', async () => {
    const user = userEvent.setup();
    montar('ASISTENTE');
    await screen.findByRole('option', { name: /VENEGAS ANGÉLICA/ });
    await user.selectOptions(screen.getByLabelText('Nuevo asistente'), '');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(patchMock).toHaveBeenCalledWith('/parejas-cda/p1', { asistenteCdaId: null, saleAReserva: true });
  });

  it('en un intercambio nadie sale: no pregunta y no envía saleAReserva', async () => {
    const user = userEvent.setup();
    const otra = fila({ id: 'p2', recinto: { id: 'r2', codigo: '1359', nombre: 'UE OTRA' }, operador: OP2, asistente: AS2, portador: OP2 });
    montar('ASISTENTE', [fila(), otra]);
    await screen.findByRole('option', { name: /VENEGAS ANGÉLICA/ });
    await user.selectOptions(screen.getByLabelText('Nuevo asistente'), 'as2');
    expect(screen.queryByRole('group', { name: /Qué pasa con/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Intercambiar' }));
    expect(postMock).toHaveBeenCalledWith('/parejas-cda/p1/intercambiar', { conId: 'p2', campo: 'ASISTENTE' });
    expect(patchMock).not.toHaveBeenCalled();
  });
});
