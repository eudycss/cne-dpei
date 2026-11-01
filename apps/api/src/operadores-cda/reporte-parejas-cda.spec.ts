import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { ParejaCdaFila, ParejasCdaDia, PersonaParejaCda } from '@cne/shared-types';

import { generarReporte } from './reporte-cda';
import { reporteParejas } from './reporte-parejas-cda';

const persona = (nombre: string, dispositivo: PersonaParejaCda['dispositivo'] = 'ANDROID'): PersonaParejaCda => ({
  id: nombre,
  apellidosNombres: nombre,
  cedula: '1000000001',
  telefono: '0999999999',
  dispositivo,
  grupo: 'OPERADOR',
});

const fila = (codigo: string, extra: Partial<ParejaCdaFila> = {}): ParejaCdaFila => {
  const operador = extra.operador ?? persona(`OP ${codigo}`);
  return {
    id: `p-${codigo}-${operador.apellidosNombres}`,
    fecha: '2026-11-01',
    recinto: { id: `r-${codigo}`, codigo, nombre: `Recinto ${codigo}`, canton: 'IBARRA' },
    operador,
    asistente: persona(`AS ${codigo}`, 'IPHONE'),
    portador: operador,
    kitCodigo: `K-${codigo}`,
    estado: 'EN_APP',
    recintoCompartido: false,
    puedeRecibirKit: false,
    articulos: null,
    kitSalio: false,
    quienLleva: null,
    ...extra,
  };
};

const dia = (parejas: ParejaCdaFila[]): ParejasCdaDia => ({
  fecha: '2026-11-01',
  evento: { id: 'e1', nombre: 'Primer Simulacro 01 nov' },
  congelado: false,
  parejas,
});

const COLUMNAS = [
  'N°',
  'Código',
  'Cantón',
  'Recinto',
  'Operador',
  'Cédula operador',
  'Celular operador',
  'Asistente',
  'Cédula asistente',
  'Celular asistente',
  'Lleva el kit',
  'Estado',
];

