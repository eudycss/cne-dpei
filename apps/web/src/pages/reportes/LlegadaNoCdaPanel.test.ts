import { describe, expect, it } from 'vitest';
import type { ReporteNoCdaDetalle, ReporteNoCdaItem } from '@cne/shared-types';
import { filasDetalleNoCda, gruposPorJuntas, ordenarNoCdas } from './LlegadaNoCdaPanel';

const nc = (id: string, juntas: number, llegadaEn: string | null, extra: Partial<ReporteNoCdaDetalle> = {}): ReporteNoCdaDetalle => ({
  id,
  codigoRecinto: id,
  nombre: `Escuela ${id}`,
  cantonNombre: 'IBARRA',
  juntasFemeninas: juntas,
  juntasMasculinas: 0,
  juntas,
  electores: 100,
  llegado: llegadaEn !== null,
  llegadaEn,
  registradoPor: llegadaEn ? 'Ana Pérez' : null,
  ...extra,
});

const cda = (codigo: string, noCdas: ReporteNoCdaDetalle[]): ReporteNoCdaItem => ({
  cdaId: codigo,
  cdaCodigo: codigo,
  cdaNombre: `CDA ${codigo}`,
  cantonNombre: 'IBARRA',
  operadorNombre: 'Ana Pérez',
  operadorCedula: '1',
  kitsCodigos: [],
  totalNoCdas: noCdas.length,
  totalLlegados: noCdas.filter((n) => n.llegado).length,
  juntasNoCdas: noCdas.reduce((s, n) => s + n.juntas, 0),
  juntasLlegadas: noCdas.filter((n) => n.llegado).reduce((s, n) => s + n.juntas, 0),
  noCdas,
});

describe('gruposPorJuntas', () => {
  const datos = [
    cda('A', [nc('a1', 4, '2026-11-29T23:00:00Z')]), // 100 %
    cda('B', [nc('b1', 4, null), nc('b2', 4, '2026-11-29T23:10:00Z')]), // 50 %
    cda('C', [nc('c1', 2, null)]), // 0 %
    cda('D', []), // sin NO CDA: no aparece
  ];

  it('por CDA: del que menos avanzó al que más, en juntas, sin los CDA vacíos', () => {
    expect(gruposPorJuntas(datos, 'cda')).toEqual([
      { nombre: 'C · CDA C', hechos: 0, total: 2 },
      { nombre: 'B · CDA B', hechos: 4, total: 8 },
      { nombre: 'A · CDA A', hechos: 4, total: 4 },
    ]);
  });

  it('a igual avance, primero el que tiene más juntas pendientes', () => {
    const empate = [cda('X', [nc('x1', 1, null)]), cda('Y', [nc('y1', 9, null)])];
    expect(gruposPorJuntas(empate, 'cda').map((g) => g.nombre)).toEqual(['Y · CDA Y', 'X · CDA X']);
  });

  it('sin juntas en el distributivo mide por recintos (no aparece como completo)', () => {
    expect(gruposPorJuntas([cda('Z', [nc('z1', 0, null), nc('z2', 0, '2026-11-29T23:00:00Z')])], 'cda')).toEqual([
      { nombre: 'Z · CDA Z', hechos: 1, total: 2 },
    ]);
  });

  it('por cantón: suma las juntas de los NO CDA de cada cantón', () => {
    const porCanton = gruposPorJuntas(
      [cda('A', [nc('a1', 3, null, { cantonNombre: 'URCUQUI' }), nc('a2', 5, '2026-11-29T23:00:00Z')])],
      'canton',
    );
    expect(porCanton).toEqual([
      { nombre: 'URCUQUI', hechos: 0, total: 3 },
      { nombre: 'IBARRA', hechos: 5, total: 5 },
    ]);
  });
});

describe('ordenarNoCdas', () => {
  it('pendientes primero (por nombre) y luego los que llegaron, en orden de llegada', () => {
    const orden = ordenarNoCdas([
      nc('n3', 1, '2026-11-29T23:30:00Z'),
      nc('n2', 1, null),
      nc('n4', 1, '2026-11-29T23:05:00Z'),
      nc('n1', 1, null),
    ]);
    expect(orden.map((n) => n.id)).toEqual(['n1', 'n2', 'n4', 'n3']);
  });

  it('un llegado sin hora va al final de los llegados', () => {
    const sinHora = nc('n0', 1, null, { llegado: true });
    const orden = ordenarNoCdas([sinHora, nc('n9', 1, '2026-11-29T23:30:00Z'), nc('n5', 1, null)]);
    expect(orden.map((n) => n.id)).toEqual(['n5', 'n9', 'n0']);
  });
});

describe('filasDetalleNoCda', () => {
  it('una fila por NO CDA con juntas, estado, hora y quién marcó', () => {
    const filas = filasDetalleNoCda([cda('A', [nc('a1', 4, '2026-11-29T23:42:00Z'), nc('a2', 2, null)])]);

    expect(filas[0]).toEqual(['CDA', 'Código NO CDA', 'NO CDA', 'Cantón', 'JF', 'JM', 'Juntas', 'Electores', 'Estado', 'Hora de llegada', 'Marcó']);
    expect(filas[1]).toEqual(['A — CDA A', 'a2', 'Escuela a2', 'IBARRA', 2, 0, 2, 100, 'Pendiente', '', '']);
    expect(filas[2].slice(8)).toEqual(['Llegó', expect.stringMatching(/\d{2}:\d{2}/), 'Ana Pérez']);
  });
});
