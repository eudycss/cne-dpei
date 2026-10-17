import { HERRAMIENTAS_MODELO, INSTRUCCIONES_MODELO, validarConsulta } from './herramientas';

const SIN_FILTROS = {
  tipo: 'consultar_recintos',
  cantones: [],
  parroquias: [],
  tecnicos: [],
  estado: null,
  sinTecnico: false,
  sinContacto: false,
  conContacto: false,
  agruparPor: null,
  soloContar: false,
};

describe('validarConsulta', () => {
  it('buscar_recinto recorta el texto', () => {
    expect(validarConsulta('buscar_recinto', { texto: ' colegio Ibarra ' })).toEqual({
      tipo: 'buscar_recinto',
      texto: 'colegio Ibarra',
    });
  });

  it('consultar_recintos sin filtros (o con null) es "todos los recintos"', () => {
    expect(validarConsulta('consultar_recintos', {})).toEqual(SIN_FILTROS);
    expect(validarConsulta('consultar_recintos', null)).toEqual(SIN_FILTROS);
    expect(validarConsulta('consultar_recintos', { cantones: null, estado: null, agrupar_por: null })).toEqual(SIN_FILTROS);
  });

  it('consultar_recintos con todos los filtros', () => {
    expect(
      validarConsulta('consultar_recintos', {
        cantones: [' Pimampiro ', 'Urcuquí', ''],
        parroquias: ['Ilumán'],
        tecnicos: ['Willy'],
        estado: 'caido',
        sin_tecnico: true,
        sin_contacto: 'true',
        con_contacto: true,
        agrupar_por: 'canton',
        solo_contar: true,
      }),
    ).toEqual({
      tipo: 'consultar_recintos',
      cantones: ['Pimampiro', 'Urcuquí'],
      parroquias: ['Ilumán'],
      tecnicos: ['Willy'],
      estado: 'caido',
      sinTecnico: true,
      sinContacto: true,
      conContacto: true,
      agruparPor: 'canton',
      soloContar: true,
    });
  });

  it('tolera lo que los modelos mandan distinto: texto suelto, mayúsculas, tildes y sinónimos', () => {
    expect(validarConsulta('consultar_recintos', { cantones: 'Ibarra' })).toMatchObject({ cantones: ['Ibarra'] });
    expect(validarConsulta('consultar_recintos', { estado: 'Caído' })).toMatchObject({ estado: 'caido' });
    expect(validarConsulta('consultar_recintos', { estado: 'FALLO' })).toMatchObject({ estado: 'caido' });
    expect(validarConsulta('consultar_recintos', { estado: 'activos' })).toMatchObject({ estado: 'activo' });
    expect(validarConsulta('consultar_recintos', { agrupar_por: 'Técnico' })).toMatchObject({ agruparPor: 'tecnico' });
  });

  it('un valor desconocido se ignora en vez de perder la consulta', () => {
    expect(validarConsulta('consultar_recintos', { estado: 'raro', agrupar_por: 'color', sin_tecnico: 'si' })).toEqual(SIN_FILTROS);
  });

  it('estadisticas: hoy/dia, semana o mes; lo desconocido es hoy', () => {
    expect(validarConsulta('estadisticas', { periodo: 'semana' })).toEqual({ tipo: 'estadisticas', periodo: 'semana' });
    expect(validarConsulta('estadisticas', { periodo: 'Hoy' })).toEqual({ tipo: 'estadisticas', periodo: 'dia' });
    expect(validarConsulta('estadisticas', { periodo: 'MES' })).toEqual({ tipo: 'estadisticas', periodo: 'mes' });
    expect(validarConsulta('estadisticas', {})).toEqual({ tipo: 'estadisticas', periodo: 'dia' });
  });

  it('rechaza una consulta que no está en la lista (el modelo no puede pedir otra cosa)', () => {
    expect(validarConsulta('borrar_recinto', { codigo: '1008' })).toBeNull();
    expect(validarConsulta('__proto__', {})).toBeNull();
    expect(validarConsulta('recintos_caidos', {})).toBeNull();
  });

  it.each([
    ['buscar_recinto', {}],
    ['buscar_recinto', { texto: '' }],
    ['buscar_recinto', { texto: 'x'.repeat(81) }],
    ['buscar_recinto', { texto: 42 }],
    ['buscar_recinto', null],
    ['consultar_recintos', { cantones: ['x'.repeat(61)] }],
    ['consultar_recintos', { cantones: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }],
    ['consultar_recintos', { tecnicos: [42] }],
    ['consultar_recintos', { parroquias: { a: 1 } }],
  ])('rechaza parámetros inválidos de %s (%j)', (nombre, args) => {
    expect(validarConsulta(nombre, args)).toBeNull();
  });

  it('las instrucciones piden solo los nombres de los técnicos si no piden sus recintos', () => {
    expect(INSTRUCCIONES_MODELO).toContain('"lista los técnicos"');
    expect(INSTRUCCIONES_MODELO).toContain('no piden sus recintos, usa siempre solo_contar true');
  });

  it('cada herramienta que se ofrece al modelo tiene su validación', () => {
    for (const h of HERRAMIENTAS_MODELO) {
      const ejemplo = { texto: 'a', cantones: ['Ibarra'], periodo: 'dia' };
      expect(validarConsulta(h.function.name, ejemplo)).not.toBeNull();
    }
  });
});
