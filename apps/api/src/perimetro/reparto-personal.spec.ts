import { barajar, repartirPorSexo, type PersonaReparto } from './reparto-personal';

const persona = (id: string, sexo: string | null, enOtroPlan = false): PersonaReparto => ({ id, nombre: `P ${id}`, sexo, enOtroPlan });
const grupo = (prefijo: string, sexo: string | null, n: number) => Array.from({ length: n }, (_, i) => persona(`${prefijo}${i + 1}`, sexo));
const sexoDe = (lista: PersonaReparto[]) => new Map(lista.map((p) => [p.id, p.sexo]));

describe('repartirPorSexo', () => {
  it('respeta el % y reparte a las mujeres a lo largo de los puestos', () => {
    const todos = [...grupo('f', 'F', 10), ...grupo('m', 'M', 10)];
    const r = repartirPorSexo(todos, 10, 30);
    const sexos = r.personas.map((p) => sexoDe(todos).get(p.id));
    expect(sexos.filter((s) => s === 'F')).toHaveLength(3);
    // No van juntas: entre dos mujeres hay al menos un hombre.
    const posiciones = sexos.flatMap((s, i) => (s === 'F' ? [i] : []));
    for (let i = 1; i < posiciones.length; i++) expect(posiciones[i] - posiciones[i - 1]).toBeGreaterThan(1);
    expect(r.faltan).toBe(0);
  });

  it('50 % alterna; 0 % y 100 % usan un solo sexo si alcanza', () => {
    const todos = [...grupo('f', 'F', 5), ...grupo('m', 'M', 5)];
    const s = sexoDe(todos);
    expect(repartirPorSexo(todos, 4, 50).personas.map((p) => s.get(p.id))).toEqual(['M', 'F', 'M', 'F']);
    expect(repartirPorSexo(todos, 3, 0).personas.every((p) => s.get(p.id) === 'M')).toBe(true);
    expect(repartirPorSexo(todos, 3, 100).personas.every((p) => s.get(p.id) === 'F')).toBe(true);
  });

  it('si falta un sexo completa con el otro y luego con quienes no tienen sexo registrado', () => {
    const todos = [persona('f1', 'F'), persona('m1', 'M'), persona('x1', null)];
    const r = repartirPorSexo(todos, 3, 100);
    expect(r.personas.map((p) => p.id)).toEqual(['f1', 'm1', 'x1']);
  });

  it('si no alcanza la gente, dice cuántos puestos faltan; nadie se repite', () => {
    const r = repartirPorSexo([persona('f1', 'F'), persona('m1', 'M')], 5, 50);
    expect(r.personas).toHaveLength(2);
    expect(r.faltan).toBe(3);
    expect(new Set(r.personas.map((p) => p.id)).size).toBe(2);
  });

  it('respeta el orden de preferencia de cada grupo', () => {
    const r = repartirPorSexo([persona('m1', 'M'), persona('m2', 'M', true)], 1, 0);
    expect(r.personas[0].id).toBe('m1');
  });

  it('el resultado no incluye el sexo', () => {
    const r = repartirPorSexo([persona('f1', 'F')], 1, 100);
    expect(Object.keys(r.personas[0]).sort()).toEqual(['enOtroPlan', 'id', 'nombre']);
  });

  it('total cero o sin candidatos', () => {
    expect(repartirPorSexo([persona('f1', 'F')], 0, 50)).toEqual({ personas: [], faltan: 0 });
    expect(repartirPorSexo([], 2, 50)).toEqual({ personas: [], faltan: 2 });
  });

  it('barajar mezcla el orden pero deja primero a quienes no están en otro plan', () => {
    const lista = [persona('a', 'M', true), persona('b', 'M'), persona('c', 'M'), persona('d', 'M', true)];
    const r = barajar(lista, () => 0);
    expect(r.slice(0, 2).every((p) => !p.enOtroPlan)).toBe(true);
    expect(r.slice(2).every((p) => p.enOtroPlan)).toBe(true);
    expect(r.map((p) => p.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    // El azar decide el orden dentro del grupo: con 0 el primero va al fondo antes de agrupar.
    expect(barajar([persona('x', 'M'), persona('y', 'M'), persona('z', 'M')], () => 0).map((p) => p.id)).toEqual(['y', 'z', 'x']);
  });
});
