import { describe, expect, it } from 'vitest';
import { loginSchema } from './index';

describe('loginSchema', () => {
  it('acepta cédula válida', () => {
    expect(loginSchema.parse({ usuario: '1034567899', password: 'x' }).usuario).toBe('1034567899');
  });

  it('normaliza espacios y guiones en la cédula', () => {
    expect(loginSchema.parse({ usuario: ' 103 456-7899 ', password: 'x' }).usuario).toBe('1034567899');
  });

  it('acepta correo', () => {
    expect(loginSchema.parse({ usuario: 'admin@cne-imbabura.gob.ec', password: 'x' }).usuario).toBe(
      'admin@cne-imbabura.gob.ec',
    );
  });

  it('acepta el campo legado email (APK viejas)', () => {
    expect(loginSchema.parse({ email: 'admin@cne-imbabura.gob.ec', password: 'x' }).usuario).toBe(
      'admin@cne-imbabura.gob.ec',
    );
  });

  it('rechaza algo que no es cédula ni correo', () => {
    expect(loginSchema.safeParse({ usuario: 'abc', password: 'x' }).success).toBe(false);
  });

  it('rechaza cédula con dígito verificador inválido', () => {
    expect(loginSchema.safeParse({ usuario: '1034567890', password: 'x' }).success).toBe(false);
  });

  it('exige contraseña', () => {
    expect(loginSchema.safeParse({ usuario: '1034567899', password: '' }).success).toBe(false);
  });
});
