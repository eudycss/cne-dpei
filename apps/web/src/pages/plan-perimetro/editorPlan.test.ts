import { describe, expect, it } from 'vitest';
import { guardarPlanPerimetroSchema } from '@cne/shared-validation';
import {
  MAX_HISTORIAL,
  cuerpoGuardar,
  describirAccion,
  editorReducer,
  estadoInicial,
  nuevoId,
  puestosConPersona,
  type AccionEditor,
  type BorradorPlan,
  type EstadoEditor,
} from './editorPlan';
import { distancia, longitudAnillo } from './geometria';

type Punto = [number, number];
// Cuadrado de ~100 m de lado cerca de la Delegación.
const M = 1 / 111320;
const C: Punto = [0.35849, -78.11886];
const p = (dn: number, de: number): Punto => [C[0] + dn * M, C[1] + de * M];
const CUADRADO: Punto[] = [p(0, 0), p(100, 0), p(100, 100), p(0, 100)];

const BASE: BorradorPlan = {
  nombre: 'Coliseo',
  perimetro: null,
  zonas: [],
  vallas: [],
  ajustes: { pctMujeres: 50, largoValla: 2.5, mostrarNombres: true, alinearVallas: true },
  puestos: [],
};
const PERSONA = { id: '22222222-2222-4222-8222-222222222222', nombre: 'PÉREZ JUAN', tieneFoto: false };

const correr = (inicial: BorradorPlan, ...acciones: AccionEditor[]): EstadoEditor =>
  acciones.reduce(editorReducer, estadoInicial(inicial));

describe('dibujar', () => {
  it('el perímetro se arma con clics y se cierra al terminar con 3 puntos o más', () => {
    const e = correr(
      BASE,
      { tipo: 'empezarDibujo', dibujo: { que: 'perimetro' } },
      ...CUADRADO.map((punto): AccionEditor => ({ tipo: 'agregarPunto', punto })),
      { tipo: 'terminarDibujo' },
    );
    expect(e.plan.perimetro).toEqual(CUADRADO);
    expect(e.dibujo).toBeNull();
    expect(e.cambios).toBe(true);
  });

  it('con menos de 3 puntos no termina; deshacer quita el último y cancelar no cambia el plan', () => {
    const dibujando = correr(
      BASE,
      { tipo: 'empezarDibujo', dibujo: { que: 'perimetro' } },
      { tipo: 'agregarPunto', punto: CUADRADO[0] },
      { tipo: 'agregarPunto', punto: CUADRADO[1] },
      { tipo: 'terminarDibujo' },
    );
    expect(dibujando.dibujo).toEqual({ que: 'perimetro' });
    expect(editorReducer(dibujando, { tipo: 'deshacerPunto' }).puntos).toEqual([CUADRADO[0]]);
    const cancelado = editorReducer(dibujando, { tipo: 'cancelarDibujo' });
    expect(cancelado).toMatchObject({ dibujo: null, puntos: [], cambios: false });
    expect(cancelado.plan.perimetro).toBeNull();
  });

  it('sin modo de dibujo, un clic no hace nada', () => {
    expect(correr(BASE, { tipo: 'agregarPunto', punto: C }).cambios).toBe(false);
  });

  it('una zona nueva se nombra por su tipo y número', () => {
    const zona = (e: EstadoEditor) =>
      [
        { tipo: 'empezarDibujo', dibujo: { que: 'zona', tipo: 'peligro' } },
        ...CUADRADO.slice(0, 3).map((punto) => ({ tipo: 'agregarPunto', punto })),
        { tipo: 'terminarDibujo' },
      ].reduce((s, a) => editorReducer(s, a as AccionEditor), e);
    const e = zona(zona(estadoInicial(BASE)));
    expect(e.plan.zonas.map((z) => [z.nombre, z.tipo])).toEqual([
      ['Peligro 1', 'peligro'],
      ['Peligro 2', 'peligro'],
    ]);
    expect(e.plan.zonas[0].id).toMatch(/^[A-Za-z0-9_-]{1,40}$/);
  });

  it('en modo puesto cada clic agrega un puesto vacío numerado', () => {
    const e = correr(
      BASE,
      { tipo: 'empezarDibujo', dibujo: { que: 'puesto' } },
      { tipo: 'agregarPunto', punto: p(1, 1) },
      { tipo: 'agregarPunto', punto: p(2, 2) },
    );
    expect(e.plan.puestos.map((x) => [x.orden, x.persona, x.lat])).toEqual([
      [1, null, p(1, 1)[0]],
      [2, null, p(2, 2)[0]],
    ]);
    expect(e.dibujo).toEqual({ que: 'puesto' });
  });
});

