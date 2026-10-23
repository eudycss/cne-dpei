import { describe, expect, it } from 'vitest';
import {
  MARGEN_LLEGADA_MAX_METROS,
  bulkRecintoRowSchema,
  createRecintoSchema,
  updateRecintoSchema,
  cedulaSchema,
  avisosEnlacesSchema,
  configAlertasSchema,
  isValidCedulaEcuatoriana,
  llegadaDpiSchema,
  llegadaNoCdaSchema,
  llegadaRecintoSchema,
  pruebaConexionSchema,
  recepcionKitSchema,
  reopenEventoSchema,
  salidaDpiSchema,
  salidaRecintoSchema,
  telefonoSchema,
  operadorCdaFilaSchema,
  marcarAsistenciaCdaSchema,
  marcarAsistenciaCdaMasivaSchema,
  generarActasCdaSchema,
  descargarActasCdaSchema,
  diaAsistenciaSchema,
} from './index';

describe('configAlertasSchema', () => {
  const base = { umbralLlegadaRecintoMin: 120, umbralLlegadaDpiMin: 120, umbralSinSyncMin: 30 };

  it('acepta márgenes de decenas de km para eventos de prueba', () => {
    expect(configAlertasSchema.safeParse({ ...base, margenLlegadaMetros: 60_000 }).success).toBe(true);
    expect(
      configAlertasSchema.safeParse({ ...base, margenLlegadaMetros: MARGEN_LLEGADA_MAX_METROS }).success,
    ).toBe(true);
  });

  it('rechaza márgenes fuera de 10 m – 200 km o no enteros', () => {
    expect(configAlertasSchema.safeParse({ ...base, margenLlegadaMetros: 9 }).success).toBe(false);
    expect(
      configAlertasSchema.safeParse({ ...base, margenLlegadaMetros: MARGEN_LLEGADA_MAX_METROS + 1 }).success,
    ).toBe(false);
    expect(configAlertasSchema.safeParse({ ...base, margenLlegadaMetros: 150.5 }).success).toBe(false);
  });
});

describe('isValidCedulaEcuatoriana / cedulaSchema', () => {
  // Cédulas construidas con el algoritmo módulo-10 oficial (coeficientes
  // [2,1,2,1,2,1,2,1,2], verificador = 10 - (suma % 10), o 0 si suma % 10 === 0)
  // y verificadas de forma independiente antes de usarse como fixtures.
  const casosValidos: Array<[string, string]> = [
    ['0100001007', 'provincia límite 01, tercer dígito 0'],
    ['2461234565', 'provincia límite 24, tercer dígito 6'],
    ['1034567899', 'provincia 10 (Imbabura), tercer dígito 3'],
    ['1750123455', 'provincia 17 (Pichincha), tercer dígito 5'],
  ];

  it.each(casosValidos)('acepta %s (%s)', (cedula) => {
    expect(isValidCedulaEcuatoriana(cedula)).toBe(true);
    expect(cedulaSchema.safeParse(cedula).success).toBe(true);
  });

  const casosInvalidos: Array<[string, string]> = [
    ['2500001007', 'provincia 25 fuera de rango (>24)'],
    ['0000001007', 'provincia 00 fuera de rango (<01)'],
    ['0170001007', 'tercer dígito 7 (fuera de 0-6)'],
    ['0190001007', 'tercer dígito 9 (fuera de 0-6)'],
    ['0100001001', 'dígito verificador incorrecto'],
    ['123456789', 'longitud corta (9 dígitos)'],
    ['12345678901', 'longitud larga (11 dígitos)'],
    ['abcdefghij', 'no numérica'],
    ['', 'cadena vacía'],
  ];

  it.each(casosInvalidos)('rechaza %s (%s)', (cedula) => {
    expect(isValidCedulaEcuatoriana(cedula)).toBe(false);
    expect(cedulaSchema.safeParse(cedula).success).toBe(false);
  });
});

