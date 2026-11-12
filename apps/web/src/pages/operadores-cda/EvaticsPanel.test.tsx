import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PERMISO_IDS } from '@cne/shared-validation';
import type { AnalisisCertificadoEvatics, FilaEvatics, ListadoEvatics, RoleName } from '@cne/shared-types';

import { EvaticsPanel, REFRESCO_EVATICS_MS } from './EvaticsPanel';
import { AvanceEvatics, ordenarGrupos } from './AvanceEvatics';
import { sugerenciaIa } from './RevisarEvaticsModal';
import { api } from '../../lib/api';
import { sileo } from 'sileo';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
vi.mock('sileo', () => ({ sileo: { error: vi.fn(), success: vi.fn() } }));
const permisos = { actuales: new Set<string>(PERMISO_IDS) };
vi.mock('../../lib/useModulos', () => ({
  useModulos: () => ({ cargando: false, visibles: new Set(), puedeVer: () => true, puede: (id: string) => permisos.actuales.has(id) }),
}));
let roles: RoleName[] = ['ADMINISTRADOR'];
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { roles } }) }));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const postMock = api.post as unknown as ReturnType<typeof vi.fn>;
const putMock = (api as unknown as { put: ReturnType<typeof vi.fn> }).put;

const LISTO: AnalisisCertificadoEvatics = {
  estado: 'LISTO',
  nombreLeido: 'Ana Andrade López',
  nombreCoincide: true,
  esCertificado: true,
  legible: true,
  analizadoEn: '2026-11-12T15:00:00.000Z',
  proveedor: 'Groq',
};

const fila = (f: Partial<FilaEvatics> = {}): FilaEvatics => ({
  certificadoId: 'c1',
  cedula: '1710034065',
  apellidosNombres: 'ANDRADE LÓPEZ ANA',
  cargo: 'OPERADOR CDA',
  centro: 'CDA',
  canton: 'Ibarra',
  tecnico: 'PÉREZ JUAN',
  estado: 'PENDIENTE',
  subidoEn: '2026-11-12T14:59:00.000Z',
  reemplazos: 0,
  tieneFotoAnterior: false,
  fotoAnteriorSubidaEn: null,
  revisadoPor: null,
  revisadoEn: null,
  motivoRechazo: null,
  analisis: LISTO,
  esPropio: false,
  ...f,
});

const SIN_SUBIR = fila({
  certificadoId: null,
  cedula: '1002003000',
  apellidosNombres: 'VEGA TAPIA LUIS',
  canton: 'CPE',
  estado: 'SIN_SUBIR',
  subidoEn: null,
  analisis: null,
});

const listado = (l: Partial<ListadoEvatics> = {}): ListadoEvatics => ({
  fechaLimite: '2026-11-20',
  plazoVencido: false,
  analisisDisponible: true,
  distributivoDisponible: true,
  totales: { total: 4, sinSubir: 1, pendientes: 1, aprobados: 2, rechazados: 0 },
  porCanton: [
    { nombre: 'CPE', total: 1, sinSubir: 1, pendientes: 0, aprobados: 0, rechazados: 0 },
    { nombre: 'Ibarra', total: 3, sinSubir: 0, pendientes: 1, aprobados: 2, rechazados: 0 },
  ],
  porTecnico: [{ nombre: 'PÉREZ JUAN', total: 4, sinSubir: 1, pendientes: 1, aprobados: 2, rechazados: 0 }],
  cargos: ['OPERADOR CDA'],
  filas: [fila(), SIN_SUBIR],
  ...l,
});

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EvaticsPanel />
    </QueryClientProvider>,
  );
}

const filaDe = (nombre: string) => screen.getByRole('rowheader', { name: new RegExp(nombre) }).closest('tr') as HTMLElement;

