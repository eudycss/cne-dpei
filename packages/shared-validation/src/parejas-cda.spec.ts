import { describe, expect, it } from 'vitest';
import {
  asignarRecintoParejaCdaSchema,
  CODIGO_RESERVA_PAREJAS_CDA,
  cambiarDispositivoOperadorCdaSchema,
  copiarParejasCdaSchema,
  crearParejaCdaSchema,
  editarParejaCdaSchema,
  fechaParejaCdaSchema,
  fechasHistorialParejasCdaSchema,
  cargarPropuestaParejasCdaSchema,
  propuestaParejasCdaSchema,
  filaParejaCdaSchema,
  MENSAJE_FILA_SIN_OPERADOR_CDA,
  intercambiarParejaCdaSchema,
  tecnicosReporteParejasCdaSchema,
} from './index';

const OP = '11111111-1111-4111-8111-111111111111';
const AS = '22222222-2222-4222-8222-222222222222';
const RE = '33333333-3333-4333-8333-333333333333';
// Cédulas ecuatorianas válidas (dígito verificador correcto).
const CEDULA_OP = '1710034065';
const CEDULA_AS = '1713175071';

describe('historial de parejas CDA', () => {
  it('?fechas= acepta una (texto) o varias (arreglo), sin repetir y ordenadas', () => {
    expect(fechasHistorialParejasCdaSchema.parse('2026-10-28')).toEqual(['2026-10-28']);
    expect(fechasHistorialParejasCdaSchema.parse(['2026-11-01', '2026-10-28', '2026-11-01'])).toEqual(['2026-10-28', '2026-11-01']);
  });

  it('?fechas= rechaza vacío, fechas inválidas o más de 20', () => {
    const muchas = Array.from({ length: 21 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
    for (const v of [undefined, [], '', '2026-02-30', ['2026-10-28', 'ayer'], muchas, [20261028]]) {
      expect(fechasHistorialParejasCdaSchema.safeParse(v).success).toBe(false);
    }
  });
});

describe('propuesta de parejas CDA', () => {
  const R = '33333333-3333-4333-8333-333333333333';

  it('pide la fecha nueva y al menos una de referencia; los recintos extra son opcionales', () => {
    expect(propuestaParejasCdaSchema.parse({ fecha: '2026-11-10', referencia: ['2026-11-01', '2026-10-28'] })).toEqual({
      fecha: '2026-11-10',
      referencia: ['2026-10-28', '2026-11-01'],
      extras: [],
    });
    expect(propuestaParejasCdaSchema.parse({ fecha: '2026-11-10', referencia: '2026-10-28', extras: [R] }).extras).toEqual([R]);
  });

  it('rechaza la fecha nueva igual a una de referencia, recintos inválidos o campos de más', () => {
    for (const v of [
      { fecha: '2026-10-28', referencia: ['2026-10-28'] },
      { fecha: '2026-11-10', referencia: [] },
      { fecha: '2026-11-10', referencia: ['2026-10-28'], extras: ['x'] },
      { fecha: '2026-11-10', referencia: ['2026-10-28'], otro: 1 },
    ]) {
      expect(propuestaParejasCdaSchema.safeParse(v).success).toBe(false);
    }
  });

  it('la propuesta editada lleva cédulas y código de recinto; al menos una fila', () => {
    expect(cargarPropuestaParejasCdaSchema.safeParse({ filas: [{ cedulaOperador: CEDULA_OP, cedulaAsistente: null, codigoRecinto: '971' }] }).success).toBe(true);
    expect(cargarPropuestaParejasCdaSchema.safeParse({ filas: [] }).success).toBe(false);
    expect(cargarPropuestaParejasCdaSchema.safeParse({ filas: [{ cedulaOperador: CEDULA_OP, codigoRecinto: '971', nombre: 'x' }] }).success).toBe(false);
  });
});

describe('reporte por técnico de parejas CDA', () => {
  it('?tecnicos= acepta uno (texto) o varios (arreglo), sin repetir ni espacios sobrantes', () => {
    expect(tecnicosReporteParejasCdaSchema.parse('Ing. Jairo Leal')).toEqual(['Ing. Jairo Leal']);
    expect(tecnicosReporteParejasCdaSchema.parse([' Jairo ', 'Jairo', 'SIN_TECNICO'])).toEqual(['Jairo', 'SIN_TECNICO']);
  });

  it('?tecnicos= rechaza vacío, nombres muy largos o demasiados técnicos', () => {
    for (const v of [undefined, [], '', ['   '], ['x'.repeat(121)], Array.from({ length: 31 }, (_, i) => `T${i}`), [3]]) {
      expect(tecnicosReporteParejasCdaSchema.safeParse(v).success).toBe(false);
    }
  });
});

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

  it('cambiar: "pasa a reserva" acompaña a un cambio, no basta solo', () => {
    expect(editarParejaCdaSchema.safeParse({ asistenteCdaId: null, saleAReserva: true }).success).toBe(true);
    expect(editarParejaCdaSchema.safeParse({ saleAReserva: true }).success).toBe(false);
    expect(editarParejaCdaSchema.safeParse({ saleAReserva: true, justificacion: 'x' }).success).toBe(false);
    expect(editarParejaCdaSchema.safeParse({ operadorCdaId: OP, saleAReserva: 'si' }).success).toBe(false);
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

  it('dispositivo: Android, iPhone o ninguno; nada más', () => {
    expect(cambiarDispositivoOperadorCdaSchema.safeParse({ dispositivo: 'ANDROID' }).success).toBe(true);
    expect(cambiarDispositivoOperadorCdaSchema.safeParse({ dispositivo: 'IPHONE' }).success).toBe(true);
    expect(cambiarDispositivoOperadorCdaSchema.safeParse({ dispositivo: null }).success).toBe(true);
    expect(cambiarDispositivoOperadorCdaSchema.safeParse({ dispositivo: 'iPhone' }).success).toBe(false);
    expect(cambiarDispositivoOperadorCdaSchema.safeParse({}).success).toBe(false);
    expect(cambiarDispositivoOperadorCdaSchema.safeParse({ dispositivo: 'ANDROID', extra: 1 }).success).toBe(false);
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

  it('asignar recinto a una pareja de reserva: un recinto y, si va, la justificación; nada más', () => {
    expect(asignarRecintoParejaCdaSchema.safeParse({ recintoId: RE }).success).toBe(true);
    expect(asignarRecintoParejaCdaSchema.safeParse({ recintoId: RE, justificacion: 'Reemplazo' }).success).toBe(true);
    expect(asignarRecintoParejaCdaSchema.safeParse({ recintoId: '957' }).success).toBe(false);
    expect(asignarRecintoParejaCdaSchema.safeParse({}).success).toBe(false);
    expect(asignarRecintoParejaCdaSchema.safeParse({ recintoId: RE, kitId: OP }).success).toBe(false);
  });

  it('una reserva puede ir con solo el asistente; un recinto, nunca sin operador', () => {
    const solo = (codigo: string, extra: Record<string, string> = {}) =>
      filaParejaCdaSchema.safeParse({ cedula_operador: '', telefono_operador: '', telefono_asistente: '', codigo_recinto: codigo, ...extra });
    expect(solo(CODIGO_RESERVA_PAREJAS_CDA, { cedula_asistente: CEDULA_AS }).success).toBe(true);
    expect(solo('reserva', { cedula_asistente: CEDULA_AS }).success).toBe(true);
    const enRecinto = solo('957', { cedula_asistente: CEDULA_AS });
    expect(enRecinto.success).toBe(false);
    expect(enRecinto.error?.issues[0]).toMatchObject({ path: ['cedula_operador'], message: MENSAJE_FILA_SIN_OPERADOR_CDA });
    // Una reserva vacía tampoco.
    expect(solo(CODIGO_RESERVA_PAREJAS_CDA).success).toBe(false);
  });

  it('la plantilla acepta RESERVA como código de recinto', () => {
    const r = filaParejaCdaSchema.safeParse({ cedula_operador: CEDULA_OP, telefono_operador: '', telefono_asistente: '', codigo_recinto: CODIGO_RESERVA_PAREJAS_CDA });
    expect(r.success).toBe(true);
  });
});
