import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ImportParejasCdaResult, PersonaPropuestaCda, PropuestaParejasCda, RecintoHistorialCda } from '@cne/shared-types';

import { PropuestaParejasModal } from './PropuestaParejasModal';
import { api } from '../../lib/api';
import { sileo } from 'sileo';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const postMock = api.post as unknown as ReturnType<typeof vi.fn>;

const persona = (id: string, grupo: string, dispositivo: PersonaPropuestaCda['dispositivo'], yaFue = false): PersonaPropuestaCda => ({
  id,
  apellidosNombres: id,
  cedula: `ced-${id}`,
  grupo,
  dispositivo,
  yaFue,
});
const OP1 = persona('OP ANA', 'OPERADOR', 'IPHONE');
const OP2 = persona('OP LUIS', 'OPERADOR', 'ANDROID', true);
const AS1 = persona('AS JUAN', 'ASISTENTE', 'ANDROID');
const AS2 = persona('AS ROSA', 'ASISTENTE', 'IPHONE');

const RECINTOS: RecintoHistorialCda[] = [
  { id: 'r1', codigo: '971', nombre: 'UE Chaltura', canton: 'ANTONIO ANTE', visitas: [] },
  { id: 'r2', codigo: '1133', nombre: 'CECIB Manuel J. Calle', canton: 'COTACACHI', visitas: [] },
];

const PROPUESTA: PropuestaParejasCda = {
  fecha: '2026-11-10',
  referencia: ['2026-10-28'],
  filas: [
    { recinto: { id: 'r1', codigo: '971', nombre: 'UE Chaltura' }, operador: OP1, asistente: AS1, extra: false },
    { recinto: { id: 'r2', codigo: '1133', nombre: 'CECIB Manuel J. Calle' }, operador: null, asistente: null, extra: true },
  ],
  personas: [OP1, OP2, AS1, AS2],
};

const vistaPrevia = (guardado: boolean): ImportParejasCdaResult => ({
  fecha: '2026-11-10',
  guardado,
  guardadas: guardado ? 1 : 0,
  app: null,
  filas: [
    {
      fila: 1,
      operador: { cedula: 'ced-OP ANA', nombre: 'OP ANA', nuevo: false },
      asistente: { cedula: 'ced-AS JUAN', nombre: 'AS JUAN', nuevo: false },
      recinto: { id: 'r1', codigo: '971', nombre: 'UE Chaltura' },
      articulos: null,
      errores: [],
      avisos: [],
    },
  ],
});

