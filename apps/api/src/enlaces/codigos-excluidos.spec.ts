import { codigosExcluidos, esRecintoMonitoreado } from './codigos-excluidos';

describe('esRecintoMonitoreado', () => {
  it.each(['CPE', 'cpe', ' CPE '])('deja fuera el CPE aunque la hoja lo escriba distinto (%p)', (codigo) => {
    expect(esRecintoMonitoreado(codigo)).toBe(false);
  });

  it.each(['1496', '978', 'CPE2'])('monitorea los recintos (%p)', (codigo) => {
    expect(esRecintoMonitoreado(codigo)).toBe(true);
  });

  it('entrega los códigos excluidos para filtrar el historial en la base', () => {
    expect(codigosExcluidos()).toEqual(['CPE']);
  });
});
