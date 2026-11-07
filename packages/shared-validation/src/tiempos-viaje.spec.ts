import { describe, it, expect } from 'vitest';
import { guardarTiemposViajeSchema, minutosTiempoViajeSchema } from './index';

const R1 = '11111111-1111-4111-8111-111111111111';
const R2 = '22222222-2222-4222-8222-222222222222';

describe('tiempos de viaje por recinto', () => {
  it('minutos: enteros entre 5 y 600', () => {
    expect(minutosTiempoViajeSchema.safeParse(45).success).toBe(true);
    expect(minutosTiempoViajeSchema.safeParse(4).success).toBe(false);
    expect(minutosTiempoViajeSchema.safeParse(601).success).toBe(false);
    expect(minutosTiempoViajeSchema.safeParse(30.5).success).toBe(false);
    expect(minutosTiempoViajeSchema.safeParse('45').success).toBe(false);
  });

  it('guardar: uno o varios recintos; null quita el tiempo', () => {
    expect(guardarTiemposViajeSchema.safeParse({ tiempos: [{ recintoId: R1, minutos: 60 }, { recintoId: R2, minutos: null }] }).success).toBe(true);
    expect(guardarTiemposViajeSchema.safeParse({ tiempos: [] }).success).toBe(false);
  });

  it('guardar: rechaza recintos repetidos, ids inválidos y campos de más', () => {
    expect(guardarTiemposViajeSchema.safeParse({ tiempos: [{ recintoId: R1, minutos: 60 }, { recintoId: R1, minutos: 90 }] }).success).toBe(false);
    expect(guardarTiemposViajeSchema.safeParse({ tiempos: [{ recintoId: 'x', minutos: 60 }] }).success).toBe(false);
    expect(guardarTiemposViajeSchema.safeParse({ tiempos: [{ recintoId: R1, minutos: 60, nombre: 'x' }] }).success).toBe(false);
    expect(guardarTiemposViajeSchema.safeParse({ tiempos: [{ recintoId: R1, minutos: 60 }], extra: 1 }).success).toBe(false);
  });
});
