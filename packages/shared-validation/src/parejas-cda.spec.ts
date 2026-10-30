import { describe, expect, it } from 'vitest';
import {
  copiarParejasCdaSchema,
  crearParejaCdaSchema,
  editarParejaCdaSchema,
  fechaParejaCdaSchema,
  filaParejaCdaSchema,
  intercambiarParejaCdaSchema,
} from './index';

const OP = '11111111-1111-4111-8111-111111111111';
const AS = '22222222-2222-4222-8222-222222222222';
const RE = '33333333-3333-4333-8333-333333333333';
// Cédulas ecuatorianas válidas (dígito verificador correcto).
const CEDULA_OP = '1710034065';
const CEDULA_AS = '1713175071';

describe('parejas CDA por día', () => {
  it('fecha: solo AAAA-MM-DD de un día que existe', () => {
    expect(fechaParejaCdaSchema.safeParse('2026-10-30').success).toBe(true);
    for (const f of ['30/10/2026', '2026-02-30', '2026-13-01', '', '2026-10-30T00:00']) {
      expect(fechaParejaCdaSchema.safeParse(f).success).toBe(false);
    }
  });

  it('alta manual: operador y recinto obligatorios; asistente y artículos opcionales', () => {
    expect(crearParejaCdaSchema.safeParse({ fecha: '2026-10-30', operadorCdaId: OP, recintoId: RE }).success).toBe(true);
    expect(
      crearParejaCdaSchema.safeParse({ fecha: '2026-10-30', operadorCdaId: OP, asistenteCdaId: AS, recintoId: RE, articulos: 'LAP:123, MOD' })
        .success,
    ).toBe(true);
    expect(crearParejaCdaSchema.safeParse({ fecha: '2026-10-30', operadorCdaId: OP }).success).toBe(false);
    expect(crearParejaCdaSchema.safeParse({ fecha: '2026-10-30', operadorCdaId: OP, recintoId: RE, extra: 1 }).success).toBe(false);
  });

  it('el asistente no puede ser el mismo operador', () => {
    expect(crearParejaCdaSchema.safeParse({ fecha: '2026-10-30', operadorCdaId: OP, asistenteCdaId: OP, recintoId: RE }).success).toBe(false);
  });

  it('cambiar: al menos un dato; quitar el asistente con null', () => {
    expect(editarParejaCdaSchema.safeParse({ asistenteCdaId: null }).success).toBe(true);
    expect(editarParejaCdaSchema.safeParse({ recintoId: RE }).success).toBe(true);
    expect(editarParejaCdaSchema.safeParse({}).success).toBe(false);
  });

  it('fila de la plantilla: cédula del operador y código de recinto obligatorios', () => {
    const fila = filaParejaCdaSchema.safeParse({
      cedula_operador: CEDULA_OP,
      nombre_operador: ' PÉREZ ANA ',
      cedula_asistente: CEDULA_AS,
      codigo_recinto: ' 957 ',
    });
    expect(fila.success && fila.data).toMatchObject({ nombre_operador: 'PÉREZ ANA', codigo_recinto: '957' });
    expect(filaParejaCdaSchema.safeParse({ cedula_operador: '123', codigo_recinto: '957' }).success).toBe(false);
    expect(filaParejaCdaSchema.safeParse({ cedula_operador: CEDULA_OP }).success).toBe(false);
    expect(filaParejaCdaSchema.safeParse({ cedula_operador: CEDULA_OP, cedula_asistente: CEDULA_OP, codigo_recinto: '957' }).success).toBe(
      false,
    );
  });

  it('copiar: dos días válidos y distintos; nada más', () => {
    expect(copiarParejasCdaSchema.safeParse({ desde: '2026-10-28', hacia: '2026-11-04' }).success).toBe(true);
    expect(copiarParejasCdaSchema.safeParse({ desde: '2026-10-28', hacia: '2026-10-28' }).success).toBe(false);
    expect(copiarParejasCdaSchema.safeParse({ desde: '2026-10-28', hacia: '04/11/2026' }).success).toBe(false);
    expect(copiarParejasCdaSchema.safeParse({ desde: '2026-10-28' }).success).toBe(false);
    expect(copiarParejasCdaSchema.safeParse({ desde: '2026-10-28', hacia: '2026-11-04', aplicar: true }).success).toBe(false);
  });

  it('intercambiar: con otra pareja y uno de los tres campos; nada más', () => {
    expect(intercambiarParejaCdaSchema.safeParse({ conId: OP, campo: 'RECINTO' }).success).toBe(true);
    expect(intercambiarParejaCdaSchema.safeParse({ conId: OP, campo: 'OPERADOR', justificacion: 'Cambio de última hora' }).success).toBe(true);
    expect(intercambiarParejaCdaSchema.safeParse({ conId: OP, campo: 'ASISTENTE' }).success).toBe(true);
    expect(intercambiarParejaCdaSchema.safeParse({ conId: 'x', campo: 'RECINTO' }).success).toBe(false);
    expect(intercambiarParejaCdaSchema.safeParse({ conId: OP, campo: 'KIT' }).success).toBe(false);
    expect(intercambiarParejaCdaSchema.safeParse({ conId: OP }).success).toBe(false);
    expect(intercambiarParejaCdaSchema.safeParse({ conId: OP, campo: 'RECINTO', extra: 1 }).success).toBe(false);
  });
});
