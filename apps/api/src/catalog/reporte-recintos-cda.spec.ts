import { type RecintoReporte, parseCantonReporte, reporteRecintosCda } from './reporte-recintos-cda';

const recinto = (id: string, nombre: string, extra: Partial<RecintoReporte> = {}): RecintoReporte => ({
  id,
  codigoRecinto: `C-${id}`,
  nombre,
  cantonNombre: 'Ibarra',
  parroquia: null,
  direccion: null,
  juntasFemeninas: 1,
  juntasMasculinas: 2,
  cdaDestinoId: null,
  ...extra,
});

describe('reporteRecintosCda', () => {
  const cdaA = recinto('a', 'Colegio A');
  const cdaB = recinto('b', 'Colegio B', { cantonNombre: 'Otavalo' });

  it('agrupa los NO CDA bajo su CDA destino (no por cantón) y suma las juntas', () => {
    // n1 es de Otavalo pero va al CDA A (Ibarra): manda cdaDestinoId, no el cantón.
    const n1 = recinto('n1', 'Escuela 1', { cdaDestinoId: 'a', cantonNombre: 'Otavalo', juntasFemeninas: 3, juntasMasculinas: 3 });
    const r = reporteRecintosCda([cdaA, cdaB], [n1], '2026-11-13');
    const [t] = r.tablas;

    expect(t.filas.map((f) => f[4])).toEqual([
      'Colegio A (CDA)',
      'Escuela 1',
      'Total de juntas',
      'Colegio B (CDA)',
      'Sin recintos NO CDA asignados',
      'Total de juntas',
    ]);
    expect(t.filas[2][8]).toBe(3 + 6); // CDA A: 1+2 y Escuela 1: 3+3
    expect(t.filas[5][8]).toBe(3);
    expect(t.resaltadas).toEqual([2, 5]);
  });

  it('los NO CDA sin CDA (o con un CDA que no está en la lista) van a una hoja aparte', () => {
    const sin = recinto('s', 'Sin CDA');
    const huerfano = recinto('h', 'Otro CDA', { cdaDestinoId: 'fuera' });
    const r = reporteRecintosCda([cdaA], [sin, huerfano], '2026-11-13');

    expect(r.tablas).toHaveLength(2);
    expect(r.tablas[1].hoja).toBe('NO CDA sin CDA');
    expect(r.tablas[1].filas.map((f) => f[3])).toEqual(['Otro CDA', 'Sin CDA']);
    expect(r.tablas[1].columnas).toHaveLength(r.tablas[1].filas[0].length);
  });

  it('sin NO CDA sueltos no agrega la segunda hoja; el detalle dice el alcance', () => {
    const toda = reporteRecintosCda([cdaA], [], '2026-11-13');
    expect(toda.tablas).toHaveLength(1);
    expect(toda.detalle).toBe('Toda la provincia · 1 CDA · 0 recintos NO CDA');
    expect(reporteRecintosCda([cdaA], [], '2026-11-13', 'Ibarra').detalle).toContain('Cantón Ibarra');
  });

  it('trata juntas nulas como 0 y no limita el PDF por días', () => {
    const r = reporteRecintosCda([recinto('a', 'A', { juntasFemeninas: null, juntasMasculinas: null })], [], '2026-11-13');
    expect(r.tablas[0].filas[0][8]).toBe(0);
    expect(r.limitarDiasPdf).toBe(false);
    expect(r.desde).toBe(r.hasta);
  });
});

describe('parseCantonReporte', () => {
  it('sin valor no filtra; con un entero válido lo devuelve', () => {
    expect(parseCantonReporte(undefined)).toBeUndefined();
    expect(parseCantonReporte('')).toBeUndefined();
    expect(parseCantonReporte('3')).toBe(3);
  });

  it.each(['abc', '0', '-1', '1.5', '99999999999'])('rechaza %s con 400', (v) => {
    expect(() => parseCantonReporte(v)).toThrow('cantonId inválido');
  });
});