describe('vértices', () => {
  const conPerimetro = { ...BASE, perimetro: CUADRADO };

  it('mover un vértice cambia solo ese punto', () => {
    const e = correr(conPerimetro, { tipo: 'moverVertice', objetivo: { que: 'perimetro' }, indice: 1, punto: p(120, 0) });
    expect(e.plan.perimetro).toEqual([CUADRADO[0], p(120, 0), CUADRADO[2], CUADRADO[3]]);
  });

  it('quitar un vértice deja al menos 3', () => {
    const e = correr(
      conPerimetro,
      { tipo: 'quitarVertice', objetivo: { que: 'perimetro' }, indice: 0 },
      { tipo: 'quitarVertice', objetivo: { que: 'perimetro' }, indice: 0 },
    );
    expect(e.plan.perimetro).toHaveLength(3);
  });

  it('los vértices de una zona se editan igual', () => {
    const plan = { ...BASE, zonas: [{ id: 'z1', tipo: 'segura' as const, nombre: 'Patio', coords: CUADRADO }] };
    const e = correr(plan, { tipo: 'moverVertice', objetivo: { que: 'zona', id: 'z1' }, indice: 0, punto: p(-5, -5) });
    expect(e.plan.zonas[0].coords[0]).toEqual(p(-5, -5));
  });
});

