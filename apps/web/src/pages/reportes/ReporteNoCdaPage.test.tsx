import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReporteFlujoItem, ReporteNoCdaItem } from '@cne/shared-types';

import { ReporteNoCdaPage } from './ReporteNoCdaPage';
import { api } from '../../lib/api';

let rolesUsuario = ['ADMINISTRADOR'];
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { roles: rolesUsuario } }),
}));

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn() },
}));

const aoaToSheet = vi.fn(() => ({}));
const bookNew = vi.fn(() => ({}));
const bookAppendSheet = vi.fn();
const writeFile = vi.fn();

vi.mock('xlsx', () => ({
  utils: {
    aoa_to_sheet: (...args: any[]) => aoaToSheet(...args),
    book_new: (...args: any[]) => bookNew(...args),
    book_append_sheet: (...args: any[]) => bookAppendSheet(...args),
  },
  writeFile: (...args: any[]) => writeFile(...args),
}));

const apiGetMock = api.get as unknown as ReturnType<typeof vi.fn>;

const flujoItem: ReporteFlujoItem = {
  cdaId: 'c1',
  cdaCodigo: 'C001',
  cdaNombre: 'Escuela Central',
  cantonId: 1,
  cantonNombre: 'Ibarra',
  operadorId: 'op-1',
  operadorNombre: 'Juan Pérez',
  operadorCedula: '1234567890',
  kitsCodigos: ['KIT-001'],
  salidaDpiEn: '2026-06-23T08:00:00.000Z',
  llegadaRecintoEn: null,
  pruebaConexionEn: null,
  tieneFotoPruebaConexion: false,
  salidaRecintoEn: null,
  llegadaDpiEn: null,
  llegadaDpiManual: false,
};

const noCdaItem: ReporteNoCdaItem = {
  cdaId: 'c1',
  cdaCodigo: 'C001',
  cdaNombre: 'Escuela Central',
  operadorNombre: 'Juan Pérez',
  operadorCedula: '1234567890',
  kitsCodigos: ['KIT-001'],
  totalNoCdas: 2,
  totalLlegados: 1,
  noCdas: [
    { id: 'nc1', codigoRecinto: 'NC01', nombre: 'Anexo 1', llegado: true },
    { id: 'nc2', codigoRecinto: 'NC02', nombre: 'Anexo 2', llegado: false },
  ],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ReporteNoCdaPage />
    </QueryClientProvider>,
  );
}

describe('ReporteNoCdaPage — exportar a Excel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/tracking/reporte-flujo') return Promise.resolve({ data: [flujoItem] });
      if (url === '/tracking/reporte-no-cda') return Promise.resolve({ data: [noCdaItem] });
      return Promise.resolve({ data: [] });
    });
  });

  it('el botón Excel está deshabilitado sin datos y habilitado con datos', async () => {
    apiGetMock.mockResolvedValue({ data: [] });
    renderPage();

    const boton = await screen.findByTitle('Exportar a Excel');
    expect(boton).toBeDisabled();
  });

  it('exporta la vista de flujo con las columnas esperadas', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Juan Pérez');
    const boton = await screen.findByTitle('Exportar a Excel');
    expect(boton).toBeEnabled();

    await user.click(boton);

    expect(aoaToSheet).toHaveBeenCalledTimes(1);
    const rows = aoaToSheet.mock.calls[0][0];
    expect(rows[2]).toEqual([
      'Operador',
      'Cédula',
      'CDA',
      'Kit(s)',
      'Salida DPI',
      'Llegada Recinto',
      'Prueba de conexión',
      'Salida Recinto',
      'Llegada DPI',
    ]);
    expect(rows[3][0]).toBe('Juan Pérez');
    expect(rows[3][4]).not.toBe('Pendiente'); // salidaDpiEn tiene valor
    expect(rows[3][5]).toBe('Pendiente'); // llegadaRecintoEn es null
    expect(rows[3][6]).toBe('Pendiente'); // pruebaConexionEn es null
    expect(writeFile).toHaveBeenCalledWith(expect.anything(), 'reporte_flujo_cdas.xlsx');
  });

  it('exporta la vista de NO-CDAs con las columnas esperadas', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Juan Pérez');
    await user.click(screen.getByText('CDAs con sus NO-CDAs'));
    await screen.findByText(/NC01/);
    const boton = await screen.findByTitle('Exportar a Excel');
    expect(boton).toBeEnabled();
    await user.click(boton);

    expect(aoaToSheet).toHaveBeenCalledTimes(1);
    const rows = aoaToSheet.mock.calls[0][0];
    expect(rows[2]).toEqual(['Operador', 'Cédula', 'CDA', 'Kit(s)', 'Llegados', 'Faltan', 'NO-CDAs']);
    expect(rows[3][4]).toBe(1); // totalLlegados
    expect(rows[3][5]).toBe(1); // faltan = totalNoCdas - totalLlegados
    expect(rows[3][6]).toContain('NC01');
    expect(rows[3][6]).toContain('NC02');
    expect(writeFile).toHaveBeenCalledWith(expect.anything(), 'reporte_cdas_nocdas.xlsx');
  });
});

