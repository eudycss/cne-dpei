import { codigosFueraDelBot, seMuestraEnBot } from './fuera-del-bot';

describe('seMuestraEnBot', () => {
  it.each(['CPE', 'cpe', ' CPE '])('deja fuera el CPE aunque la hoja lo escriba distinto (%p)', (codigo) => {
    expect(seMuestraEnBot(codigo)).toBe(false);
  });

  it.each(['1496', '978', 'CPE2'])('muestra los recintos (%p)', (codigo) => {
    expect(seMuestraEnBot(codigo)).toBe(true);
  });

  it('entrega los códigos excluidos para filtrar en la base', () => {
    expect(codigosFueraDelBot()).toEqual(['CPE']);
  });
});
