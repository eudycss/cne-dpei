import { describe, expect, it } from 'vitest';
import {
  agregarPersonaDistribucionSchema,
  candidatosDistribucionSchema,
  archivoContactosDia,
  celularInternacional,
  contactosDistribucionSchema,
  crearDistribucionDiasSchema,
  editarPersonaDistribucionSchema,
  intercambiarPersonaDistribucionSchema,
  tieneCupoDia,
  prefijoDia,
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

describe('celularInternacional', () => {
  it('pasa 09… y +593… a +5939… y quita espacios y guiones', () => {
    expect(celularInternacional('0991234567')).toBe('+593991234567');
    expect(celularInternacional('+593991234567')).toBe('+593991234567');
    expect(celularInternacional(' 099-123 4567 ')).toBe('+593991234567');
  });

  it('devuelve null para fijos, vacíos u otros formatos', () => {
    expect(celularInternacional('062123456')).toBeNull();
    expect(celularInternacional('')).toBeNull();
    expect(celularInternacional(null)).toBeNull();
    expect(celularInternacional('09912345')).toBeNull();
    expect(celularInternacional('5939912345678')).toBeNull();
  });
});

describe('contactosDistribucionSchema', () => {
  it('exige un día válido y nada más', () => {
    expect(contactosDistribucionSchema.parse({ fecha: '2026-11-20' })).toEqual({ fecha: '2026-11-20' });
    expect(contactosDistribucionSchema.safeParse({}).success).toBe(false);
    expect(contactosDistribucionSchema.safeParse({ fecha: '2026-11-20', otro: 1 }).success).toBe(false);
  });
});

describe('prefijoDia y archivoContactosDia', () => {
  it('abreviatura del día + número; nombre de archivo sin tildes', () => {
    expect(['2026-11-20', '2026-11-21', '2026-11-22', '2026-12-07'].map(prefijoDia)).toEqual(['VIE20', 'SAB21', 'DOM22', 'LUN07']);
    expect(archivoContactosDia('2026-11-21')).toBe('contactos-sabado-21.vcf');
    expect(archivoContactosDia('2026-11-25')).toBe('contactos-miercoles-25.vcf');
  });
});

describe('intercambio y cupo', () => {
  it('intercambiar exige un uuid y nada más', () => {
    expect(intercambiarPersonaDistribucionSchema.safeParse({ conId: '22222222-2222-4222-8222-222222222222' }).success).toBe(true);
    expect(intercambiarPersonaDistribucionSchema.safeParse({ conId: 'x' }).success).toBe(false);
    expect(intercambiarPersonaDistribucionSchema.safeParse({ conId: '22222222-2222-4222-8222-222222222222', otro: 1 }).success).toBe(false);
  });

  it('tieneCupoDia: solo hacia un día con menos personas de ese sexo', () => {
    expect(tieneCupoDia(21, 22)).toBe(true);
    expect(tieneCupoDia(22, 22)).toBe(false);
    expect(tieneCupoDia(23, 22)).toBe(false);
  });
});
