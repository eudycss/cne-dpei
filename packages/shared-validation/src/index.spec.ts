import { describe, expect, it } from 'vitest';
import {
  strongPasswordSchema,
  MARGEN_LLEGADA_MAX_METROS,
  verificarKitRetornoSchema as verificarKitRetornoSchemaRetorno,
  bulkRecintoRowSchema,
  createRecintoSchema,
  updateRecintoSchema,
  cedulaSchema,
  avisosEnlacesSchema,
  configAlertasSchema,
  configAsistenciaCdaSchema,
  corregirAsistenciaCdaSchema,
  rangoAsistenciaSchema,
  modoReporteCdaSchema,
  diasDelRango,
  tokenCredencialQrCdaSchema,
  marcarQrCdaSchema,
  emitirCarnetsCdaSchema,
  MAX_DIAS_REPORTE_PDF,
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
  crearOperadorCdaSchema,
  cambiarCargoOperadorCdaSchema,
  GRUPOS_CDA,
  crearCargoCdaSchema,
  renombrarCargoCdaSchema,
  cambiarActivoCargoCdaSchema,
  editarOperadorCdaSchema,
  cambiarActivoOperadorCdaSchema,
  grupoCdaQuerySchema,
  marcarAsistenciaCdaSchema,
  marcarAsistenciaCdaMasivaSchema,
  generarActasCdaSchema,
  descargarActasCdaSchema,
  diaAsistenciaSchema,
  crearKitConParejaCdaSchema,
  llegadaDpiManualSchema,
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

describe('CRUD de operadores CDA', () => {
  const alta = { apellidosNombres: 'RUIZ MORA JUAN', cedula: '1710034065', cargo: 'OPERADOR CDA', fechaInicio: '2026-10-20' };

  it('alta: valida como una fila del Excel y no acepta campos de más (numero, activo)', () => {
    expect(crearOperadorCdaSchema.safeParse(alta).success).toBe(true);
    expect(crearOperadorCdaSchema.safeParse({ ...alta, cedula: '1710034066' }).success).toBe(false);
    expect(crearOperadorCdaSchema.safeParse({ ...alta, numero: 3 }).success).toBe(false);
    expect(crearOperadorCdaSchema.safeParse({ ...alta, activo: false }).success).toBe(false);
  });

  it('alta: la fecha de ingreso es obligatoria y debe ser real', () => {
    const { fechaInicio: _f, ...sinFecha } = alta;
    const r = crearOperadorCdaSchema.safeParse(sinFecha);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]).toMatchObject({ path: ['fechaInicio'], message: 'Fecha de ingreso requerida' });
    expect(crearOperadorCdaSchema.safeParse({ ...alta, fechaInicio: '2026-02-31' }).success).toBe(false);
  });

  it('edición: la fecha de ingreso sigue opcional (registros antiguos sin ella)', () => {
    const { cedula: _c, fechaInicio: _f, ...sinCedulaNiFecha } = alta;
    expect(editarOperadorCdaSchema.safeParse(sinCedulaNiFecha).success).toBe(true);
  });

  it('edición: no permite cambiar la cédula ni el grupo', () => {
    const { cedula: _c, ...sinCedula } = alta;
    expect(editarOperadorCdaSchema.safeParse(sinCedula).success).toBe(true);
    expect(editarOperadorCdaSchema.safeParse(alta).success).toBe(false);
    expect(editarOperadorCdaSchema.safeParse({ ...sinCedula, grupo: 'ASISTENTE' }).success).toBe(false);
  });

  it('alta: grupo opcional, con forma de clave de cargo (que exista lo revisa la API)', () => {
    expect(GRUPOS_CDA).toHaveLength(9);
    expect(GRUPOS_CDA).toContain('ARCHIVADOR_ACTAS');
    for (const grupo of GRUPOS_CDA) expect(crearOperadorCdaSchema.safeParse({ ...alta, grupo }).success).toBe(true);
    expect(crearOperadorCdaSchema.safeParse({ ...alta, grupo: 'COORDINADORES_CPE' }).success).toBe(true);
    for (const grupo of ['tecnico', '', '1ABC', 'A-B', 'A'.repeat(41), 5]) {
      expect(crearOperadorCdaSchema.safeParse({ ...alta, grupo }).success).toBe(false);
    }
  });

  it('cambiar de cargo: una clave de cargo y nada más', () => {
    expect(cambiarCargoOperadorCdaSchema.safeParse({ grupo: 'SUPERVISOR' }).success).toBe(true);
    expect(cambiarCargoOperadorCdaSchema.safeParse({ grupo: 'ARCHIVADOR_ACTAS' }).success).toBe(true);
    expect(cambiarCargoOperadorCdaSchema.safeParse({ grupo: 'supervisor' }).success).toBe(false);
    expect(cambiarCargoOperadorCdaSchema.safeParse({}).success).toBe(false);
    expect(cambiarCargoOperadorCdaSchema.safeParse({ grupo: 'SUPERVISOR', desde: '2026-01-01' }).success).toBe(false);
  });

  it('?grupo=: ausente es OPERADOR y rechaza otros valores', () => {
    expect(grupoCdaQuerySchema.parse(undefined)).toBe('OPERADOR');
    expect(grupoCdaQuerySchema.parse('ASISTENTE')).toBe('ASISTENTE');
    expect(grupoCdaQuerySchema.safeParse('asistente').success).toBe(false);
    expect(grupoCdaQuerySchema.safeParse(['ASISTENTE', 'OPERADOR']).success).toBe(false);
  });

  it('activo: solo booleano', () => {
    expect(cambiarActivoOperadorCdaSchema.safeParse({ activo: false }).success).toBe(true);
    expect(cambiarActivoOperadorCdaSchema.safeParse({ activo: 'false' }).success).toBe(false);
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

  it('la hora de entrada es HH:MM y la gracia de 0 a 120 min enteros', () => {
    const ok = (horaEntrada: string, minutosGracia: unknown) =>
      configAsistenciaCdaSchema.safeParse({ horaEntrada, minutosGracia }).success;
    expect(ok('08:00', 10)).toBe(true);
    expect(ok('23:59', 0)).toBe(true);
    expect(ok('24:00', 10)).toBe(false);
    expect(ok('8:00', 10)).toBe(false);
    expect(ok('08:00', 121)).toBe(false);
    expect(ok('08:00', 2.5)).toBe(false);
    expect(ok('08:00', '10')).toBe(false);
  });

  it('el rango de atrasos va en orden y hasta 120 días', () => {
    const ok = (desde: string, hasta: string) => rangoAsistenciaSchema.safeParse({ desde, hasta }).success;
    expect(ok('2026-10-01', '2026-10-01')).toBe(true);
    expect(ok('2026-10-02', '2026-10-01')).toBe(false);
    expect(ok('2026-06-04', '2026-10-01')).toBe(true); // 120 días
    expect(ok('2026-06-03', '2026-10-01')).toBe(false); // 121 días
  });

  it('token del carnet QR: CDA1 + 26 en base32; tolera minúsculas y espacios', () => {
    const token = `CDA1${'A2B3C4D5E6F7G'.repeat(2)}`;
    expect(tokenCredencialQrCdaSchema.parse(token)).toBe(token);
    expect(tokenCredencialQrCdaSchema.parse(`  ${token.toLowerCase()}\n`)).toBe(token);
    expect(tokenCredencialQrCdaSchema.safeParse(token.slice(0, -1)).success).toBe(false);
    // 0, 1, 8 y 9 no existen en base32; tampoco otros prefijos (p. ej. un QR de kit).
    expect(tokenCredencialQrCdaSchema.safeParse(`CDA1${'0'.repeat(26)}`).success).toBe(false);
    expect(tokenCredencialQrCdaSchema.safeParse(`KIT1${'A'.repeat(26)}`).success).toBe(false);
    expect(marcarQrCdaSchema.safeParse({ token, tipo: 'SALIDA' }).success).toBe(true);
    expect(marcarQrCdaSchema.safeParse({ token, tipo: 'SALIDA', operadorId: 'x' }).success).toBe(false);
    expect(emitirCarnetsCdaSchema.safeParse({ operadorIds: [] }).success).toBe(false);
  });

  it('cuenta los días del rango con ambos extremos', () => {
    expect(diasDelRango('2026-10-01', '2026-10-01')).toBe(1);
    expect(diasDelRango('2026-10-01', '2026-10-31')).toBe(MAX_DIAS_REPORTE_PDF);
    expect(diasDelRango('2026-02-27', '2026-03-02')).toBe(4);
  });

  it('el modo del reporte es GENERAL o POR_DIA, y GENERAL si no viene', () => {
    expect(modoReporteCdaSchema.parse(undefined)).toBe('GENERAL');
    expect(modoReporteCdaSchema.parse('POR_DIA')).toBe('POR_DIA');
    expect(modoReporteCdaSchema.safeParse('por_dia').success).toBe(false);
    expect(modoReporteCdaSchema.safeParse(['GENERAL']).success).toBe(false);
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

describe('corregirAsistenciaCdaSchema', () => {
  const MOTIVO = 'Se olvidó marcar la salida';
  const ok = (v: unknown) => corregirAsistenciaCdaSchema.safeParse(v).success;

  it('acepta horas HH:MM o null, con motivo de al menos 10 caracteres', () => {
    expect(ok({ entrada: '08:05', salida: '17:00', motivo: MOTIVO })).toBe(true);
    expect(ok({ entrada: '08:05', salida: null, motivo: MOTIVO })).toBe(true);
    expect(ok({ entrada: null, salida: null, motivo: MOTIVO })).toBe(true);
    expect(corregirAsistenciaCdaSchema.parse({ entrada: null, salida: null, motivo: `  ${MOTIVO}  ` }).motivo).toBe(MOTIVO);
  });

  it('rechaza motivo corto o ausente, horas inválidas y campos extra', () => {
    expect(ok({ entrada: '08:05', salida: null, motivo: 'olvido    ' })).toBe(false);
    expect(ok({ entrada: '08:05', salida: null })).toBe(false);
    expect(ok({ entrada: '8:05', salida: null, motivo: MOTIVO })).toBe(false);
    expect(ok({ entrada: '24:00', salida: null, motivo: MOTIVO })).toBe(false);
    expect(ok({ entrada: '08:05', salida: null, motivo: MOTIVO, usuarioId: 'x' })).toBe(false);
  });

  it('salida sin entrada o no posterior a la entrada: error en el campo salida', () => {
    const sinEntrada = corregirAsistenciaCdaSchema.safeParse({ entrada: null, salida: '17:00', motivo: MOTIVO });
    expect(sinEntrada.success).toBe(false);
    expect(sinEntrada.error?.issues[0]).toMatchObject({ path: ['salida'], message: 'Sin entrada no puede haber salida' });
    expect(ok({ entrada: '17:00', salida: '17:00', motivo: MOTIVO })).toBe(false);
    expect(ok({ entrada: '17:00', salida: '08:00', motivo: MOTIVO })).toBe(false);
  });
});

describe('verificarKitRetornoSchema', () => {
  const kitId = '11111111-1111-4111-8111-111111111111';

  it('acepta un kit sin artículos registrados (lista vacía)', () => {
    expect(verificarKitRetornoSchemaRetorno.safeParse({ kitId, items: [] }).success).toBe(true);
  });

  it('sigue exigiendo observación si falta algún artículo', () => {
    const r = verificarKitRetornoSchemaRetorno.safeParse({ kitId, items: [{ texto: 'Acta', marcado: false }] });
    expect(r.success).toBe(false);
  });
});

describe('cargos CDA/CPE (gestión)', () => {
  it('crear: nombre de 3 a 80 caracteres y centro CDA o CPE', () => {
    expect(crearCargoCdaSchema.parse({ nombre: '  Coordinadores de sala ', centro: 'CPE' })).toEqual({
      nombre: 'Coordinadores de sala',
      centro: 'CPE',
    });
    expect(crearCargoCdaSchema.safeParse({ nombre: 'Técnicos (turno 2)', centro: 'CDA' }).success).toBe(true);
    expect(crearCargoCdaSchema.safeParse({ nombre: 'ab', centro: 'CPE' }).success).toBe(false);
    expect(crearCargoCdaSchema.safeParse({ nombre: 'x'.repeat(81), centro: 'CPE' }).success).toBe(false);
    expect(crearCargoCdaSchema.safeParse({ nombre: 'Cargo nuevo', centro: 'OTRO' }).success).toBe(false);
    expect(crearCargoCdaSchema.safeParse({ nombre: 'Cargo nuevo' }).success).toBe(false);
    expect(crearCargoCdaSchema.safeParse({ nombre: 'Cargo nuevo', centro: 'CPE', clave: 'X' }).success).toBe(false);
  });

  it('nombre: sin símbolos raros ni HTML, espacios internos colapsados', () => {
    expect(renombrarCargoCdaSchema.parse({ nombre: 'Receptores   de actas' })).toEqual({ nombre: 'Receptores de actas' });
    for (const nombre of ['<b>Jefes</b>', 'Jefes; DROP', 'Jefes\n2', '   ', '-Jefes', '=SUMA(A1)', '/x/y', '%_%']) {
      expect(renombrarCargoCdaSchema.safeParse({ nombre }).success).toBe(false);
    }
    expect(renombrarCargoCdaSchema.safeParse({ nombre: 'Jefes', centro: 'CDA' }).success).toBe(false);
  });

  it('activar o desactivar: solo el booleano', () => {
    expect(cambiarActivoCargoCdaSchema.safeParse({ activo: false }).success).toBe(true);
    expect(cambiarActivoCargoCdaSchema.safeParse({ activo: 'no' }).success).toBe(false);
  });
});

describe('crearKitConParejaCdaSchema (Nuevo kit en un paso)', () => {
  const base = {
    eventoId: '11111111-1111-4111-8111-111111111111',
    recintoId: '22222222-2222-4222-8222-222222222222',
    operadorCdaId: '33333333-3333-4333-8333-333333333333',
  };

  it('el asistente y los artículos son opcionales', () => {
    expect(crearKitConParejaCdaSchema.safeParse(base).success).toBe(true);
    expect(
      crearKitConParejaCdaSchema.safeParse({
        ...base,
        asistenteCdaId: '44444444-4444-4444-8444-444444444444',
        detalleItems: [{ itemId: '55555555-5555-4555-8555-555555555555', serie: 'ABC123', estado: 'BUENO' }],
      }).success,
    ).toBe(true);
  });

  it('exige recinto y operador, y que el asistente no sea el mismo operador', () => {
    expect(crearKitConParejaCdaSchema.safeParse({ ...base, recintoId: '' }).success).toBe(false);
    expect(crearKitConParejaCdaSchema.safeParse({ ...base, operadorCdaId: undefined }).success).toBe(false);
    expect(crearKitConParejaCdaSchema.safeParse({ ...base, asistenteCdaId: base.operadorCdaId }).success).toBe(false);
  });

  it('"otro dispositivo" es un booleano opcional', () => {
    expect(crearKitConParejaCdaSchema.safeParse({ ...base, otroDispositivo: true }).success).toBe(true);
    expect(crearKitConParejaCdaSchema.safeParse({ ...base, otroDispositivo: 'si' }).success).toBe(false);
  });

  it('no acepta campos de más (p. ej. operadorId de Usuarios)', () => {
    expect(crearKitConParejaCdaSchema.safeParse({ ...base, operadorId: base.operadorCdaId }).success).toBe(false);
  });
});

describe('llegadaDpiManualSchema (llegada al DPEI desde la web)', () => {
  it('exige un motivo de 5 a 500 caracteres, sin espacios de relleno', () => {
    expect(llegadaDpiManualSchema.safeParse({ motivo: '  Olvidó marcarla  ' })).toEqual({ success: true, data: { motivo: 'Olvidó marcarla' } });
    expect(llegadaDpiManualSchema.safeParse({ motivo: '    ab   ' }).success).toBe(false);
    expect(llegadaDpiManualSchema.safeParse({ motivo: 'x'.repeat(501) }).success).toBe(false);
    expect(llegadaDpiManualSchema.safeParse({}).success).toBe(false);
  });

  it('no acepta otros campos (la hora y quién la registra los pone el servidor)', () => {
    expect(llegadaDpiManualSchema.safeParse({ motivo: 'Olvidó marcarla', ocurridoEn: '2026-10-30T10:00:00Z' }).success).toBe(false);
  });
});

describe('strongPasswordSchema (contraseña nueva: 6 a 12 caracteres)', () => {
  it.each([
    ['Ab1!xy', '6 caracteres (mínimo)'],
    ['Ab1!xyzw', '8 caracteres'],
    ['Ab1!xyzwvuts', '12 caracteres (máximo)'],
  ])('acepta %s (%s)', (v) => {
    expect(strongPasswordSchema.safeParse(v).success).toBe(true);
  });

  it.each([
    ['Ab1!x', 'menos de 6'],
    ['Ab1!xyzwvutsr', 'más de 12'],
    ['ab1!xyzw', 'sin mayúscula'],
    ['AB1!XYZW', 'sin minúscula'],
    ['Abc!xyzw', 'sin dígito'],
    ['Ab12xyzw', 'sin carácter especial'],
    ['1004277248', 'la cédula sola (solo dígitos)'],
  ])('rechaza %s (%s)', (v) => {
    expect(strongPasswordSchema.safeParse(v).success).toBe(false);
  });

  it('el mensaje de exceso dice 12', () => {
    const r = strongPasswordSchema.safeParse('Ab1!xyzwvutsr');
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues[0].message).toBe('La contraseña no puede exceder 12 caracteres');
  });
});
