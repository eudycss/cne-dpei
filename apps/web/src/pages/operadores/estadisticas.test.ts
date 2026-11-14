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
