import { describe, it, expect } from 'vitest';
import { etiquetaRol } from './roles';

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
