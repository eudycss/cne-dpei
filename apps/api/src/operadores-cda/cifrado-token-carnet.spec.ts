import { CifradoTokenCarnet } from './cifrado-token-carnet';

const CLAVE = 'a'.repeat(64);
const OTRA_CLAVE = 'b'.repeat(64);
const OP = '11111111-2222-4333-8444-555555555555';
const OTRO = '22222222-2222-4333-8444-555555555555';
const TOKEN = `CDA1${'ABCDEFGHJKLMN'.repeat(2)}`;

const con = (clave?: string) => new CifradoTokenCarnet({ get: () => clave } as never);

describe('CifradoTokenCarnet', () => {
  it('cifra y descifra el token de la misma persona; cada cifrado es distinto', () => {
    const c = con(CLAVE);
    const a = c.cifrar(TOKEN, OP)!;
    const b = c.cifrar(TOKEN, OP)!;
    expect(a).toMatch(/^v1:/);
    expect(a).not.toContain(TOKEN);
    expect(a).not.toBe(b);
    expect(c.descifrar(a, OP)).toBe(TOKEN);
    expect(a.length).toBeLessThanOrEqual(120);
  });

  it('no sirve copiado a otra persona, con otra clave ni alterado', () => {
    const a = con(CLAVE).cifrar(TOKEN, OP)!;
    expect(con(CLAVE).descifrar(a, OTRO)).toBeNull();
    expect(con(OTRA_CLAVE).descifrar(a, OP)).toBeNull();
    const bytes = Buffer.from(a.slice(3), 'base64');
    bytes[bytes.length - 1] ^= 1;
    expect(con(CLAVE).descifrar(`v1:${bytes.toString('base64')}`, OP)).toBeNull();
    expect(con(CLAVE).descifrar('v1:corto', OP)).toBeNull();
    expect(con(CLAVE).descifrar('v2:algo', OP)).toBeNull();
    // Base64 basura o con relleno raro: null, nunca una excepción.
    expect(con(CLAVE).descifrar(`v1:${'%%%'.repeat(30)}`, OP)).toBeNull();
    expect(con(CLAVE).descifrar(`v1:${Buffer.alloc(40, 7).toString('base64')}`, OP)).toBeNull();
  });

  it('sin clave: no cifra ni descifra, pero no impide arrancar', () => {
    const c = con(undefined);
    expect(c.disponible).toBe(false);
    expect(c.cifrar(TOKEN, OP)).toBeNull();
    expect(c.descifrar(con(CLAVE).cifrar(TOKEN, OP)!, OP)).toBeNull();
  });

  it('una clave mal formada detiene el arranque', () => {
    expect(() => con('corta')).toThrow('CARNET_TOKEN_KEY debe ser un hex de 64 caracteres');
    expect(() => con('z'.repeat(64))).toThrow();
  });
});
