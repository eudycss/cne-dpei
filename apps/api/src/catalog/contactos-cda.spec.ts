import { claveTelefono, primerTelefono, telefonosEnTexto, textoConserjes, textoContactosBot, textoRector, type ContactosCda } from './contactos-cda';

const vacio: ContactosCda = {
  rectorNombre: null,
  rectorTelefono: null,
  conserjeNombre: null,
  conserjeTelefono: null,
  conserje2Nombre: null,
  conserje2Telefono: null,
};

describe('contactos del CDA', () => {
  it('sin datos todo queda vacío', () => {
    expect(textoRector(vacio)).toBe('');
    expect(textoConserjes(vacio)).toBe('');
    expect(textoContactosBot(vacio)).toBe('');
    expect(primerTelefono(vacio)).toBe('');
  });

  it('el reporte junta nombre y teléfono, y pone un conserje por línea', () => {
    const c = { ...vacio, rectorNombre: ' Ana ', rectorTelefono: '0991111111', conserjeNombre: 'Luis', conserjeTelefono: '0992222222', conserje2Telefono: '0993333333' };
    expect(textoRector(c)).toBe('Ana · 0991111111');
    expect(textoConserjes(c)).toBe('Luis · 0992222222\n0993333333');
  });

  it('el bot escribe "Rector: nombre, teléfono …" y cada conserje por separado', () => {
    const c = { ...vacio, rectorNombre: 'Ana', rectorTelefono: '0991111111', conserjeNombre: 'Luis', conserje2Nombre: 'Eva', conserje2Telefono: '0994444444' };
    expect(textoContactosBot(c)).toBe('Rector: Ana, teléfono 0991111111 · Conserje: Luis · Conserje: Eva, teléfono 0994444444');
  });

  it('un dato con saltos de línea o caracteres de control queda en una sola línea', () => {
    const c = { ...vacio, rectorNombre: ['Ana', '  Rector', String.fromCharCode(7)].join(String.fromCharCode(10)), rectorTelefono: '0991111111' };
    expect(textoContactosBot(c)).toBe('Rector: Ana Rector, teléfono 0991111111');
    expect(textoRector(c)).toBe('Ana Rector · 0991111111');
  });

  it('el bot no repite a un conserje con un número que ya salió', () => {
    const c = {
      ...vacio,
      rectorNombre: 'Silvia Morales',
      rectorTelefono: '0986659040',
      conserjeNombre: 'Gerardo Rodriguez',
      conserjeTelefono: '0959433354',
      conserje2Nombre: 'Hipolito Rodriguez',
      conserje2Telefono: '095 943 3354',
    };
    expect(textoContactosBot(c)).toBe(
      'Rector: Silvia Morales, teléfono 0986659040 · Conserje: Gerardo Rodriguez, teléfono 0959433354',
    );
  });

  it('claveTelefono compara solo los últimos 9 dígitos', () => {
    expect(claveTelefono('+593 98 665 9040')).toBe(claveTelefono('0986659040'));
    expect(claveTelefono('123')).toBe('');
    expect(telefonosEnTexto('Rector Ana 0986659040, inspector Luis 099-465-2948')).toEqual(['986659040', '994652948']);
  });

  it('el primer teléfono sigue el orden rector, conserje, conserje 2', () => {
    expect(primerTelefono({ ...vacio, conserjeTelefono: '0992222222', conserje2Telefono: '0993333333' })).toBe('0992222222');
    expect(primerTelefono({ ...vacio, rectorTelefono: '0991111111', conserjeTelefono: '0992222222' })).toBe('0991111111');
  });
});