describe('EvaticsPanel', () => {
  let datos: ListadoEvatics;
  beforeEach(() => {
    vi.clearAllMocks();
    permisos.actuales = new Set(PERMISO_IDS);
    roles = ['ADMINISTRADOR'];
    datos = listado();
    getMock.mockImplementation((url: string) =>
      url.endsWith('/foto')
        ? Promise.resolve({ data: new Blob(['jpg'], { type: 'image/jpeg' }) })
        : Promise.resolve({ data: datos }),
    );
    URL.createObjectURL = vi.fn(() => 'blob:cert');
    URL.revokeObjectURL = vi.fn();
  });

  it('"Hechos" cuenta solo los aprobados, con el plazo y el enlace público', async () => {
    renderPanel();
    const kpis = await screen.findByRole('group', { name: 'Resumen de certificados' });
    expect(within(kpis).getByText('Hechos (aprobados)')).toBeInTheDocument();
    expect(within(kpis).getByText('2 de 4')).toBeInTheDocument();
    expect(within(kpis).getByText('50 % del personal')).toBeInTheDocument();
    expect(screen.getByText(/puede subir su certificado hasta el/)).toHaveTextContent(`${window.location.origin}/evatics`);
  });

  it('avisa si la IA no está activa o no se leyó el distributivo', async () => {
    datos = listado({ analisisDisponible: false, distributivoDisponible: false });
    renderPanel();
    expect(await screen.findByText(/lectura automática del nombre no está activa/)).toBeInTheDocument();
    expect(screen.getByText(/No se pudo leer el distributivo/)).toBeInTheDocument();
  });

  it('gráfico por cantón: cada barra se describe en texto y filtra el listado; el grupo más grande va primero', async () => {
    const user = userEvent.setup();
    renderPanel();
    const avance = await screen.findByRole('region', { name: 'Avance por cantón' });
    const barras = within(avance).getAllByRole('button', { name: /aprobados \(/ });
    expect(barras.map((b) => b.textContent?.split(/\d/)[0])).toEqual(['Ibarra', 'CPE']);
    expect(barras[0]).toHaveAccessibleName(
      'Ibarra: 2 de 3 aprobados (67 %), 1 en revisión, 0 rechazados, 0 sin subir. Filtrar el listado',
    );

    await user.click(barras[0]);
    await waitFor(() =>
      expect(getMock).toHaveBeenLastCalledWith('/operadores-cda/evatics', { params: { canton: 'Ibarra' } }),
    );
    expect(within(avance).getByRole('button', { name: /^Ibarra.*Quitar el filtro$/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Cantón')).toHaveValue('Ibarra');
  });

  it('el gráfico tiene leyenda, vista por asistente y vista de tabla con las mismas cifras', async () => {
    const user = userEvent.setup();
    renderPanel();
    const avance = await screen.findByRole('region', { name: 'Avance por cantón' });
    const leyenda = within(avance).getByRole('list', { name: 'Leyenda' });
    expect(within(leyenda).getAllByRole('listitem').map((l) => l.textContent)).toEqual([
      'Aprobados',
      'En revisión',
      'Rechazados',
      'Sin subir',
    ]);
    await user.click(within(avance).getByRole('button', { name: 'Por asistente' }));
    expect(screen.getByRole('heading', { name: 'Avance por Asistente Transversal' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ver como tabla' }));
    const tabla = screen.getByRole('region', { name: 'Avance por Asistente Transversal (tabla)' });
    expect(within(tabla).getByRole('row', { name: /PÉREZ JUAN 2 1 0 1 4 50 %/ })).toBeInTheDocument();
  });

  it('los filtros de estado y búsqueda van a la API', async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole('group', { name: 'Filtrar por estado' });
    await user.click(screen.getByRole('button', { name: 'En revisión' }));
    await waitFor(() =>
      expect(getMock).toHaveBeenLastCalledWith('/operadores-cda/evatics', { params: { estado: 'PENDIENTE' } }),
    );
    await user.type(screen.getByRole('textbox', { name: 'Buscar persona por nombre o cédula' }), 'ana');
    await waitFor(() =>
      expect(getMock).toHaveBeenLastCalledWith('/operadores-cda/evatics', { params: { estado: 'PENDIENTE', q: 'ana' } }),
    );
    await user.click(screen.getByRole('button', { name: 'Quitar filtros' }));
    await waitFor(() => expect(getMock).toHaveBeenLastCalledWith('/operadores-cda/evatics', { params: {} }));
  });

  it('tabla: estado, sugerencia de la IA y "Revisar" solo con certificado subido', async () => {
    renderPanel();
    await screen.findByRole('region', { name: 'Certificados Evatics del personal' });
    const ana = filaDe('ANDRADE');
    expect(within(ana).getByText('En revisión')).toBeInTheDocument();
    expect(within(ana).getByText('El nombre coincide')).toBeInTheDocument();
    expect(within(ana).getByRole('button', { name: 'Revisar certificado de ANDRADE LÓPEZ ANA' })).toBeInTheDocument();
    expect(within(filaDe('VEGA')).queryByRole('button')).not.toBeInTheDocument();
  });

  it('sin el permiso de revisar no hay columna de acción', async () => {
    permisos.actuales = new Set();
    renderPanel();
    await screen.findByRole('region', { name: 'Certificados Evatics del personal' });
    expect(screen.queryByRole('columnheader', { name: 'Acción' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Revisar certificado/ })).not.toBeInTheDocument();
  });

  describe('revisión', () => {
    async function abrirRevision(f = fila()) {
      datos = listado({ filas: [f] });
      const user = userEvent.setup();
      renderPanel();
      await user.click(await screen.findByRole('button', { name: /certificado de ANDRADE/ }));
      const dialogo = await screen.findByRole('dialog', { name: 'ANDRADE LÓPEZ ANA' });
      await within(dialogo).findByRole('img', { name: 'Certificado de ANDRADE LÓPEZ ANA' });
      return { user, dialogo };
    }

    it('pide la foto con la versión que ve y aprueba con esa misma versión', async () => {
      const { user, dialogo } = await abrirRevision();
      expect(getMock).toHaveBeenCalledWith('/operadores-cda/evatics/c1/foto', {
        params: { v: '2026-11-12T14:59:00.000Z' },
        responseType: 'blob',
      });
      expect(within(dialogo).getByText('Ana Andrade López')).toBeInTheDocument();
      expect(within(dialogo).getByText('Groq')).toBeInTheDocument();
      expect(within(dialogo).getByText(/La IA solo sugiere/)).toBeInTheDocument();

      postMock.mockResolvedValueOnce({ data: { id: 'c1', estado: 'APROBADO', revisadoEn: 'x' } });
      await user.click(within(dialogo).getByRole('button', { name: 'Aprobar' }));
      expect(postMock).toHaveBeenCalledWith('/operadores-cda/evatics/c1/revision', {
        decision: 'APROBADO',
        subidoEn: '2026-11-12T14:59:00.000Z',
      });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(sileo.success).toHaveBeenCalledWith({ title: 'ANDRADE LÓPEZ ANA: certificado aprobado' });
    });

    it('rechazar exige un motivo de al menos 5 letras', async () => {
      const { user, dialogo } = await abrirRevision();
      await user.click(within(dialogo).getByRole('button', { name: 'Rechazar…' }));
      const motivo = within(dialogo).getByLabelText('Motivo del rechazo (la persona lo verá)');
      await user.type(motivo, 'mal');
      await user.click(within(dialogo).getByRole('button', { name: 'Rechazar certificado' }));
      expect(postMock).not.toHaveBeenCalled();
      expect(motivo).toHaveAttribute('aria-invalid', 'true');
      expect(motivo).toHaveAccessibleDescription(/mínimo 5 caracteres/);

      postMock.mockResolvedValueOnce({ data: { id: 'c1', estado: 'RECHAZADO', revisadoEn: 'x' } });
      await user.type(motivo, ' enfocada');
      await user.click(within(dialogo).getByRole('button', { name: 'Rechazar certificado' }));
      expect(postMock).toHaveBeenCalledWith('/operadores-cda/evatics/c1/revision', {
        decision: 'RECHAZADO',
        subidoEn: '2026-11-12T14:59:00.000Z',
        motivo: 'mal enfocada',
      });
    });

    it('si la persona subió otra foto (409), cierra y recarga el listado', async () => {
      const { user, dialogo } = await abrirRevision();
      const llamadas = getMock.mock.calls.length;
      postMock.mockRejectedValueOnce({ response: { status: 409, data: { message: 'La foto cambió' } } });
      await user.click(within(dialogo).getByRole('button', { name: 'Aprobar' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(sileo.error).toHaveBeenCalledWith({ title: 'La persona subió otra foto: ábrala de nuevo para revisarla' });
      await waitFor(() => expect(getMock.mock.calls.length).toBeGreaterThan(llamadas));
    });

    it('con foto anterior se puede comparar, pero solo se decide sobre la actual', async () => {
      const { user, dialogo } = await abrirRevision(
        fila({ reemplazos: 1, tieneFotoAnterior: true, fotoAnteriorSubidaEn: '2026-11-11T10:00:00.000Z' }),
      );
      await user.click(within(dialogo).getByRole('button', { name: 'Foto anterior' }));
      await waitFor(() =>
        expect(getMock).toHaveBeenCalledWith('/operadores-cda/evatics/c1/foto', {
          params: { v: '2026-11-11T10:00:00.000Z', anterior: 'true' },
          responseType: 'blob',
        }),
      );
      expect(within(dialogo).getByRole('button', { name: 'Aprobar' })).toBeDisabled();
      expect(within(dialogo).getByRole('button', { name: 'Rechazar…' })).toBeDisabled();
      expect(within(dialogo).getByText('Para decidir, vuelva a la foto actual.')).toBeInTheDocument();
    });

    it('tampoco se rechaza si, ya escribiendo el motivo, pasa a la foto anterior', async () => {
      const { user, dialogo } = await abrirRevision(
        fila({ reemplazos: 1, tieneFotoAnterior: true, fotoAnteriorSubidaEn: '2026-11-11T10:00:00.000Z' }),
      );
      await user.click(within(dialogo).getByRole('button', { name: 'Rechazar…' }));
      await user.type(within(dialogo).getByLabelText(/Motivo del rechazo/), 'No se lee el nombre');
      await user.click(within(dialogo).getByRole('button', { name: 'Foto anterior' }));
      expect(within(dialogo).getByRole('button', { name: 'Rechazar certificado' })).toBeDisabled();
    });

    it('si la foto no carga, no se puede aprobar ni rechazar', async () => {
      datos = listado({ filas: [fila()] });
      getMock.mockImplementation((url: string) =>
        url.endsWith('/foto')
          ? Promise.reject({ response: { status: 500, data: { message: 'Error del almacenamiento' } } })
          : Promise.resolve({ data: datos }),
      );
      const user = userEvent.setup();
      renderPanel();
      await user.click(await screen.findByRole('button', { name: /certificado de ANDRADE/ }));
      const dialogo = await screen.findByRole('dialog', { name: 'ANDRADE LÓPEZ ANA' });
      expect(await within(dialogo).findByRole('alert')).toHaveTextContent('Error del almacenamiento');
      expect(within(dialogo).getByRole('button', { name: 'Aprobar' })).toBeDisabled();
      expect(within(dialogo).getByRole('button', { name: 'Rechazar…' })).toBeDisabled();
    });

    it('su propio certificado: lo ve pero no puede decidir', async () => {
      const { dialogo } = await abrirRevision(fila({ esPropio: true }));
      expect(within(dialogo).getByText(/Es su propio certificado/)).toBeInTheDocument();
      expect(within(dialogo).queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
    });
  });

  describe('fecha límite', () => {
    it('el administrador la cambia (o la quita) desde el encabezado', async () => {
      const user = userEvent.setup();
      renderPanel();
      await user.click(await screen.findByRole('button', { name: 'Fecha límite' }));
      const dialogo = screen.getByRole('dialog', { name: 'Fecha límite' });
      const campo = within(dialogo).getByLabelText('Último día para subir');
      expect(campo).toHaveValue('2026-11-20');
      // 20-nov + 90 días = 18-feb: desde el 19-feb se borra.
      expect(within(dialogo).getByText(/se borrarán solos desde el/)).toHaveTextContent('19 de febrero de 2027');
      await user.clear(campo);
      expect(within(dialogo).getByText(/cada foto se borra 90 días después de subirla/)).toBeInTheDocument();
      putMock.mockResolvedValueOnce({ data: { fechaLimite: null } });
      await user.click(within(dialogo).getByRole('button', { name: 'Guardar' }));
      expect(putMock).toHaveBeenCalledWith('/operadores-cda/evatics/config', { fechaLimite: null });
      await waitFor(() => expect(sileo.success).toHaveBeenCalledWith({ title: 'Sin fecha límite' }));
    });

    it('un supervisor no ve el botón', async () => {
      roles = ['TECNICO_SUPERVISOR'];
      renderPanel();
      await screen.findByRole('group', { name: 'Resumen de certificados' });
      expect(screen.queryByRole('button', { name: 'Fecha límite' })).not.toBeInTheDocument();
    });
  });

  it('copia el enlace público', async () => {
    const user = userEvent.setup();
    const escribir = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Copiar enlace público' }));
    expect(escribir).toHaveBeenCalledWith(`${window.location.origin}/evatics`);
  });
});

describe('sugerenciaIa', () => {
  it.each([
    [null, 'Aún sin leer'],
    [{ ...LISTO, estado: 'EN_COLA' as const }, 'Aún sin leer'],
    [{ ...LISTO, estado: 'NO_DISPONIBLE' as const }, 'Sin IA'],
    [{ ...LISTO, esCertificado: false }, 'No parece un certificado'],
    [{ ...LISTO, legible: false }, 'No se lee bien'],
    [LISTO, 'El nombre coincide'],
    [{ ...LISTO, nombreCoincide: false }, 'El nombre no coincide'],
    [{ ...LISTO, nombreCoincide: null, nombreLeido: null }, 'No se leyó el nombre'],
  ])('%#: %s', (a, texto) => {
    expect(sugerenciaIa(a).texto).toBe(texto);
  });
});

describe('ordenarGrupos', () => {
  const g = (nombre: string, total: number, aprobados = 0) => ({
    nombre,
    total,
    aprobados,
    sinSubir: total - aprobados,
    pendientes: 0,
    rechazados: 0,
  });

  it('del mayor al menor porcentaje de aprobados, no por cantidad de personas', () => {
    // CPE tiene más gente pero menos avance: 20 %. Sebastian: 60 %. Carlos: 50 %.
    expect(
      ordenarGrupos([g('CPE', 40, 8), g('Carlos', 10, 5), g('Sebastian', 10, 6)]).map((x) => x.nombre),
    ).toEqual(['Sebastian', 'Carlos', 'CPE']);
  });

  it('compara la fracción exacta (1/3 > 33 de 100) y desempata por más personas y por nombre', () => {
    expect(ordenarGrupos([g('B', 100, 33), g('A', 3, 1)]).map((x) => x.nombre)).toEqual(['A', 'B']);
    expect(ordenarGrupos([g('Ibarra', 4, 2), g('Cotacachi', 2, 1), g('Antonio Ante', 2, 1)]).map((x) => x.nombre)).toEqual([
      'Ibarra',
      'Antonio Ante',
      'Cotacachi',
    ]);
  });

  it('con 0 aprobados todos empatan: más personas primero, luego nombre; un grupo vacío no rompe', () => {
    expect(ordenarGrupos([g('Urcuquí', 2), g('CPE', 9), g('Vacío', 0), g('Ibarra', 5)]).map((x) => x.nombre)).toEqual([
      'CPE',
      'Ibarra',
      'Urcuquí',
      'Vacío',
    ]);
  });
});

describe('avance: orden automático', () => {
  const g = (nombre: string, total: number, aprobados: number) => ({
    nombre,
    total,
    aprobados,
    sinSubir: total - aprobados,
    pendientes: 0,
    rechazados: 0,
  });
  const nombresEnPantalla = () => screen.getAllByRole('button', { pressed: false }).filter((b) => b.className === 'evx-fila').map((b) => b.querySelector('.evx-nombre')?.textContent);
  const props = { porCanton: [] as ReturnType<typeof g>[], seleccionado: { canton: '', tecnico: '' }, onElegir: () => {} };

  it('al llegar datos nuevos, el que más avanzó sube y el que menos, baja (sin recargar)', () => {
    const { rerender } = render(
      <AvanceEvatics {...props} porTecnico={[g('Carlos', 10, 8), g('Sebastian', 10, 2)]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Por asistente/ }));
    expect(nombresEnPantalla()).toEqual(['Carlos', 'Sebastian']);

    rerender(<AvanceEvatics {...props} porTecnico={[g('Carlos', 10, 8), g('Sebastian', 10, 9)]} />);
    expect(nombresEnPantalla()).toEqual(['Sebastian', 'Carlos']);
  });
});

describe('EvaticsPanel: refresco automático', () => {
  it('vuelve a pedir el avance sola cada REFRESCO_EVATICS_MS', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      getMock.mockResolvedValue({ data: listado() });
      renderPanel();
      await screen.findByText(/Hechos/);
      const antes = getMock.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(REFRESCO_EVATICS_MS + 100);
      });
      expect(getMock.mock.calls.length).toBeGreaterThan(antes);
    } finally {
      vi.useRealTimers();
    }
  });
});
