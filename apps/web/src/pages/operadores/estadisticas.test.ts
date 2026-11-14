import { describe, expect, it } from 'vitest';
import type { EstadisticasJornadaDto, UnidadEstadisticaJornada } from '@cne/shared-types';
import { agrupar, avanceNoCda, avancePorEtapa, embudo, ordenarPorAvance } from './estadisticas';

const unidad = (cantonNombre: string, tecnicoNombre: string, salidaDpiEn: string | null, llegadaRecintoEn: string | null = null): UnidadEstadisticaJornada => ({
  codigoRecinto: 'C',
  nombreRecinto: 'R',
  cantonNombre,
  tecnicoNombre,
  operadorNombre: null,
  asistenteNombre: null,
  salidaDpiEn,
  llegadaRecintoEn,
  salidaRecintoEn: null,
  llegadaDpiEn: null,
});

const datos: EstadisticasJornadaDto = {
  evento: 'Simulacro',
  sinDistributivo: false,
  unidades: [
    unidad('IBARRA', 'Isidro', '2026-11-15T12:00:00Z', '2026-11-15T13:00:00Z'),
    unidad('IBARRA', 'Jairo', '2026-11-15T12:10:00Z'),
    unidad('OTAVALO', 'Isidro', null),
    unidad('COTACACHI', '', '2026-11-15T12:20:00Z'),
  ],
  noCdas: [
    { codigoRecinto: 'N1', nombreRecinto: 'N', codigoCda: 'C', nombreCda: 'R', cantonNombre: 'IBARRA', tecnicoNombre: 'Isidro', llegadaEn: '2026-11-15T14:00:00Z' },
    { codigoRecinto: 'N2', nombreRecinto: 'N', codigoCda: 'C', nombreCda: 'R', cantonNombre: 'OTAVALO', tecnicoNombre: 'Isidro', llegadaEn: null },
  ],
};

describe('estadísticas de la jornada', () => {
  it('ordena del mayor al menor porcentaje, desempatando por total y nombre', () => {
    const r = ordenarPorAvance([
      { nombre: 'B', hechos: 1, total: 2 },
      { nombre: 'A', hechos: 1, total: 2 },
      { nombre: 'C', hechos: 3, total: 3 },
      { nombre: 'D', hechos: 2, total: 4 },
      { nombre: 'E', hechos: 0, total: 0 },
    ]);
    expect(r.map((g) => g.nombre)).toEqual(['C', 'D', 'A', 'B', 'E']);
  });

  it('agrupa por cantón con el avance de cada etapa', () => {
    const r = avancePorEtapa(datos, 'salidaDpiEn', 'canton');
    expect(r).toEqual([
      { nombre: 'COTACACHI', hechos: 1, total: 1 },
      { nombre: 'IBARRA', hechos: 2, total: 2 },
      { nombre: 'OTAVALO', hechos: 0, total: 1 },
    ].sort((a, b) => (b.hechos * a.total) - (a.hechos * b.total) || b.total - a.total));
  });

  it('un técnico vacío va como "Sin técnico"', () => {
    const r = avancePorEtapa(datos, 'salidaDpiEn', 'tecnico');
    expect(r.map((g) => g.nombre)).toContain('Sin técnico');
  });

  it('las llegadas a NO CDA se agrupan igual', () => {
    expect(avanceNoCda(datos, 'canton')).toEqual([
      { nombre: 'IBARRA', hechos: 1, total: 1 },
      { nombre: 'OTAVALO', hechos: 0, total: 1 },
    ]);
  });

  it('el embudo cuenta cuántas parejas completaron cada etapa', () => {
    expect(embudo(datos).map((e) => e.hechos)).toEqual([3, 1, 0, 0]);
    expect(agrupar([], () => 'x', () => true)).toEqual([]);
  });
});

import { opcionesFiltro, ordenNoCda, ordenPorEtapa } from './estadisticas';

describe('orden de llegada', () => {
  const conCodigo = (codigo: string, canton: string, tecnico: string, llegada: string | null) => ({
    ...unidad(canton, tecnico, null, llegada),
    codigoRecinto: codigo,
  });
  const base: EstadisticasJornadaDto = {
    evento: 'S',
    sinDistributivo: false,
    unidades: [
      conCodigo('B', 'IBARRA', 'Isidro', '2026-11-15T13:00:00Z'),
      conCodigo('A', 'OTAVALO', '', '2026-11-15T12:00:00Z'),
      conCodigo('D', 'IBARRA', 'Jairo', null),
      conCodigo('C', 'IBARRA', 'Isidro', '2026-11-15T13:00:00Z'),
    ],
    noCdas: datos.noCdas,
  };
  const todos = { canton: '', tecnico: '' };

  it('numera por hora (misma hora, mismo N.º); las pendientes solo se cuentan', () => {
    const r = ordenPorEtapa(base, 'llegadaRecintoEn', todos);
    expect(r.filas.map((f) => [f.orden, f.codigoRecinto])).toEqual([[1, 'A'], [2, 'B'], [2, 'C']]);
    expect(r.pendientes).toBe(1);
  });

  it('la misma hora (al minuto) lleva el mismo N.º y descarta horas inválidas', () => {
    const d = {
      ...base,
      unidades: [
        conCodigo('A', 'IBARRA', 'X', '2026-11-15T12:00:10Z'),
        conCodigo('B', 'IBARRA', 'X', '2026-11-15T12:00:50Z'),
        conCodigo('C', 'IBARRA', 'X', '2026-11-15T12:01:00Z'),
        conCodigo('D', 'IBARRA', 'X', 'no-es-fecha'),
      ],
    };
    const r = ordenPorEtapa(d, 'llegadaRecintoEn', todos);
    expect(r.filas.map((f) => [f.orden, f.codigoRecinto])).toEqual([[1, 'A'], [1, 'B'], [3, 'C']]);
    expect(r.pendientes).toBe(1);
  });

  it('filtra por cantón y por técnico (vacío = "Sin técnico")', () => {
    expect(ordenPorEtapa(base, 'llegadaRecintoEn', { canton: 'IBARRA', tecnico: '' }).filas).toHaveLength(2);
    const r = ordenPorEtapa(base, 'llegadaRecintoEn', { canton: '', tecnico: 'Sin técnico' });
    expect(r.filas.map((f) => f.codigoRecinto)).toEqual(['A']);
    expect(r.filas[0].tecnicoNombre).toBe('Sin técnico');
  });

  it('ordena las llegadas a NO CDA y cuenta las sin visita', () => {
    const r = ordenNoCda(datos, todos);
    expect(r.filas.map((f) => f.codigoRecinto)).toEqual(['N1']);
    expect(r.pendientes).toBe(1);
  });

  it('ofrece cantones y técnicos únicos y ordenados', () => {
    expect(opcionesFiltro(base, 'canton')).toEqual(['IBARRA', 'OTAVALO']);
    expect(opcionesFiltro(base, 'tecnico')).toEqual(['Isidro', 'Jairo', 'Sin técnico']);
  });
});
