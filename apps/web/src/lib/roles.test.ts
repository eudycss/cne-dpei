import { describe, it, expect } from 'vitest';
import { actuaComoAdmin, etiquetaRol } from './roles';

describe('etiquetaRol', () => {
  it('traduce los roles del sistema a un nombre legible', () => {
    expect(etiquetaRol('ADMINISTRADOR')).toBe('Administrador');
    expect(etiquetaRol('TECNICO_SUPERVISOR')).toBe('Técnico supervisor');
    expect(etiquetaRol('OPERADOR_CDA')).toBe('Operador CDA');
    expect(etiquetaRol('LECTOR')).toBe('Lector');
  });

  it('deja tal cual un rol desconocido', () => {
    expect(etiquetaRol('AUDITOR')).toBe('AUDITOR');
  });
});

describe('actuaComoAdmin', () => {
  it('es verdadero para el administrador y el analista provincial', () => {
    expect(actuaComoAdmin(['ADMINISTRADOR'])).toBe(true);
    expect(actuaComoAdmin(['ANALISTA_PROVINCIAL'])).toBe(true);
    expect(etiquetaRol('ANALISTA_PROVINCIAL')).toBe('Analista provincial');
  });

  it('es falso para los demás roles y sin sesión', () => {
    expect(actuaComoAdmin(['TECNICO_SUPERVISOR', 'LECTOR'])).toBe(false);
    expect(actuaComoAdmin([])).toBe(false);
    expect(actuaComoAdmin(undefined)).toBe(false);
  });
});