describe('repartir', () => {
  const conPerimetro = { ...BASE, perimetro: CUADRADO };

  it('reparte puestos a la misma distancia sobre el perímetro', () => {
    const e = correr(conPerimetro, { tipo: 'repartirPuestos', total: 8 });
    expect(e.plan.puestos).toHaveLength(8);
    const pts = e.plan.puestos.map((x): Punto => [x.lat, x.lng]);
    const paso = longitudAnillo(CUADRADO) / 8;
    for (let i = 1; i < pts.length; i++) expect(distancia(pts[i - 1], pts[i])).toBeCloseTo(paso, 0);
    expect(e.plan.puestos.map((x) => x.orden)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('nunca quita a quien tiene persona: sobran los vacíos del final', () => {
    const plan: BorradorPlan = {
      ...conPerimetro,
      puestos: [
        { id: 'a', orden: 1, lat: 0, lng: 0, etiqueta: null, persona: null },
        { id: 'b', orden: 2, lat: 0, lng: 0, etiqueta: null, persona: PERSONA },
        { id: 'c', orden: 3, lat: 0, lng: 0, etiqueta: 'Policía', persona: null },
      ],
    };
    expect(puestosConPersona(plan)).toBe(1);
    expect(correr(plan, { tipo: 'repartirPuestos', total: 2 }).plan.puestos.map((x) => x.id)).toEqual(['a', 'b']);
    // Pedir menos de los que tienen persona deja a esas personas.
    expect(correr(plan, { tipo: 'repartirPuestos', total: 0 }).plan.puestos.map((x) => x.id)).toEqual(['b']);
  });

  it('sin perímetro no reparte', () => {
    expect(correr(BASE, { tipo: 'repartirPuestos', total: 5 }).cambios).toBe(false);
    expect(correr(BASE, { tipo: 'repartirVallas', total: 5 }).cambios).toBe(false);
  });

  it('las vallas se alinean al tramo del perímetro (0° a lo largo del borde norte-sur)', () => {
    // 8 vallas en 400 m: una cada 50 m (la 0 en 0 m y la 3 en 150 m, a media cuadra).
    const e = correr(conPerimetro, { tipo: 'repartirVallas', total: 8 });
    expect(e.plan.vallas).toHaveLength(8);
    // Primer tramo: de p(0,0) a p(100,0), hacia el norte.
    expect(e.plan.vallas[0].angulo).toBeCloseTo(0, 3);
    // Segundo tramo: hacia el este (90°).
    expect(e.plan.vallas[3].angulo).toBeCloseTo(90, 3);
  });

  it('sin alinear, las vallas conservan su ángulo', () => {
    const plan = { ...conPerimetro, ajustes: { ...BASE.ajustes, alinearVallas: false }, vallas: [{ id: 'v', lat: 0, lng: 0, angulo: 33 }] };
    expect(correr(plan, { tipo: 'repartirVallas', total: 2 }).plan.vallas.map((v) => v.angulo)).toEqual([33, 0]);
  });
});

describe('puestos, vallas y zonas', () => {
  const plan: BorradorPlan = {
    ...BASE,
    perimetro: CUADRADO,
    puestos: [
      { id: 'a', orden: 1, lat: 0, lng: 0, etiqueta: null, persona: null },
      { id: 'b', orden: 2, lat: 0, lng: 0, etiqueta: null, persona: null },
    ],
    vallas: [{ id: 'v', lat: p(50, -3)[0], lng: p(50, -3)[1], angulo: 45 }],
    zonas: [{ id: 'z', tipo: 'peligro', nombre: 'Tarima', coords: CUADRADO }],
  };

  it('quitar un puesto renumera los demás', () => {
    expect(correr(plan, { tipo: 'quitarPuesto', id: 'a' }).plan.puestos.map((x) => [x.id, x.orden])).toEqual([['b', 1]]);
  });

  it('la etiqueta libre se limpia; vacía vuelve a null', () => {
    const e = correr(plan, { tipo: 'etiquetaPuesto', id: 'a', etiqueta: 'Policía\u0007 1' });
    expect(e.plan.puestos[0].etiqueta).toBe('Policía 1');
    expect(correr(plan, { tipo: 'etiquetaPuesto', id: 'a', etiqueta: '   ' }).plan.puestos[0].etiqueta).toBeNull();
  });

  it('mover una valla la alinea al tramo más cercano; girarla suma grados', () => {
    const movida = correr(plan, { tipo: 'moverValla', id: 'v', punto: p(50, 98) });
    expect(movida.plan.vallas[0].angulo).toBeCloseTo(0, 3); // borde este: norte-sur
    expect(correr(plan, { tipo: 'girarValla', id: 'v', grados: 150 }).plan.vallas[0].angulo).toBe(15);
  });

  it('editar y quitar zonas', () => {
    const e = correr(plan, { tipo: 'editarZona', id: 'z', nombre: 'Escenario', tipoZona: 'acceso' });
    expect(e.plan.zonas[0]).toMatchObject({ nombre: 'Escenario', tipo: 'acceso' });
    expect(correr(plan, { tipo: 'quitarZona', id: 'z' }).plan.zonas).toEqual([]);
  });

  it('reiniciar descarta los cambios', () => {
    const e = correr(plan, { tipo: 'borrarPerimetro' }, { tipo: 'reiniciar', plan });
    expect(e.plan.perimetro).toEqual(CUADRADO);
    expect(e.cambios).toBe(false);
  });
});

describe('cuerpoGuardar', () => {
  it('arma un cuerpo que el API acepta: persona por id, etiqueta limpia y la vista actual', () => {
    const plan = {
      ...BASE,
      lugar: null,
      perimetro: CUADRADO,
      zonas: [{ id: 'z', tipo: 'segura' as const, nombre: '  ', coords: CUADRADO }],
      puestos: [
        { id: 'a', orden: 1, lat: C[0], lng: C[1], etiqueta: null, persona: PERSONA },
        { id: 'b', orden: 2, lat: C[0], lng: C[1], etiqueta: ' Policía ', persona: null },
      ],
    };
    const vista = { lat: C[0], lng: C[1], zoom: 18, bearing: 30, pitch: 0 };
    const cuerpo = cuerpoGuardar(plan, vista, 7);
    expect(cuerpo.puestos).toEqual([
      { lat: C[0], lng: C[1], operadorCdaId: PERSONA.id, etiqueta: null },
      { lat: C[0], lng: C[1], operadorCdaId: null, etiqueta: 'Policía' },
    ]);
    expect(cuerpo.zonas[0].nombre).toBe('Segura');
    expect(cuerpo).toMatchObject({ version: 7, vista });
    expect(guardarPlanPerimetroSchema.safeParse(cuerpo).success).toBe(true);
  });
});

describe('deshacer', () => {
  const conPerimetro = { ...BASE, perimetro: CUADRADO };

  it('vuelve paso a paso; al llegar al original ya no hay cambios', () => {
    const e = correr(conPerimetro, { tipo: 'borrarPerimetro' }, { tipo: 'nombre', nombre: 'Otro' });
    const uno = editorReducer(e, { tipo: 'deshacer' });
    expect(uno.plan).toMatchObject({ nombre: 'Coliseo', perimetro: null });
    expect(uno.cambios).toBe(true);
    const dos = editorReducer(uno, { tipo: 'deshacer' });
    expect(dos.plan.perimetro).toEqual(CUADRADO);
    expect(dos.cambios).toBe(false);
    expect(editorReducer(dos, { tipo: 'deshacer' })).toBe(dos);
  });

  it('un arrastre completo es un solo paso, aunque mueva el punto muchas veces', () => {
    const objetivo = { que: 'perimetro' } as const;
    const e = correr(
      conPerimetro,
      { tipo: 'moverVertice', objetivo, indice: 0, punto: p(-1, 0), vivo: true },
      { tipo: 'moverVertice', objetivo, indice: 0, punto: p(-2, 0), vivo: true },
      { tipo: 'moverVertice', objetivo, indice: 0, punto: p(-3, 0) },
    );
    expect(e.historial).toHaveLength(1);
    expect(e.arrastrando).toBe(false);
    expect(editorReducer(e, { tipo: 'deshacer' }).plan.perimetro).toEqual(CUADRADO);
  });

  it('guarda como mucho MAX_HISTORIAL pasos', () => {
    const acciones = Array.from({ length: MAX_HISTORIAL + 10 }, (_, i): AccionEditor => ({ tipo: 'nombre', nombre: `N${i}` }));
    expect(correr(BASE, ...acciones).historial).toHaveLength(MAX_HISTORIAL);
  });

  it('reiniciar borra el historial', () => {
    const e = correr(conPerimetro, { tipo: 'borrarPerimetro' }, { tipo: 'reiniciar', plan: conPerimetro });
    expect(e.historial).toEqual([]);
  });
});

describe('casos límite', () => {
  it('un perímetro de largo cero no rompe el reparto', () => {
    const plano = { ...BASE, perimetro: [C, C, C] as Punto[] };
    expect(() => correr(plano, { tipo: 'repartirPuestos', total: 5 })).not.toThrow();
    expect(correr(plano, { tipo: 'repartirPuestos', total: 5 }).plan.puestos).toEqual([]);
    expect(correr(plano, { tipo: 'repartirVallas', total: 5 }).plan.vallas).toEqual([]);
  });

  it('un total que no es número no reparte', () => {
    const conPerimetro = { ...BASE, perimetro: CUADRADO };
    expect(correr(conPerimetro, { tipo: 'repartirPuestos', total: Number.NaN }).cambios).toBe(false);
    expect(correr(conPerimetro, { tipo: 'repartirVallas', total: Number.NaN }).cambios).toBe(false);
  });

  it('un clic pegado al anterior se ignora y un polígono sin área no se cierra', () => {
    const e = correr(
      BASE,
      { tipo: 'empezarDibujo', dibujo: { que: 'perimetro' } },
      { tipo: 'agregarPunto', punto: p(0, 0) },
      { tipo: 'agregarPunto', punto: p(0.1, 0) },
      { tipo: 'agregarPunto', punto: p(10, 0) },
      { tipo: 'agregarPunto', punto: p(20, 0) },
    );
    expect(e.puntos).toHaveLength(3);
    // Los 3 puntos están en línea: área 0.
    const t = editorReducer(e, { tipo: 'terminarDibujo' });
    expect(t).toBe(e);
    expect(describirAccion({ tipo: 'terminarDibujo' }, e, t)).toBe('La figura no tiene área: mueva algún punto');
  });

  it('quitar un vértice que no existe no marca cambios', () => {
    expect(correr({ ...BASE, perimetro: CUADRADO }, { tipo: 'quitarVertice', objetivo: { que: 'perimetro' }, indice: 9 }).cambios).toBe(false);
  });

  it('repartir vallas conserva los ids existentes y recorta al pedir menos', () => {
    const conPerimetro = { ...BASE, perimetro: CUADRADO };
    const ocho = correr(conPerimetro, { tipo: 'repartirVallas', total: 8 });
    const ids = ocho.plan.vallas.map((v) => v.id);
    expect(new Set(ids).size).toBe(8);
    const tres = editorReducer(ocho, { tipo: 'repartirVallas', total: 3 });
    expect(tres.plan.vallas.map((v) => v.id)).toEqual(ids.slice(0, 3));
  });

  it('los ids nuevos sirven para el API', () => {
    for (let i = 0; i < 20; i++) expect(nuevoId()).toMatch(/^[A-Za-z0-9_-]{1,40}$/);
  });
});

describe('describirAccion', () => {
  it('anuncia lo que pasó en palabras', () => {
    const plan = { ...BASE, perimetro: CUADRADO, puestos: [{ id: 'a', orden: 1, lat: 0, lng: 0, etiqueta: null, persona: null }] };
    const antes = estadoInicial(plan);
    const quitar: AccionEditor = { tipo: 'quitarPuesto', id: 'a' };
    expect(describirAccion(quitar, antes, editorReducer(antes, quitar))).toBe('Puesto 1 quitado. Ctrl+Z para deshacer');
    const repartir: AccionEditor = { tipo: 'repartirVallas', total: 6 };
    expect(describirAccion(repartir, antes, editorReducer(antes, repartir))).toBe('6 vallas repartidas en el perímetro');
    // Mientras se arrastra no se anuncia cada movimiento.
    const vivo: AccionEditor = { tipo: 'moverVertice', objetivo: { que: 'perimetro' }, indice: 0, punto: p(1, 1), vivo: true };
    expect(describirAccion(vivo, antes, editorReducer(antes, vivo))).toBeNull();
  });
});
