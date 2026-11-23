import { type EntradaReporteNoCda, type RecintoLlegada, armarReporteNoCda } from './reporte-no-cda';

const recinto = (id: string, extra: Partial<RecintoLlegada> = {}): RecintoLlegada => ({
  id,
  codigoRecinto: `C-${id}`,
  nombre: `Recinto ${id}`,
  cantonNombre: 'IBARRA',
  cdaDestinoId: null,
  juntasFemeninas: 1,
  juntasMasculinas: 1,
  numeroElectores: 100,
  ...extra,
});

const entrada = (extra: Partial<EntradaReporteNoCda> = {}): EntradaReporteNoCda => ({
  cdas: [recinto('cda1', { nombre: 'Colegio CDA' })],
  operadorPorCda: new Map([['cda1', 'op1']]),
  kitsPorCda: new Map([['cda1', ['KIT-1']]]),
  noCdas: [
    recinto('n1', { cdaDestinoId: 'cda1', juntasFemeninas: 3, juntasMasculinas: 2, numeroElectores: 1500 }),
    recinto('n2', { cdaDestinoId: 'cda1', cantonNombre: 'URCUQUI' }),
  ],
  usuarios: [
    { id: 'op1', nombres: 'Ana', apellidos: 'Pérez', cedula: '1000000001' },
    { id: 'as1', nombres: 'Luis', apellidos: 'Mora', cedula: '1000000002' },
  ],
  llegadas: [],
  ...extra,
});

describe('armarReporteNoCda', () => {
  it('sin llegadas: todos pendientes, con juntas y electores de cada NO CDA', () => {
    const [cda] = armarReporteNoCda(entrada());

    expect(cda).toMatchObject({
      cdaCodigo: 'C-cda1',
      cantonNombre: 'IBARRA',
      operadorNombre: 'Ana Pérez',
      operadorCedula: '1000000001',
      kitsCodigos: ['KIT-1'],
      totalNoCdas: 2,
      totalLlegados: 0,
      juntasNoCdas: 5 + 2,
      juntasLlegadas: 0,
    });
    expect(cda.noCdas[0]).toEqual({
      id: 'n1',
      codigoRecinto: 'C-n1',
      nombre: 'Recinto n1',
      cantonNombre: 'IBARRA',
      juntasFemeninas: 3,
      juntasMasculinas: 2,
      juntas: 5,
      electores: 1500,
      llegado: false,
      llegadaEn: null,
      registradoPor: null,
    });
    expect(cda.noCdas[1].cantonNombre).toBe('URCUQUI');
  });

  it('con llegada: hora de la PRIMERA marca y quién la hizo, aunque no sea el operador del kit', () => {
    const [cda] = armarReporteNoCda(
      entrada({
        llegadas: [
          { recintoId: 'n1', operadorId: 'op1', ocurridoEn: new Date('2026-11-29T23:50:00Z') },
          { recintoId: 'n1', operadorId: 'as1', ocurridoEn: new Date('2026-11-29T23:42:00Z') },
        ],
      }),
    );

    expect(cda.totalLlegados).toBe(1);
    expect(cda.juntasLlegadas).toBe(5);
    expect(cda.noCdas[0]).toMatchObject({
      llegado: true,
      llegadaEn: '2026-11-29T23:42:00.000Z',
      registradoPor: 'Luis Mora',
    });
    expect(cda.noCdas[1].llegado).toBe(false);
  });

  it('juntas o electores vacíos en el distributivo cuentan como 0', () => {
    const [cda] = armarReporteNoCda(
      entrada({
        noCdas: [recinto('n1', { cdaDestinoId: 'cda1', juntasFemeninas: null, juntasMasculinas: null, numeroElectores: null })],
      }),
    );

    expect(cda.noCdas[0]).toMatchObject({ juntasFemeninas: 0, juntasMasculinas: 0, juntas: 0, electores: 0 });
    expect(cda.juntasNoCdas).toBe(0);
  });

  it('CDA sin NO CDA y operador desconocido: lista vacía y textos por defecto', () => {
    const [cda] = armarReporteNoCda(entrada({ noCdas: [], usuarios: [], kitsPorCda: new Map() }));

    expect(cda).toMatchObject({
      operadorNombre: 'Operador',
      operadorCedula: '—',
      kitsCodigos: [],
      totalNoCdas: 0,
      juntasNoCdas: 0,
      noCdas: [],
    });
  });

  it('ignora marcas sin recinto y NO CDA de otros CDA', () => {
    const [cda] = armarReporteNoCda(
      entrada({
        noCdas: [recinto('n1', { cdaDestinoId: 'cda1' }), recinto('x', { cdaDestinoId: 'otro' })],
        llegadas: [{ recintoId: null, operadorId: 'op1', ocurridoEn: new Date() }],
      }),
    );

    expect(cda.noCdas.map((n) => n.id)).toEqual(['n1']);
    expect(cda.totalLlegados).toBe(0);
  });
});