const guardarArchivo = vi.fn();
vi.mock('../../lib/queries/custodia', () => ({
  guardarArchivo: (...args: any[]) => guardarArchivo(...args),
}));

const sileoError = vi.fn();
vi.mock('sileo', () => ({ sileo: { error: (...args: any[]) => sileoError(...args) } }));

describe('ReporteNoCdaPage — Informe del Operador CDA', () => {
  const responsable = { id: 'resp-1', nombre: 'Edison Mafla', cedula: '1000000001' };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    rolesUsuario = ['ADMINISTRADOR'];
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/tracking/reporte-flujo') {
        return Promise.resolve({ data: [{ ...flujoItem, pruebaConexionEn: '2026-06-23T11:00:00.000Z' }] });
      }
      if (url === '/tracking/reporte-no-cda') return Promise.resolve({ data: [noCdaItem] });
      if (url === '/tracking/informes-operador/responsables') return Promise.resolve({ data: [responsable] });
      return Promise.resolve({ data: new Blob(['%PDF']) });
    });
  });

  it('la prueba de conexión con foto se puede ver desde el reporte', async () => {
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/tracking/reporte-flujo') {
        return Promise.resolve({
          data: [{ ...flujoItem, pruebaConexionEn: '2026-06-23T15:00:00.000Z', tieneFotoPruebaConexion: true }],
        });
      }
      if (url === '/tracking/reporte-no-cda') return Promise.resolve({ data: [noCdaItem] });
      if (url === '/tracking/informes-operador/responsables') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: new Blob(['img']) });
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Ver foto de la prueba de conexión — Escuela Central' }));

    expect(await screen.findByRole('heading', { name: 'Foto de la prueba de conexión' })).toBeInTheDocument();
    expect(apiGetMock).toHaveBeenCalledWith('/tracking/estado-cdas/c1/foto-acta/conexion', { responseType: 'blob' });
  });

  it('muestra la columna Prueba de conexión y el logo 2027', async () => {
    renderPage();
    await screen.findByText('Juan Pérez');

    expect(screen.getByRole('columnheader', { name: 'Prueba de conexión' })).toBeInTheDocument();
    expect(screen.getByAltText(/Elecciones Seccionales y CPCCS 2027/)).toBeInTheDocument();
  });

  it('sin responsable que firme, no deja descargar y explica el motivo de forma visible', async () => {
    renderPage();
    await screen.findByText('Juan Pérez');

    const pdf = screen.getByRole('button', { name: 'Descargar informe PDF de Juan Pérez' });
    expect(pdf).toBeDisabled();
    expect(pdf).toHaveAccessibleDescription('Elige el responsable que firma para descargar los informes.');
    expect(screen.getByRole('button', { name: /Descargar todos los informes/ })).toBeDisabled();
  });

  it('el lector ve la columna de prueba de conexión pero no el informe ni quién lo firma', async () => {
    rolesUsuario = ['LECTOR'];
    renderPage();
    await screen.findByText('Juan Pérez');

    expect(screen.getByRole('columnheader', { name: 'Prueba de conexión' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Responsable que firma')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Descargar todos los informes/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Descargar informe PDF/ })).not.toBeInTheDocument();
    expect(apiGetMock).not.toHaveBeenCalledWith('/tracking/informes-operador/responsables');
  });

  it('descarta un responsable guardado que ya no puede firmar', async () => {
    localStorage.setItem('informe-operador-responsable', 'ya-no-existe');
    renderPage();
    await screen.findByText('Juan Pérez');
    await screen.findByRole('option', { name: 'Edison Mafla' });

    expect(screen.getByLabelText('Responsable que firma')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Descargar informe PDF de Juan Pérez' })).toBeDisabled();
  });

  it('con más de 40 operadores sin cantón, pide elegir cantón antes de descargar todos', async () => {
    localStorage.setItem('informe-operador-responsable', 'resp-1');
    const muchos = Array.from({ length: 41 }, (_, i) => ({ ...flujoItem, cdaId: `c${i}`, operadorId: `op-${i}` }));
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/tracking/reporte-flujo') return Promise.resolve({ data: muchos });
      if (url === '/tracking/informes-operador/responsables') return Promise.resolve({ data: [responsable] });
      return Promise.resolve({ data: [] });
    });
    renderPage();
    await screen.findAllByText('Juan Pérez');
    await screen.findByRole('option', { name: 'Edison Mafla' });

    const todos = screen.getByRole('button', { name: /Descargar todos los informes/ });
    expect(todos).toBeDisabled();
    expect(todos).toHaveAccessibleDescription('Son 41 operadores; el máximo por archivo es 40. Elige un cantón u operadores.');
  });

  it('descarga el informe de un operador con el responsable elegido y lo recuerda', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Juan Pérez');
    await screen.findByRole('option', { name: 'Edison Mafla' });

    await user.selectOptions(screen.getByLabelText('Responsable que firma'), 'resp-1');
    await user.click(screen.getByRole('button', { name: 'Descargar informe PDF de Juan Pérez' }));

    expect(apiGetMock).toHaveBeenCalledWith('/tracking/informes-operador/op-1/pdf', {
      params: { responsableId: 'resp-1', incluirJornada: 'false' },
      responseType: 'blob',
    });
    expect(guardarArchivo).toHaveBeenCalledWith(expect.any(Blob), 'informe_1234567890.pdf');
    expect(localStorage.getItem('informe-operador-responsable')).toBe('resp-1');
  });

  it('la casilla del día de elecciones nace desmarcada y, al marcarla, el PDF incluye la jornada', async () => {
    const user = userEvent.setup();
    localStorage.setItem('informe-operador-responsable', 'resp-1');
    renderPage();
    await screen.findByText('Juan Pérez');
    await screen.findByRole('option', { name: 'Edison Mafla' });

    const casilla = screen.getByRole('checkbox', { name: /Incluir prueba de conexión y fotos/ });
    expect(casilla).not.toBeChecked();

    await user.click(casilla);
    await user.click(screen.getByRole('button', { name: 'Descargar informe PDF de Juan Pérez' }));

    expect(apiGetMock).toHaveBeenCalledWith('/tracking/informes-operador/op-1/pdf', {
      params: { responsableId: 'resp-1', incluirJornada: 'true' },
      responseType: 'blob',
    });
  });

  it('descarga en un solo PDF solo los operadores seleccionados', async () => {
    const user = userEvent.setup();
    localStorage.setItem('informe-operador-responsable', 'resp-1');
    const otro = { ...flujoItem, cdaId: 'c2', operadorId: 'op-2', operadorNombre: 'Ana Ruiz' };
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/tracking/reporte-flujo') return Promise.resolve({ data: [flujoItem, otro] });
      if (url === '/tracking/reporte-no-cda') return Promise.resolve({ data: [] });
      if (url === '/tracking/informes-operador/responsables') return Promise.resolve({ data: [responsable] });
      return Promise.resolve({ data: new Blob(['%PDF']) });
    });
    renderPage();
    await screen.findByText('Ana Ruiz');
    await screen.findByRole('option', { name: 'Edison Mafla' });

    const boton = screen.getByRole('button', { name: /Descargar seleccionados \(0\)/ });
    expect(boton).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: 'Seleccionar a Ana Ruiz' }));
    await user.click(screen.getByRole('button', { name: /Descargar seleccionados \(1\)/ }));

    expect(apiGetMock).toHaveBeenCalledWith('/tracking/informes-operador/pdf', {
      params: { responsableId: 'resp-1', incluirJornada: 'false', operadorIds: 'op-2' },
      responseType: 'blob',
    });
  });

  it('descarga el reporte general del cantón elegido', async () => {
    const user = userEvent.setup();
    localStorage.setItem('informe-operador-responsable', 'resp-1');
    renderPage();
    await screen.findByText('Juan Pérez');
    await screen.findByRole('option', { name: 'Edison Mafla' });

    await user.selectOptions(screen.getByLabelText('Cantón'), '1');
    await user.click(screen.getByRole('button', { name: /Reporte general \(PDF\)/ }));

    expect(apiGetMock).toHaveBeenCalledWith('/tracking/informes-operador/reporte-general', {
      params: { responsableId: 'resp-1', incluirJornada: 'false', cantonId: '1' },
      responseType: 'blob',
    });
    expect(guardarArchivo).toHaveBeenCalledWith(expect.any(Blob), 'reporte_general_cdas.pdf');
  });

  it('descarga todos los informes del cantón elegido', async () => {
    const user = userEvent.setup();
    localStorage.setItem('informe-operador-responsable', 'resp-1');
    renderPage();
    await screen.findByText('Juan Pérez');
    await screen.findByRole('option', { name: 'Edison Mafla' });

    await user.selectOptions(screen.getByLabelText('Cantón'), '1');
    await user.click(screen.getByRole('button', { name: /Descargar todos los informes/ }));

    expect(apiGetMock).toHaveBeenCalledWith('/tracking/informes-operador/pdf', {
      params: { responsableId: 'resp-1', incluirJornada: 'false', cantonId: '1' },
      responseType: 'blob',
    });
    expect(guardarArchivo).toHaveBeenCalledWith(expect.any(Blob), 'informes_operadores_cda.pdf');
  });

  it('muestra el mensaje del servidor si no se pudo generar (p. ej. pasar del máximo)', async () => {
    const user = userEvent.setup();
    localStorage.setItem('informe-operador-responsable', 'resp-1');
    const mensaje = 'Son 60 operadores; el máximo por archivo es 40. Elige un cantón.';
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/tracking/reporte-flujo') return Promise.resolve({ data: [flujoItem] });
      if (url === '/tracking/informes-operador/responsables') return Promise.resolve({ data: [responsable] });
      if (url === '/tracking/informes-operador/pdf') {
        return Promise.reject({ response: { data: new Blob([JSON.stringify({ message: mensaje })]) } });
      }
      return Promise.resolve({ data: [] });
    });
    renderPage();
    await screen.findByText('Juan Pérez');
    await screen.findByRole('option', { name: 'Edison Mafla' });

    await user.click(screen.getByRole('button', { name: /Descargar todos los informes/ }));

    expect(sileoError).toHaveBeenCalledWith({ title: mensaje });
    expect(guardarArchivo).not.toHaveBeenCalled();
  });
});
