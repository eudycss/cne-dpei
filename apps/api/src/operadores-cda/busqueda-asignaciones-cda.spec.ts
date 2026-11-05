import { armarBusquedaAsignaciones, type ParejaBuscada } from './busqueda-asignaciones-cda';

const ANA = { id: 'p-ana', apellidosNombres: 'PEREZ ANA', cedula: '1000000001', grupo: 'OPERADOR' };
const LUIS = { id: 'p-luis', apellidosNombres: 'MORA LUIS', cedula: '1000000002', grupo: 'ASISTENTE' };
const CHALTURA = { id: 'r-971', codigoRecinto: '971', nombre: 'UE Chaltura' };
const APUELA = { id: 'r-1487', codigoRecinto: '1487', nombre: 'UE Apuela' };

const pareja = (fecha: string, recinto: typeof CHALTURA | null, asistente: typeof LUIS | null, kit: string | null = null): ParejaBuscada => ({
  fecha,
  recinto,
  operador: ANA,
  asistente,
  kit: kit ? { codigoUnico: kit } : null,
});

describe('armarBusquedaAsignaciones', () => {
  const parejas = [
    pareja('2026-10-28', CHALTURA, LUIS, 'KIT-971'),
    pareja('2026-11-05', APUELA, null),
    pareja('2026-11-01', null, LUIS),
  ];

  it('cada persona con dónde fue, con quién y de qué, de la fecha más reciente a la más antigua', () => {
    const { personas } = armarBusquedaAsignaciones([ANA, LUIS], [], new Map(), parejas);

    expect(personas[0].asignaciones).toEqual([
      { fecha: '2026-11-05', recinto: { codigo: '1487', nombre: 'UE Apuela' }, como: 'OPERADOR', pareja: null },
      { fecha: '2026-11-01', recinto: null, como: 'OPERADOR', pareja: 'MORA LUIS' },
      { fecha: '2026-10-28', recinto: { codigo: '971', nombre: 'UE Chaltura' }, como: 'OPERADOR', pareja: 'MORA LUIS' },
    ]);
    expect(personas[1].asignaciones.map((a) => [a.fecha, a.como, a.pareja])).toEqual([
      ['2026-11-01', 'ASISTENTE', 'PEREZ ANA'],
      ['2026-10-28', 'ASISTENTE', 'PEREZ ANA'],
    ]);
  });

  it('una persona que nunca estuvo en una pareja sale con la lista vacía', () => {
    const otra = { ...LUIS, id: 'p-otra', apellidosNombres: 'NUEVA' };
    expect(armarBusquedaAsignaciones([otra], [], new Map(), parejas).personas[0].asignaciones).toEqual([]);
  });

  it('cada CDA con quiénes fueron y el kit; los NO CDA buscados quedan bajo su CDA', () => {
    const noCdas = new Map([['r-971', [{ codigo: '2001', nombre: 'Escuelita' }]]]);
    const { recintos } = armarBusquedaAsignaciones([], [CHALTURA, APUELA], noCdas, parejas);

    expect(recintos[0]).toEqual({
      id: 'r-971',
      codigo: '971',
      nombre: 'UE Chaltura',
      noCdas: [{ codigo: '2001', nombre: 'Escuelita' }],
      asignaciones: [{ fecha: '2026-10-28', operador: 'PEREZ ANA', asistente: 'MORA LUIS', kit: 'KIT-971' }],
    });
    expect(recintos[1].noCdas).toEqual([]);
    expect(recintos[1].asignaciones).toEqual([{ fecha: '2026-11-05', operador: 'PEREZ ANA', asistente: null, kit: null }]);
  });

  it('corta en 20 personas y 20 recintos', () => {
    const muchas = Array.from({ length: 25 }, (_, i) => ({ ...ANA, id: `p${i}` }));
    const muchos = Array.from({ length: 25 }, (_, i) => ({ ...CHALTURA, id: `r${i}` }));
    const r = armarBusquedaAsignaciones(muchas, muchos, new Map(), []);
    expect(r.personas).toHaveLength(20);
    expect(r.recintos).toHaveLength(20);
    expect(r.truncado).toBe(true);
    expect(armarBusquedaAsignaciones([ANA], [CHALTURA], new Map(), []).truncado).toBe(false);
  });
});