describe('telefonoSchema', () => {
  const casosValidos: Array<[string, string]> = [
    ['0991234567', 'celular nacional sin formato'],
    ['+593991234567', 'celular con prefijo internacional'],
    ['099-123-4567', 'celular con guiones'],
    ['0991 234 567', 'celular con espacios'],
    ['(0991234567)', 'celular con paréntesis envolventes'],
    ['+593 99 123 4567', 'celular internacional con espacios'],
  ];

  it.each(casosValidos)('acepta %s (%s)', (telefono) => {
    const resultado = telefonoSchema.safeParse(telefono);
    expect(resultado.success).toBe(true);
  });

  const casosInvalidos: Array<[string, string]> = [
    ['022345678', 'fijo (código de área 02, no celular)'],
    ['062345678', 'fijo (código de área 06)'],
    ['099123456', 'celular corto (9 dígitos tras el 0)'],
    ['09912345678', 'celular largo (11 dígitos tras el 0)'],
    ['+59399123456', 'celular corto con prefijo internacional'],
    ['0891234567', 'no empieza con 09'],
    ['abcdefghij', 'no numérico'],
  ];

  it.each(casosInvalidos)('rechaza %s (%s)', (telefono) => {
    const resultado = telefonoSchema.safeParse(telefono);
    expect(resultado.success).toBe(false);
  });

  it('trata cadena vacía como ausente (opcional)', () => {
    const resultado = telefonoSchema.safeParse('');
    expect(resultado.success).toBe(true);
    expect(resultado.success && resultado.data).toBeUndefined();
  });

  it('trata null como ausente (opcional)', () => {
    const resultado = telefonoSchema.safeParse(null);
    expect(resultado.success).toBe(true);
    expect(resultado.success && resultado.data).toBeUndefined();
  });

  it('normaliza espacios/guiones/paréntesis antes de validar', () => {
    const resultado = telefonoSchema.safeParse('099-123 (4567)');
    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data).toBe('0991234567');
    }
  });
});

// Causa raíz del bug: Zod descartaba `desdeOffline` (la cola offline del móvil lo
// envía) y el dato de auditoría nunca llegaba a la columna desde_offline.
describe('desdeOffline en los schemas de tracking que pasan por la cola offline', () => {
  const geo = { latitud: 0.35, longitud: -78.11, ocurridoEn: '2026-09-30T10:00:00.000Z' };
  const casos: Array<[string, { safeParse: (v: unknown) => { success: boolean; data?: unknown } }, object]> = [
    ['salidaDpi', salidaDpiSchema, geo],
    ['llegadaRecinto', llegadaRecintoSchema, geo],
    ['llegadaDpi', llegadaDpiSchema, geo],
    ['salidaRecinto', salidaRecintoSchema, { ...geo, actaInstalacionUrl: 'a', actaEscrutinioUrl: 'b' }],
    ['pruebaConexion', pruebaConexionSchema, { ocurridoEn: '2026-09-30T10:00:00.000Z' }],
    ['llegadaNoCda', llegadaNoCdaSchema, { recintoId: '55555555-5555-5555-5555-555555555555' }],
    [
      'recepcionKit',
      recepcionKitSchema,
      { kitId: '33333333-3333-3333-3333-333333333333', fotoMilitarUrl: 'f', latitud: 0.35, longitud: -78.11 },
    ],
  ];

  it.each(casos)('%s conserva desdeOffline al parsear', (_nombre, schema, base) => {
    const resultado = schema.safeParse({ ...base, desdeOffline: true });
    expect(resultado.success).toBe(true);
    expect(resultado.data).toMatchObject({ desdeOffline: true });
  });

  it.each(casos)('%s sigue aceptando el body sin desdeOffline (apps sin cola)', (_nombre, schema, base) => {
    expect(schema.safeParse(base).success).toBe(true);
  });

  it.each(casos)('%s rechaza un desdeOffline no booleano', (_nombre, schema, base) => {
    expect(schema.safeParse({ ...base, desdeOffline: 'true' }).success).toBe(false);
  });
});

describe('avisosEnlacesSchema', () => {
  it('acepta las opciones de la lista, incluido 10 min para el día de votaciones', () => {
    expect(avisosEnlacesSchema.safeParse({ minutosPrimerAviso: 10, minutosRepetirAviso: 240 }).success).toBe(true);
    expect(avisosEnlacesSchema.safeParse({ minutosPrimerAviso: 120, minutosRepetirAviso: 120 }).success).toBe(true);
  });

  it.each([5, 0, -10, 45, 10.5, 1_000_000])('rechaza %p minutos (fuera de la lista)', (minutos) => {
    expect(avisosEnlacesSchema.safeParse({ minutosPrimerAviso: minutos, minutosRepetirAviso: 120 }).success).toBe(false);
    expect(avisosEnlacesSchema.safeParse({ minutosPrimerAviso: 120, minutosRepetirAviso: minutos }).success).toBe(false);
  });

  it('rechaza texto o campos faltantes', () => {
    expect(avisosEnlacesSchema.safeParse({ minutosPrimerAviso: '120', minutosRepetirAviso: 120 }).success).toBe(false);
    expect(avisosEnlacesSchema.safeParse({ minutosPrimerAviso: 120 }).success).toBe(false);
  });
});

