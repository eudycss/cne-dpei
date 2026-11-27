import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FilaInformeCustodia } from '@cne/shared-types';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'yo', roles: ['ASISTENTE_TRANSVERSAL'] } }) }));
vi.mock('xlsx', () => ({
  utils: { aoa_to_sheet: vi.fn(() => ({})), book_new: vi.fn(() => ({})), book_append_sheet: vi.fn() },
  writeFile: vi.fn(),
}));
vi.mock('../../lib/queries/custodia', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/queries/custodia')>();
  return { ...real, guardarArchivo: vi.fn() };
});

import * as XLSX from 'xlsx';
import { api } from '../../lib/api';
import { guardarArchivo } from '../../lib/queries/custodia';
import { CadenaCustodiaPage } from './CadenaCustodiaPage';

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const postMock = api.post as unknown as ReturnType<typeof vi.fn>;

function fila(o: Partial<FilaInformeCustodia> = {}): FilaInformeCustodia {
  return {
    kitId: 'k1',
    codigoUnico: 'ABCD2345',
    recintoId: 'r1',
    recintoCodigo: '28',
    recintoNombre: 'Escuela Central',
    cantonId: 30,
    cantonNombre: 'IBARRA',
    operadorNombre: 'Pérez Ana',
    operadorCedula: '1002003004',
    militarActa: { nombre: 'Paz Juan', cedula: '1004005006', grado: 'CBOP' },
    entrega: {
      militarNombre: 'Paz Juan',
      militarCedula: '1004005006',
      entregadoEn: '2026-11-16T11:00:00.000Z',
      entregadoPorNombre: 'Leal Jairo',
      militarDeOtroRecinto: true,
    },
    recepcion: { confirmadoEn: '2026-11-16T13:00:00.000Z', tieneFoto: true },
    devolucion: {
      confirmadoEn: '2026-11-16T23:00:00.000Z',
      verificadoPorNombre: 'Leal Jairo',
      completo: false,
      observaciones: 'Falta cargador',
    },
    correcciones: 1,
    ...o,
  };
}

const filas = [
  fila(),
  fila({
    kitId: 'k2',
    codigoUnico: 'WXYZ6789',
    recintoId: 'r2',
    recintoCodigo: '35',
    recintoNombre: 'Colegio Otavalo',
    cantonId: 35,
    cantonNombre: 'OTAVALO',
    operadorNombre: 'Ruiz Carla',
    militarActa: { nombre: 'Herrera Indacochea Victor Hugo', cedula: '1204989931', grado: 'SGOS' },
    entrega: null,
    recepcion: null,
    devolucion: null,
    correcciones: 0,
  }),
];

const RESPONSABLES = [
  { id: 'yo', nombre: 'Sebastian Cabascango', cedula: '1' },
  { id: 'jl', nombre: 'Jairo Leal Aviles', cedula: '2' },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CadenaCustodiaPage />
    </QueryClientProvider>,
  );
}

