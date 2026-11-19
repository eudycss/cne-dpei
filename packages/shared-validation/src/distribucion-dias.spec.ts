import { describe, expect, it } from 'vitest';
import {
  agregarPersonaDistribucionSchema,
  candidatosDistribucionSchema,
  crearDistribucionDiasSchema,
  editarPersonaDistribucionSchema,
  reporteDistribucionSchema,
} from './index';

const CEDULA = '1003456785';

describe('crearDistribucionDiasSchema', () => {
  const base = { nombre: 'Fin de semana', fechas: ['2026-11-22', '2026-11-20', '2026-11-21'], excluirCargos: ['SUPERVISOR', 'ASISTENTE_ARCHIVOS'] };

  it('ordena los días y acepta cantón y encargado del CPE opcionales', () => {
    const r = crearDistribucionDiasSchema.parse({ ...base, cantonCpe: 'IBARRA', encargadoCpe: '  Edison   Mafla ' });
    expect(r.fechas).toEqual(['2026-11-20', '2026-11-21', '2026-11-22']);
    expect(r.encargadoCpe).toBe('Edison Mafla');
    expect(crearDistribucionDiasSchema.parse(base).cantonCpe).toBeUndefined();
  });

  it('rechaza días repetidos, inexistentes, vacíos o más de 7', () => {
    expect(crearDistribucionDiasSchema.safeParse({ ...base, fechas: ['2026-11-20', '2026-11-20'] }).success).toBe(false);
    expect(crearDistribucionDiasSchema.safeParse({ ...base, fechas: ['2026-02-30'] }).success).toBe(false);
    expect(crearDistribucionDiasSchema.safeParse({ ...base, fechas: [] }).success).toBe(false);
    const ocho = Array.from({ length: 8 }, (_, i) => `2026-11-${String(10 + i)}`);
    expect(crearDistribucionDiasSchema.safeParse({ ...base, fechas: ocho }).success).toBe(false);
  });

  it('rechaza claves de cargo inválidas, campos extra y caracteres de control', () => {
    expect(crearDistribucionDiasSchema.safeParse({ ...base, excluirCargos: ['supervisor; drop'] }).success).toBe(false);
    expect(crearDistribucionDiasSchema.safeParse({ ...base, otro: 1 }).success).toBe(false);
    expect(crearDistribucionDiasSchema.safeParse({ ...base, nombre: 'Fin\u0007de semana' }).success).toBe(false);
    expect(crearDistribucionDiasSchema.safeParse({ ...base, nombre: 'ab' }).success).toBe(false);
  });
});

describe('agregarPersonaDistribucionSchema', () => {
  it('persona registrada: solo día e id', () => {
    const id = '22222222-2222-4222-8222-222222222222';
    expect(agregarPersonaDistribucionSchema.parse({ tipo: 'REGISTRADA', fecha: '2026-11-20', operadorId: id })).toEqual({ tipo: 'REGISTRADA', fecha: '2026-11-20', operadorId: id });
    expect(agregarPersonaDistribucionSchema.safeParse({ tipo: 'REGISTRADA', fecha: '2026-11-20', operadorId: 'x' }).success).toBe(false);
  });

  it('persona externa: valida cédula (dígito verificador), celular y sexo', () => {
    const ext = { tipo: 'EXTERNA', fecha: '2026-11-20', nombres: 'RUIZ ANA', cedula: CEDULA, sexo: 'F', cargo: 'Apoyo' };
    expect(agregarPersonaDistribucionSchema.safeParse(ext).success).toBe(true);
    expect(agregarPersonaDistribucionSchema.safeParse({ ...ext, cedula: '1003456789' }).success).toBe(false);
    expect(agregarPersonaDistribucionSchema.safeParse({ ...ext, telefono: '12345' }).success).toBe(false);
    expect(agregarPersonaDistribucionSchema.safeParse({ ...ext, sexo: 'X' }).success).toBe(false);
    expect(agregarPersonaDistribucionSchema.safeParse({ ...ext, cargo: '' }).success).toBe(false);
  });
});

describe('editarPersonaDistribucionSchema', () => {
  it('exige al menos un cambio; vacío vale para quitar el dato', () => {
    expect(editarPersonaDistribucionSchema.safeParse({}).success).toBe(false);
    expect(editarPersonaDistribucionSchema.parse({ canton: '' })).toEqual({ canton: '' });
    expect(editarPersonaDistribucionSchema.safeParse({ cedula: CEDULA }).success).toBe(false);
  });
});

describe('reporte y candidatos', () => {
  it('filtros opcionales y búsqueda corta', () => {
    expect(reporteDistribucionSchema.parse({})).toEqual({});
    expect(reporteDistribucionSchema.safeParse({ fecha: 'hoy' }).success).toBe(false);
    expect(candidatosDistribucionSchema.parse({})).toEqual({ buscar: '' });
    expect(candidatosDistribucionSchema.safeParse({ buscar: 'x'.repeat(61) }).success).toBe(false);
  });
});