describe('recintos: los textos se guardan sin espacios sobrantes', () => {
  const base = {
    codigoRecinto: ' PRUEBA-DPEI ',
    nombre: '  Escuela Central ',
    direccion: ' Av. Bolívar ',
    cantonId: 1,
    parroquia: ' Sagrario ',
    zona: ' Urbana ',
    tipo: 'CDA' as const,
    latitud: 0.35,
    longitud: -78.12,
  };

  it('el formulario recorta código, nombre, dirección, parroquia y zona', () => {
    const r = createRecintoSchema.parse(base);
    expect(r).toMatchObject({
      codigoRecinto: 'PRUEBA-DPEI',
      nombre: 'Escuela Central',
      direccion: 'Av. Bolívar',
      parroquia: 'Sagrario',
      zona: 'Urbana',
    });
  });

  it('un código o nombre de solo espacios se rechaza', () => {
    expect(createRecintoSchema.safeParse({ ...base, codigoRecinto: '   ' }).success).toBe(false);
    expect(createRecintoSchema.safeParse({ ...base, nombre: '  ' }).success).toBe(false);
  });

  it('al editar también se recorta', () => {
    expect(updateRecintoSchema.parse({ codigoRecinto: ' 28 ' }).codigoRecinto).toBe('28');
  });

  it('la carga masiva recorta código, nombre y códigos de cantón y CDA destino', () => {
    const r = bulkRecintoRowSchema.parse({
      codigo_recinto: ' 1286 ',
      nombre: ' UE 17 de Julio ',
      canton_codigo: ' 30 ',
      tipo: 'NO_CDA',
      latitud: '0.35',
      longitud: '-78.12',
      cda_destino_codigo: ' 28 ',
    });
    expect(r).toMatchObject({ codigo_recinto: '1286', nombre: 'UE 17 de Julio', canton_codigo: '30', cda_destino_codigo: '28' });
    expect(bulkRecintoRowSchema.safeParse({ ...r, codigo_recinto: '  ' }).success).toBe(false);
  });
});

describe('reopenEventoSchema', () => {
  it('exige una justificación de al menos 10 caracteres (sin contar espacios)', () => {
    expect(reopenEventoSchema.safeParse({}).success).toBe(false);
    expect(reopenEventoSchema.safeParse({ justificacion: '   corto   ' }).success).toBe(false);
    expect(reopenEventoSchema.parse({ justificacion: '  Sacar informe de custodia  ' })).toEqual({
      justificacion: 'Sacar informe de custodia',
    });
  });

  it('rechaza justificaciones de más de 500 caracteres', () => {
    expect(reopenEventoSchema.safeParse({ justificacion: 'x'.repeat(501) }).success).toBe(false);
  });
});