describe('CadenaCustodiaPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockImplementation((url: string) =>
      url === '/custodia/informe'
        ? Promise.resolve({ data: filas })
        : url === '/custodia/responsables-acta'
          ? Promise.resolve({ data: RESPONSABLES })
          : Promise.resolve({ data: new Blob(['%PDF']) }),
    );
    postMock.mockResolvedValue({ data: new Blob(['PK']) });
  });

  it('muestra cada kit con sus tres etapas, pendientes y avisos', async () => {
    renderPage();
    const tabla = await screen.findByRole('table');
    const [, kit1, kit2] = within(tabla).getAllByRole('row');

    expect(within(kit1).getByRole('rowheader')).toHaveTextContent('ABCD2345');
    expect(kit1).toHaveTextContent('1 corrección');
    expect(kit1).toHaveTextContent('Paz Juan · registró Leal Jairo');
    expect(kit1).toHaveTextContent('Militar de otro recinto');
    expect(kit1).toHaveTextContent('Contenido incompleto');
    expect(within(kit2).getAllByText('✗ Pendiente')).toHaveLength(3);
    expect(screen.getByText(/Entregados al militar:/).parentElement).toHaveTextContent('1');
  });

  it('filtra por cantón y por estado de la cadena', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('ABCD2345');

    await user.selectOptions(screen.getByLabelText('Cantón'), '35');
    expect(screen.queryByText('ABCD2345')).not.toBeInTheDocument();
    expect(screen.getByText('WXYZ6789')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Cantón'), '');
    // ABCD2345 tiene las tres etapas; WXYZ6789 ninguna.
    await user.selectOptions(screen.getByLabelText('Estado'), 'PENDIENTES');
    expect(screen.queryByText('ABCD2345')).not.toBeInTheDocument();
    expect(screen.getByText('WXYZ6789')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Estado'), 'COMPLETOS');
    expect(screen.getByText('ABCD2345')).toBeInTheDocument();
    expect(screen.queryByText('WXYZ6789')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Cantón'), '35');
    expect(screen.getByText('No hay kits para los filtros elegidos.')).toBeInTheDocument();
  });

  it('descarga el acta de un kit y todas las actas con los filtros elegidos', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('ABCD2345');

    await user.click(screen.getByRole('button', { name: 'Descargar acta del kit ABCD2345' }));
    await waitFor(() => expect(guardarArchivo).toHaveBeenCalledWith(expect.any(Blob), 'acta_ABCD2345.pdf'));
    expect(getMock).toHaveBeenCalledWith('/custodia/kits/k1/acta', { responseType: 'blob' });

    await user.selectOptions(screen.getByLabelText('Cantón'), '30');
    await user.click(screen.getByRole('button', { name: 'Actas PDF' }));
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith('/custodia/actas', { params: { cantonId: '30' }, responseType: 'blob' }),
    );
  });

  it('acta militar de un kit: por defecto PDF, Ing. Jairo Leal y 28/11/2026, todo editable', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('ABCD2345');

    await user.click(screen.getByRole('button', { name: 'Acta del militar (PDF o Word) del kit ABCD2345' }));
    const dialogo = screen.getByRole('dialog', { name: 'Acta militar del kit ABCD2345' });
    const responsable = await within(dialogo).findByRole('combobox', { name: 'Responsable (Asistente Transversal)' });
    await waitFor(() => expect(responsable).toHaveValue('jl'));
    expect(within(dialogo).getByRole('option', { name: 'Ing. Jairo Leal Aviles' })).toBeInTheDocument();
    expect(within(dialogo).getByLabelText('Fecha del acta')).toHaveValue('2026-11-28');
    expect(within(dialogo).getByRole('radio', { name: 'PDF' })).toBeChecked();

    await user.click(within(dialogo).getByRole('button', { name: 'Descargar PDF' }));
    await waitFor(() => expect(guardarArchivo).toHaveBeenCalledWith(expect.any(Blob), 'acta_militar_ABCD2345.pdf'));
    expect(getMock).toHaveBeenCalledWith('/custodia/kits/k1/acta-militar', {
      params: { formato: 'pdf', responsableId: 'jl', fecha: '2026-11-28' },
      responseType: 'blob',
    });

    // Otro Asistente Transversal, otra fecha y en Word.
    await user.selectOptions(responsable, 'yo');
    fireEvent.change(within(dialogo).getByLabelText('Fecha del acta'), { target: { value: '2026-11-29' } });
    await user.click(within(dialogo).getByRole('radio', { name: 'Word' }));
    await user.click(within(dialogo).getByRole('button', { name: 'Descargar Word' }));
    await waitFor(() => expect(guardarArchivo).toHaveBeenLastCalledWith(expect.any(Blob), 'acta_militar_ABCD2345.docx'));
    expect(getMock).toHaveBeenLastCalledWith('/custodia/kits/k1/acta-militar', {
      params: { formato: 'docx', responsableId: 'yo', fecha: '2026-11-29' },
      responseType: 'blob',
    });
  });

  it('actas militares de los kits marcados en un solo PDF; sin marcar, las de la tabla', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('ABCD2345');

    await user.click(screen.getByRole('checkbox', { name: 'Elegir el kit WXYZ6789 para las actas militares' }));
    await user.click(screen.getByRole('button', { name: 'Actas militares (1 elegidas)' }));
    let dialogo = screen.getByRole('dialog', { name: 'Acta militar del kit WXYZ6789' });
    await user.click(within(dialogo).getAllByRole('button', { name: 'Cerrar' })[0]);

    // "Elegir todos" marca los de la tabla; vuelto a pulsar, los desmarca.
    const todos = screen.getByRole('checkbox', { name: 'Elegir todos los kits de la tabla para las actas militares' });
    await user.click(todos);
    expect(screen.getByRole('checkbox', { name: 'Elegir el kit ABCD2345 para las actas militares' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Actas militares (2 elegidas)' }));
    dialogo = screen.getByRole('dialog', { name: 'Actas militares (2 kits)' });
    await waitFor(() => expect(within(dialogo).getByRole('combobox', { name: /Responsable/ })).toHaveValue('jl'));
    await user.click(within(dialogo).getByRole('button', { name: 'Descargar PDF' }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        '/custodia/actas-militares/seleccion',
        { kitIds: ['k1', 'k2'], formato: 'pdf', responsableId: 'jl', fecha: '2026-11-28' },
        { responseType: 'blob' },
      ),
    );
    expect(guardarArchivo).toHaveBeenLastCalledWith(expect.any(Blob), 'actas_militares.pdf');
    await user.click(within(dialogo).getAllByRole('button', { name: 'Cerrar' })[0]);

    await user.click(todos);
    await user.selectOptions(screen.getByLabelText('Cantón'), '30');
    await user.selectOptions(screen.getByLabelText('Recinto'), '');
    await user.click(screen.getByRole('button', { name: 'Actas militares' }));
    dialogo = screen.getByRole('dialog', { name: 'Acta militar del kit ABCD2345' });
    await waitFor(() => expect(within(dialogo).getByRole('combobox', { name: /Responsable/ })).toHaveValue('jl'));
    await user.click(within(dialogo).getByRole('radio', { name: 'Word' }));
    await user.click(within(dialogo).getByRole('button', { name: 'Descargar Word' }));
    await waitFor(() => expect(guardarArchivo).toHaveBeenLastCalledWith(expect.any(Blob), 'acta_militar_ABCD2345.docx'));
  });

  it('busca por código o nombre del recinto, operador CDA o militar (sin tildes) y descarga solo esas actas', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('ABCD2345');
    // El militar del cronograma se ve aunque el kit aún no se entregue.
    expect(screen.getByText('Militar: SGOS. Herrera Indacochea Victor Hugo')).toBeInTheDocument();

    const buscar = screen.getByLabelText('Buscar');
    for (const texto of ['35', 'colegio otavalo', 'ruiz', 'indacochea', '1204989931', 'otavalo']) {
      await user.clear(buscar);
      await user.type(buscar, texto);
      expect(screen.queryByText('ABCD2345')).not.toBeInTheDocument();
      expect(screen.getByText('WXYZ6789')).toBeInTheDocument();
    }
    await user.clear(buscar);
    await user.type(buscar, 'perez');
    expect(screen.getByText('ABCD2345')).toBeInTheDocument();
    expect(screen.queryByText('WXYZ6789')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Actas militares' }));
    const dialogo = screen.getByRole('dialog', { name: 'Acta militar del kit ABCD2345' });
    await waitFor(() => expect(within(dialogo).getByRole('combobox', { name: /Responsable/ })).toHaveValue('jl'));
    await user.click(within(dialogo).getByRole('button', { name: 'Descargar PDF' }));
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith('/custodia/kits/k1/acta-militar', expect.objectContaining({ responseType: 'blob' })),
    );
    await user.click(within(dialogo).getAllByRole('button', { name: 'Cerrar' })[0]);

    // Sin resultados: no hay actas que descargar.
    await user.type(buscar, 'zzz');
    expect(screen.getByText('No hay kits para los filtros elegidos.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actas militares' })).toBeDisabled();
  });

  it('con más de 200 kits en la tabla pide filtrar antes de descargar las actas militares', async () => {
    const muchas = Array.from({ length: 201 }, (_, i) => fila({ kitId: `k${i}`, codigoUnico: `K${i}` }));
    getMock.mockImplementation((url: string) =>
      url === '/custodia/informe' ? Promise.resolve({ data: muchas }) : Promise.resolve({ data: new Blob(['%PDF']) }),
    );
    renderPage();
    await screen.findByText('K0');
    expect(screen.getByRole('button', { name: 'Actas militares' })).toBeDisabled();
    expect(screen.getByText('Son 201 kits: marque o filtre 200 o menos para descargar las actas militares.')).toBeInTheDocument();
  });

  it('exporta a Excel solo las filas visibles', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('ABCD2345');
    await user.selectOptions(screen.getByLabelText('Cantón'), '30');
    await user.click(screen.getByRole('button', { name: 'Excel' }));

    const filasExcel = (XLSX.utils.aoa_to_sheet as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown[][];
    expect(filasExcel.slice(3)).toHaveLength(1);
    expect(filasExcel[3][0]).toBe('ABCD2345');
    expect(XLSX.writeFile).toHaveBeenCalledWith(expect.anything(), 'cadena_custodia_kits.xlsx');
  });

  it('distingue "no hay evento activo" (404) de un error de conexión', async () => {
    getMock.mockRejectedValueOnce({ response: { status: 404 } });
    const { unmount } = renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('No hay un evento electoral activo.');
    unmount();

    getMock.mockRejectedValueOnce(new Error('Network Error'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Revisa la conexión');
  });

  it('si el servidor rechaza las actas (p. ej. demasiadas), muestra su mensaje', async () => {
    const { sileo } = await import('sileo');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('ABCD2345');
    getMock.mockRejectedValueOnce({
      response: { data: new Blob([JSON.stringify({ message: 'Son 120 actas; filtra por cantón' })]) },
    });
    await user.click(screen.getByRole('button', { name: 'Actas PDF' }));
    await waitFor(() => expect(sileo.error).toHaveBeenCalledWith({ title: 'Son 120 actas; filtra por cantón' }));
  });
});
