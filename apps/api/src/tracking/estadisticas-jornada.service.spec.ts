import { EstadisticasJornadaService } from './estadisticas-jornada.service';
import type { Jornada } from '../enlaces/jornada/jornada';

const unidad = (operadorId: string, codigo: string) => ({
  operadorId,
  codigoRecinto: codigo,
  nombreRecinto: `Recinto ${codigo}`,
  tecnico: { numero: 1, nombre: 'Isidro' },
  canton: { codigo: 30, nombre: 'IBARRA' },
  personas: [
    { nombre: 'Ana Perez', telefono: null, rol: 'Op.' as const },
    { nombre: 'Rosa Lema', telefono: null, rol: 'Asis.' as const },
  ],
  registros: {
    SALIDA_DPI: { en: new Date('2026-11-15T12:00:00.000Z'), sinSenal: false },
    LLEGADA_RECINTO: { en: new Date('2026-11-15T13:00:00.000Z'), sinSenal: false },
  },
  kitRecibido: null,
  kitEscaneado: null,
  actas: null,
  tiempoViajeMin: null,
  ultimoGps: null,
});

const noCda = (codigoCda: string, cdaConKit: boolean, visita: boolean) => ({
  codigoRecinto: `N-${codigoCda}`,
  nombreRecinto: `NoCda ${codigoCda}`,
  codigoCda,
  nombreCda: `Recinto ${codigoCda}`,
  tecnico: { numero: 1, nombre: 'Isidro' },
  canton: { codigo: 30, nombre: 'IBARRA' },
  personas: [],
  visita: visita ? { en: new Date('2026-11-15T14:00:00.000Z'), sinSenal: false } : null,
  cdaConKit,
});

describe('EstadisticasJornadaService', () => {
  const jornada: Jornada = {
    eventoId: 'ev',
    evento: 'Simulacro',
    unidades: [unidad('op1', 'C1'), unidad('op2', 'C2')],
    noCdas: [noCda('C1', true, true), noCda('C2', true, false), noCda('C3', false, false)],
    sinKit: [],
    sinDistributivo: false,
  };
  const cargar = jest.fn();
  const asignaciones = jest.fn();
  const service = new EstadisticasJornadaService(
    { cargar } as never,
    { asignacionSupervisor: { findMany: asignaciones } } as never,
  );

  beforeEach(() => {
    cargar.mockReset().mockResolvedValue(jornada);
    asignaciones.mockReset();
  });

  it('sin evento activo devuelve null', async () => {
    cargar.mockResolvedValue(null);
    await expect(service.estadisticas('u', ['ADMINISTRADOR'])).resolves.toBeNull();
  });

  it('un administrador ve todas las parejas con sus horas, y solo los NO CDA cuyo CDA lleva kit', async () => {
    const r = (await service.estadisticas('u', ['ADMINISTRADOR']))!;

    expect(asignaciones).not.toHaveBeenCalled();
    expect(r.unidades).toHaveLength(2);
    expect(r.unidades[0]).toEqual(
      expect.objectContaining({
        operadorNombre: 'Ana Perez',
        asistenteNombre: 'Rosa Lema',
        tecnicoNombre: 'Isidro',
        salidaDpiEn: '2026-11-15T12:00:00.000Z',
        llegadaRecintoEn: '2026-11-15T13:00:00.000Z',
        salidaRecintoEn: null,
        llegadaDpiEn: null,
      }),
    );
    expect(r.noCdas.map((n) => [n.codigoCda, n.llegadaEn])).toEqual([
      ['C1', '2026-11-15T14:00:00.000Z'],
      ['C2', null],
    ]);
  });

  it.each(['ANALISTA_PROVINCIAL', 'LECTOR'] as const)('%s ve todo sin consultar asignaciones', async (rol) => {
    const r = (await service.estadisticas('u', [rol]))!;

    expect(asignaciones).not.toHaveBeenCalled();
    expect(r.unidades).toHaveLength(2);
  });

  it('un supervisor sin asignaciones recibe listas vacías', async () => {
    asignaciones.mockResolvedValue([]);

    const r = (await service.estadisticas('sup', ['TECNICO_SUPERVISOR']))!;

    expect(r.unidades).toEqual([]);
    expect(r.noCdas).toEqual([]);
  });

  it('un supervisor solo ve sus operadores y los NO CDA de sus CDAs', async () => {
    asignaciones.mockResolvedValue([{ operadorId: 'op2' }]);

    const r = (await service.estadisticas('sup', ['TECNICO_SUPERVISOR']))!;

    expect(r.unidades.map((u) => u.codigoRecinto)).toEqual(['C2']);
    expect(r.noCdas.map((n) => n.codigoCda)).toEqual(['C2']);
  });
});
