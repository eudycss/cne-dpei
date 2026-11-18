import { describe, expect, it } from 'vitest';
import {
  LIMITES_PERIMETRO,
  crearPlanPerimetroSchema,
  guardarPlanPerimetroSchema,
  vallaPerimetroSchema,
  vistaPerimetroSchema,
} from './perimetro';
import { MODULOS_WEB } from './modulos';
import { PERMISOS } from './permisos';

const EVENTO = '11111111-1111-4111-8111-111111111111';
const P1 = '22222222-2222-4222-8222-222222222222';
const ANILLO: [number, number][] = [
  [0.35, -78.11],
  [0.351, -78.11],
  [0.351, -78.111],
];

describe('crearPlanPerimetroSchema', () => {
  it('acepta un plan mínimo y completa los valores de fábrica', () => {
    const r = crearPlanPerimetroSchema.parse({ eventoId: EVENTO, nombre: '  Coliseo  ' });
    expect(r.nombre).toBe('Coliseo');
    expect(r).toMatchObject({ lugar: null, perimetro: null, zonas: [], vallas: [], puestos: [], vista: null });
    expect(r.ajustes).toEqual({ pctMujeres: 50, largoValla: 2.5, mostrarNombres: true, alinearVallas: true });
  });

  it('acepta perímetro, zonas, vallas y puestos con y sin persona', () => {
    const r = crearPlanPerimetroSchema.parse({
      eventoId: EVENTO,
      nombre: 'Delegación',
      perimetro: ANILLO,
      zonas: [{ id: 'z1', tipo: 'acceso', nombre: 'Puerta', coords: ANILLO }],
      vallas: [{ id: 'v1', lat: 0.35, lng: -78.11, angulo: 200 }],
      puestos: [{ lat: 0.35, lng: -78.11, operadorCdaId: P1 }, { lat: 0.35, lng: -78.11, etiqueta: 'Policía 1' }],
    });
    expect(r.vallas[0].angulo).toBe(20);
    expect(r.puestos[1]).toEqual({ lat: 0.35, lng: -78.11, operadorCdaId: null, etiqueta: 'Policía 1' });
  });

  it('rechaza a la misma persona en dos puestos', () => {
    const r = crearPlanPerimetroSchema.safeParse({
      eventoId: EVENTO,
      nombre: 'X',
      puestos: [{ lat: 0, lng: 0, operadorCdaId: P1 }, { lat: 1, lng: 1, operadorCdaId: P1 }],
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe('Una persona está en más de un puesto');
  });

  it('rechaza ids de zona o valla repetidos', () => {
    const zonas = crearPlanPerimetroSchema.safeParse({
      eventoId: EVENTO,
      nombre: 'X',
      zonas: [
        { id: 'a', tipo: 'segura', nombre: 'A', coords: ANILLO },
        { id: 'a', tipo: 'segura', nombre: 'B', coords: ANILLO },
      ],
    });
    const vallas = crearPlanPerimetroSchema.safeParse({
      eventoId: EVENTO,
      nombre: 'X',
      vallas: [{ id: 'v', lat: 0, lng: 0, angulo: 0 }, { id: 'v', lat: 0, lng: 0, angulo: 0 }],
    });
    expect(zonas.success).toBe(false);
    expect(vallas.success).toBe(false);
  });

  it('rechaza coordenadas fuera de rango, anillos cortos y tipos de zona desconocidos', () => {
    const base = { eventoId: EVENTO, nombre: 'X' };
    expect(crearPlanPerimetroSchema.safeParse({ ...base, puestos: [{ lat: 91, lng: 0 }] }).success).toBe(false);
    expect(crearPlanPerimetroSchema.safeParse({ ...base, perimetro: ANILLO.slice(0, 2) }).success).toBe(false);
    expect(
      crearPlanPerimetroSchema.safeParse({ ...base, zonas: [{ id: 'z', tipo: 'otra', nombre: 'Z', coords: ANILLO }] }).success,
    ).toBe(false);
    expect(crearPlanPerimetroSchema.safeParse({ ...base, puestos: [{ lat: Number.NaN, lng: 0 }] }).success).toBe(false);
  });

  it('respeta los límites de puestos y de puntos del anillo', () => {
    const base = { eventoId: EVENTO, nombre: 'X' };
    const puestos = Array.from({ length: LIMITES_PERIMETRO.maxPuestos + 1 }, () => ({ lat: 0, lng: 0 }));
    const anillo = Array.from({ length: LIMITES_PERIMETRO.maxPuntosAnillo + 1 }, () => [0, 0]);
    expect(crearPlanPerimetroSchema.safeParse({ ...base, puestos }).success).toBe(false);
    expect(crearPlanPerimetroSchema.safeParse({ ...base, perimetro: anillo }).success).toBe(false);
  });

  it('rechaza nombres vacíos, con caracteres de control o campos desconocidos', () => {
    expect(crearPlanPerimetroSchema.safeParse({ eventoId: EVENTO, nombre: '   ' }).success).toBe(false);
    expect(crearPlanPerimetroSchema.safeParse({ eventoId: EVENTO, nombre: 'a\u0007b' }).success).toBe(false);
    expect(crearPlanPerimetroSchema.safeParse({ eventoId: EVENTO, nombre: 'X', cedula: '1' }).success).toBe(false);
    expect(crearPlanPerimetroSchema.safeParse({ eventoId: 'no-uuid', nombre: 'X' }).success).toBe(false);
  });
});

describe('guardarPlanPerimetroSchema', () => {
  it('exige la versión leída y no acepta cambiar de evento', () => {
    expect(guardarPlanPerimetroSchema.safeParse({ nombre: 'X' }).success).toBe(false);
    expect(guardarPlanPerimetroSchema.safeParse({ nombre: 'X', version: 3 }).success).toBe(true);
    expect(guardarPlanPerimetroSchema.safeParse({ nombre: 'X', version: -1 }).success).toBe(false);
    expect(guardarPlanPerimetroSchema.safeParse({ nombre: 'X', version: 1.5 }).success).toBe(false);
    expect(guardarPlanPerimetroSchema.safeParse({ nombre: 'X', version: 0, eventoId: EVENTO }).success).toBe(false);
  });
});

describe('vista y vallas', () => {
  it('normaliza el giro a [-180, 180) y limita la inclinación 3D', () => {
    expect(vistaPerimetroSchema.parse({ lat: 0, lng: 0, zoom: 18, bearing: 270 }).bearing).toBe(-90);
    expect(vistaPerimetroSchema.parse({ lat: 0, lng: 0, zoom: 18 })).toMatchObject({ bearing: 0, pitch: 0 });
    expect(vistaPerimetroSchema.safeParse({ lat: 0, lng: 0, zoom: 18, pitch: 90 }).success).toBe(false);
  });

  it('el ángulo de la valla queda en [0, 180)', () => {
    expect(vallaPerimetroSchema.parse({ id: 'v', lat: 0, lng: 0, angulo: -30 }).angulo).toBe(150);
    expect(vallaPerimetroSchema.parse({ id: 'v', lat: 0, lng: 0, angulo: 180 }).angulo).toBe(0);
  });
});

describe('catálogo', () => {
  it('el módulo y la acción de editar existen y la acción cuelga del módulo', () => {
    expect(MODULOS_WEB.find((m) => m.id === 'plan-perimetro')?.ruta).toBe('/plan-perimetro');
    expect(PERMISOS.find((p) => p.id === 'perimetro.planes.editar')?.modulo).toBe('plan-perimetro');
  });
});