function renderModal(onClose = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PropuestaParejasModal referencia={['2026-10-28']} recintos={RECINTOS} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

async function armar(fecha = '2026-11-10') {
  await userEvent.type(screen.getByLabelText('Fecha de la nueva prueba'), fecha);
  await userEvent.click(screen.getByRole('checkbox', { name: /1133/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Armar propuesta' }));
}

describe('Propuesta para una nueva prueba', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    postMock.mockImplementation((url: string) => {
      if (url === '/parejas-cda/historial/propuesta') return Promise.resolve({ data: PROPUESTA });
      if (url.includes('guardar=true')) return Promise.resolve({ data: vistaPrevia(true) });
      return Promise.resolve({ data: vistaPrevia(false) });
    });
  });

  it('no deja usar como fecha nueva una de referencia', async () => {
    renderModal();
    await userEvent.type(screen.getByLabelText('Fecha de la nueva prueba'), '2026-10-28');
    expect(screen.getByRole('alert')).toHaveTextContent('Elija una fecha distinta de las de referencia.');
    expect(screen.getByRole('button', { name: 'Armar propuesta' })).toBeDisabled();
  });

  it('pide la propuesta con la fecha, la referencia y los recintos marcados; muestra el aviso de Android y la fila vacía', async () => {
    renderModal();
    await armar();

    expect(postMock).toHaveBeenCalledWith('/parejas-cda/historial/propuesta', {
      fecha: '2026-11-10',
      referencia: ['2026-10-28'],
      extras: ['r2'],
    });
    const region = await screen.findByRole('region', { name: 'Propuesta editable' });
    const [fila1, fila2] = within(region).getAllByRole('row').slice(1);
    expect(within(fila1).getByRole('combobox', { name: /Operador de 971/ })).toHaveValue('OP ANA');
    expect(within(fila1).queryByText(/Ninguno tiene Android/)).not.toBeInTheDocument();
    expect(within(fila2).getByText('Pareja extra')).toBeInTheDocument();
    expect(within(fila2).getByRole('combobox', { name: /Operador de 1133/ })).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('1 sin operador');
  });

  it('al cambiar el asistente por uno sin Android, marca la pareja en rojo; quien ya está elegido no se ofrece dos veces', async () => {
    renderModal();
    await armar();
    const asistente = await screen.findByRole('combobox', { name: /Asistente de 971/ });
    await userEvent.selectOptions(asistente, 'AS ROSA');
    expect(screen.getByText('Ninguno tiene Android: la APK no se instala')).toHaveClass('ocda-estado', 'error');

    const operador2 = screen.getByRole('combobox', { name: /Operador de 1133/ });
    const opciones = within(operador2).getAllByRole('option').map((o) => o.textContent);
    expect(opciones).toEqual(['— Elija un operador —', 'OP LUIS — Android · ya fue']);
  });

  it('"+ Otra pareja" agrega una fila del mismo recinto y "Quitar" la saca', async () => {
    renderModal();
    await armar();
    await userEvent.click(await screen.findByRole('button', { name: 'Otra pareja para 971 · UE Chaltura' }));
    expect(screen.getAllByRole('combobox', { name: /Operador de 971/ })).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Quitar la fila 2 (971 · UE Chaltura)' }));
    expect(screen.getAllByRole('combobox', { name: /Operador de 971/ })).toHaveLength(1);
  });

  it('revisa con las reglas de la plantilla (cédulas y código) y después guarda', async () => {
    const onClose = renderModal();
    await armar();
    await userEvent.click(await screen.findByRole('button', { name: /Quitar la fila 2/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Revisar antes de guardar' }));

    const cuerpo = { filas: [{ cedulaOperador: 'ced-OP ANA', cedulaAsistente: 'ced-AS JUAN', codigoRecinto: '971' }], justificacion: undefined };
    expect(postMock).toHaveBeenCalledWith('/parejas-cda/propuesta/cargar?fecha=2026-11-10', cuerpo);
    expect(await screen.findByRole('region', { name: 'Vista previa de las parejas' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: /Pasar a la app/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar 1 pareja(s)' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(postMock).toHaveBeenCalledWith('/parejas-cda/propuesta/cargar?fecha=2026-11-10&guardar=true&app=false', cuerpo);
    expect(sileo.success).toHaveBeenCalledWith(expect.objectContaining({ title: '1 pareja(s) guardada(s) para el 2026-11-10' }));
  });

  it('guardar pasando a la app manda la justificación; si alguna fila falla, queda abierto y no se vuelve a guardar', async () => {
    const parcial: ImportParejasCdaResult = {
      ...vistaPrevia(true),
      filas: [...vistaPrevia(true).filas, { ...vistaPrevia(true).filas[0], fila: 2, errores: ['OP ANA ya tiene pareja el 2026-11-10'] }],
    };
    postMock.mockImplementation((url: string) => {
      if (url === '/parejas-cda/historial/propuesta') return Promise.resolve({ data: PROPUESTA });
      if (url.includes('guardar=true')) return Promise.resolve({ data: parcial });
      return Promise.resolve({ data: vistaPrevia(false) });
    });
    const onClose = renderModal();
    await armar();
    await userEvent.click(await screen.findByRole('button', { name: 'Revisar antes de guardar' }));
    await userEvent.type(await screen.findByLabelText(/Justificación/), 'cambio de último minuto');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar 1 pareja(s)' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        '/parejas-cda/propuesta/cargar?fecha=2026-11-10&guardar=true',
        expect.objectContaining({ justificacion: 'cambio de último minuto' }),
      ),
    );
    expect(await screen.findByText(/Se guardaron 1 pareja\(s\)/)).toBeInTheDocument();
    expect(sileo.warning).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Guardar/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeInTheDocument();
  });

  it('"Volver" desde la vista previa conserva lo editado y el foco va al título del paso', async () => {
    renderModal();
    await armar();
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: /Asistente de 971/ }), 'AS ROSA');
    await userEvent.click(screen.getByRole('button', { name: 'Revisar antes de guardar' }));
    await screen.findByRole('region', { name: 'Vista previa de las parejas' });
    await userEvent.click(screen.getByRole('button', { name: 'Volver' }));
    expect(screen.getByRole('combobox', { name: /Asistente de 971/ })).toHaveValue('AS ROSA');
    expect(screen.getByRole('heading', { name: /Paso 2 de 3/ })).toHaveFocus();
  });

  it('si la propuesta no se puede armar, muestra el error del servidor', async () => {
    postMock.mockRejectedValueOnce({ response: { data: { message: 'Uno de los recintos marcados no es un recinto CDA activo' } } });
    renderModal();
    await armar();
    expect(await screen.findByRole('alert')).toHaveTextContent('Uno de los recintos marcados no es un recinto CDA activo');
  });
});
