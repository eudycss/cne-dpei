import { HERRAMIENTAS_MODELO, validarConsulta } from './herramientas';

describe('validarConsulta', () => {
  it('acepta las tres consultas con parámetros válidos', () => {
    expect(validarConsulta('buscar_recinto', { texto: ' colegio Ibarra ' })).toEqual({
      tipo: 'buscar_recinto',
      texto: 'colegio Ibarra',
    });
    expect(validarConsulta('recintos_caidos', {})).toEqual({ tipo: 'recintos_caidos', canton: null });
    expect(validarConsulta('recintos_caidos', { canton: null })).toEqual({ tipo: 'recintos_caidos', canton: null });
    expect(validarConsulta('recintos_caidos', { canton: 'Cotacachi' })).toEqual({ tipo: 'recintos_caidos', canton: 'Cotacachi' });
    expect(validarConsulta('recintos_de_tecnico', { nombre: 'Pérez' })).toEqual({ tipo: 'recintos_de_tecnico', nombre: 'Pérez' });
  });

  it('rechaza una consulta que no está en la lista (el modelo no puede pedir otra cosa)', () => {
    expect(validarConsulta('borrar_recinto', { codigo: '1008' })).toBeNull();
    expect(validarConsulta('__proto__', {})).toBeNull();
  });

  it.each([
    ['buscar_recinto', {}],
    ['buscar_recinto', { texto: '' }],
    ['buscar_recinto', { texto: 'x'.repeat(81) }],
    ['buscar_recinto', { texto: 42 }],
    ['buscar_recinto', null],
    ['recintos_caidos', { canton: 'x'.repeat(41) }],
    ['recintos_de_tecnico', { nombre: 'a' }],
  ])('rechaza parámetros inválidos de %s (%j)', (nombre, args) => {
    expect(validarConsulta(nombre, args)).toBeNull();
  });

  it('cada herramienta que se ofrece al modelo tiene su validación', () => {
    for (const h of HERRAMIENTAS_MODELO) {
      const ejemplo = { texto: 'a', canton: 'Ibarra', nombre: 'Juan' };
      expect(validarConsulta(h.function.name, ejemplo)).not.toBeNull();
    }
  });
});