describe('operadorCdaFilaSchema', () => {
  const fila = {
    numero: 1,
    apellidosNombres: '  ALMEIDA PÉREZ JUAN CARLOS ',
    cedula: '1710034065',
    telefono: '0987 923 273',
    cargo: 'ASISTENTE ADMINISTRATIVO ELECTORAL PROVINCIAL - OPERADORES CDA',
    unidad: 'UNIDAD PROVINCIAL DE SEGURIDAD INFORMATICA',
    fechaInicio: '2026-10-20',
  };

  it('acepta una fila válida, recorta textos y normaliza el teléfono', () => {
    const r = operadorCdaFilaSchema.parse(fila);
    expect(r.apellidosNombres).toBe('ALMEIDA PÉREZ JUAN CARLOS');
    expect(r.telefono).toBe('0987923273');
  });

  it('acepta campos opcionales vacíos', () => {
    const r = operadorCdaFilaSchema.parse({ ...fila, numero: undefined, telefono: '', unidad: undefined, fechaInicio: undefined });
    expect(r.telefono).toBeUndefined();
  });

  it('rechaza cédula con dígito verificador inválido', () => {
    expect(operadorCdaFilaSchema.safeParse({ ...fila, cedula: '1710034066' }).success).toBe(false);
  });

  it('rechaza fechas que no existen o fuera de rango', () => {
    for (const fechaInicio of ['2026-02-31', '2026-13-45', '1999-10-20', '2200-01-01']) {
      expect(operadorCdaFilaSchema.safeParse({ ...fila, fechaInicio }).success).toBe(false);
    }
    expect(operadorCdaFilaSchema.safeParse({ ...fila, fechaInicio: '2028-02-29' }).success).toBe(true);
  });

  it('rechaza fecha que no sea AAAA-MM-DD y cargo vacío', () => {
    expect(operadorCdaFilaSchema.safeParse({ ...fila, fechaInicio: '20 de octubre de 2026' }).success).toBe(false);
    expect(operadorCdaFilaSchema.safeParse({ ...fila, cargo: '   ' }).success).toBe(false);
  });
});

describe('asistencia CDA', () => {
  it('marcar acepta solo ENTRADA o SALIDA', () => {
    expect(marcarAsistenciaCdaSchema.safeParse({ tipo: 'ENTRADA' }).success).toBe(true);
    expect(marcarAsistenciaCdaSchema.safeParse({ tipo: 'entrada' }).success).toBe(false);
  });

  it('el marcado masivo exige ids válidos y al menos uno', () => {
    const id = '11111111-2222-4333-8444-555555555555';
    expect(marcarAsistenciaCdaMasivaSchema.safeParse({ tipo: 'ENTRADA', operadorIds: [id] }).success).toBe(true);
    expect(marcarAsistenciaCdaMasivaSchema.safeParse({ tipo: 'ENTRADA', operadorIds: [] }).success).toBe(false);
    expect(marcarAsistenciaCdaMasivaSchema.safeParse({ tipo: 'ENTRADA', operadorIds: ['x'] }).success).toBe(false);
  });

  it('el día debe existir', () => {
    expect(diaAsistenciaSchema.safeParse('2026-10-22').success).toBe(true);
    expect(diaAsistenciaSchema.safeParse('2026-02-30').success).toBe(false);
    expect(diaAsistenciaSchema.safeParse('22/10/2026').success).toBe(false);
  });
});

describe('actas de entrega CDA', () => {
  const id = '11111111-2222-4333-8444-555555555555';
  const acta = {
    operadorIds: [id],
    entregaNombre: '  William Paspuel ',
    entregaCedula: '1710034065',
    entregaCargo: 'Asistente Electoral Transversal',
    fecha: '2026-10-22',
    lugar: 'Ibarra',
    estadoPeto: 'BUENO',
    estadoCredencial: 'NUEVO',
    estadoCordon: 'BUENO',
  };

  it('acepta un acta válida, con o sin usuario, y recorta el nombre', () => {
    expect(generarActasCdaSchema.parse(acta).entregaNombre).toBe('William Paspuel');
    expect(generarActasCdaSchema.safeParse({ ...acta, entregaUsuarioId: id }).success).toBe(true);
  });

  it('rechaza cédula inválida, estados desconocidos, fecha inexistente y listas vacías o enormes', () => {
    expect(generarActasCdaSchema.safeParse({ ...acta, entregaCedula: '1710034066' }).success).toBe(false);
    expect(generarActasCdaSchema.safeParse({ ...acta, estadoPeto: 'ROTO' }).success).toBe(false);
    expect(generarActasCdaSchema.safeParse({ ...acta, fecha: '2026-02-30' }).success).toBe(false);
    expect(generarActasCdaSchema.safeParse({ ...acta, entregaCargo: '  ' }).success).toBe(false);
    expect(generarActasCdaSchema.safeParse({ ...acta, entregaNombre: 'Ana\u0000 Ruiz' }).success).toBe(false);
    expect(generarActasCdaSchema.safeParse({ ...acta, lugar: 'Iba\nrra' }).success).toBe(false);
    expect(descargarActasCdaSchema.safeParse({ operadorIds: [] }).success).toBe(false);
    expect(descargarActasCdaSchema.safeParse({ operadorIds: Array(101).fill(id) }).success).toBe(false);
  });
});