describe('reporteParejas', () => {
  it('una fila por pareja con recinto, nombres, cédula y celular de cada uno y quién lleva el kit; sin teléfonos', () => {
    const operador = { ...persona('BONILLA DAVID', null), cedula: '1002003004' };
    const asistente = { ...persona('AS 1198', 'IPHONE'), cedula: '1005006007' };
    const r = reporteParejas(dia([fila('1198', { operador, asistente, portador: persona('LEON MARIA') })]));
    const t = r.tablas[0];

    expect(t.columnas.map((c) => c.titulo)).toEqual(COLUMNAS);
    expect(t.filas).toEqual([
      [1, '1198', 'IBARRA', 'Recinto 1198', 'BONILLA DAVID', '1002003004', 'Sin registrar', 'AS 1198', '1005006007', 'iPhone', 'LEON MARIA', 'Con kit'],
    ]);
    expect(JSON.stringify(r)).not.toContain('0999999999');
  });

  it('ordena por código de recinto como número y numera las filas', () => {
    const r = reporteParejas(dia([fila('1198'), fila('28'), fila('957')]));
    expect(r.tablas[0].filas.map((f) => [f[0], f[1]])).toEqual([
      [1, '28'],
      [2, '957'],
      [3, '1198'],
    ]);
  });

  it('estados legibles y resalta lo que hay que revisar: sin kit, persona sola y kit en un celular que no es Android', () => {
    const r = reporteParejas(
      dia([
        fila('1', { estado: 'SIN_KIT', portador: null, kitCodigo: null }),
        fila('2', { estado: 'SOLO_REGISTRADA', asistente: null, portador: null, kitCodigo: null, recintoCompartido: true }),
        fila('3', { operador: persona('OP IPHONE', 'IPHONE'), asistente: null }),
        fila('4', { estado: 'PENDIENTE_EVENTO', portador: null, kitCodigo: null }),
        fila('5', { estado: 'SOLO_REGISTRADA', portador: null, kitCodigo: null, recintoCompartido: true }),
      ]),
    );
    const t = r.tablas[0];
    const estados = t.filas.map((f) => f[11]);

    expect(estados).toEqual([
      'Sin kit',
      'Persona sola (acompaña a la pareja del recinto)',
      'Con kit · sin Android · sin asistente',
      'Pendiente de evento',
      'Solo registrada (2.ª pareja del recinto)',
    ]);
    expect(t.filas[1].slice(7, 10)).toEqual(['— (sin pareja)', '', '']);
    expect(t.filas[0][10]).toBe('—');
    expect(t.resaltadas).toEqual([0, 1, 2]);
  });

  it('resumen al final: recintos, parejas, personas, con y sin kit, personas solas y celulares sin registrar', () => {
    const r = reporteParejas(
      dia([
        fila('10'),
        fila('10', { operador: persona('OP2 10', null), asistente: null, estado: 'SOLO_REGISTRADA', portador: null, kitCodigo: null }),
        fila('20', { estado: 'SIN_KIT', portador: null, kitCodigo: null }),
      ]),
    );
    expect(r.tablas[0].anexo?.filas).toEqual([
      ['Recintos', 2],
      ['Recintos con kit', 1],
      ['Recintos sin kit', 1],
      ['Parejas', 3],
      ['Personas', 5],
      ['Personas sin pareja', 1],
      ['Celulares sin registrar', 1],
      ['Activos sin pareja', 0],
    ]);
  });

  it('título, fecha y evento en el encabezado; archivo parejas_cda del día', () => {
    const r = reporteParejas(dia([fila('28')]));
    expect(r.titulo).toBe('Parejas Operador + Asistente CDA');
    expect(r.detalle).toContain('domingo, 1 de noviembre de 2026');
    expect(r.detalle).toContain('Primer Simulacro 01 nov');
    expect(r.archivo).toBe('parejas_cda');
    expect([r.desde, r.hasta]).toEqual(['2026-11-01', '2026-11-01']);
  });

  it('sin evento activo de esa fecha lo dice en el encabezado', () => {
    const r = reporteParejas({ ...dia([fila('28', { estado: 'PENDIENTE_EVENTO' })]), evento: null });
    expect(r.detalle).toContain('sin evento activo de esa fecha');
  });

  it('el Excel real lleva las cédulas pero no los teléfonos, y un nombre que empieza con "=" queda como texto', async () => {
    const otro = (nombre: string, cedula: string, telefono: string, dispositivo: PersonaParejaCda['dispositivo']) => ({
      ...persona(nombre, dispositivo),
      cedula,
      telefono,
    });
    const asistente = otro('=HYPERLINK("x")', '1712345675', '0987654321', 'ANDROID');
    const r = reporteParejas(
      dia([
        fila('28', { operador: otro('OP A', '1710034065', '0991111111', 'IPHONE'), asistente, portador: asistente }),
        fila('96', { operador: otro('OP B', '1713175071', '0992222222', 'ANDROID') }),
      ]),
      [otro('SOLO C', '1714444444', '0993333333', null)],
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await generarReporte(r, 'xlsx')).contenido as never);
    const celdas: unknown[] = [];
    wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => celdas.push(c.value))));
    const texto = JSON.stringify(celdas);

    for (const cedula of ['1710034065', '1712345675', '1713175071', '1714444444']) expect(celdas).toContain(cedula);
    for (const telefono of ['0991111111', '0987654321', '0992222222', '0993333333', '0999999999']) expect(texto).not.toContain(telefono);
    expect(celdas).toContain('=HYPERLINK("x")');
    expect(celdas.some((v) => typeof v === 'object' && v !== null && 'formula' in v)).toBe(false);
  });

  it('la "\\" del nombre del recinto pasa a "/" (el PDF la borraría: "Bloque 1  Ex Escuela")', () => {
    const r = reporteParejas(dia([fila('971', { recinto: { id: 'r', codigo: '971', nombre: 'UE Chaltura Bloque 1 \\ Ex Escuela' } })]));
    expect(r.tablas[0].filas[0][3]).toBe('UE Chaltura Bloque 1 / Ex Escuela');
    expect(r.tablas[0].filas[0][2]).toBe('');
  });

  it('segunda hoja: operadores y asistentes activos que no están en ninguna pareja del día, con cédula y celular', () => {
    const r = reporteParejas(dia([fila('28')]), [
      { ...persona('ZAMBRANO ANA', null), grupo: 'ASISTENTE', cedula: '1001001001' },
      { ...persona('ANDRADE LUIS'), cedula: '1002002002' },
    ]);
    const t = r.tablas[1];

    expect(r.tablas).toHaveLength(2);
    expect(t.hoja).toBe('Sin pareja');
    expect(t.titulo).toBe('Operadores y Asistentes CDA activos sin pareja el 01/11/2026');
    expect(t.columnas.map((c) => c.titulo)).toEqual(['N°', 'Apellidos y nombres', 'Cédula', 'Cargo', 'Celular']);
    expect(t.filas).toEqual([
      [1, 'ANDRADE LUIS', '1002002002', 'Operador CDA', 'Android'],
      [2, 'ZAMBRANO ANA', '1001001001', 'Asistente CDA', 'Sin registrar'],
    ]);
    expect(r.tablas[0].anexo?.filas).toContainEqual(['Activos sin pareja', 2]);
  });

  it('en la hoja sin pareja, un nombre con "=" queda como texto y un cargo distinto usa su nombre registrado', () => {
    const t = reporteParejas(dia([fila('28')]), [{ ...persona('=CMD()'), grupo: 'DIGITADOR', cedula: '1003003003' }]).tablas[1];
    expect(t.filas).toEqual([[1, '=CMD()', '1003003003', 'DIGITADOR CPE', 'Android']]);
  });

  it('si todos los activos tienen pareja, la segunda hoja lo dice en vez de quedar vacía', () => {
    const t = reporteParejas(dia([fila('28')]), []).tablas[1];
    expect(t.filas).toEqual([['', 'Todos los Operadores y Asistentes CDA activos tienen pareja este día', '', '', '']]);
  });

  it('día sin parejas: 400 en vez de un reporte vacío', () => {
    expect(() => reporteParejas(dia([]))).toThrow(BadRequestException);
  });
});
