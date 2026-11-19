import type { AjustesPerimetro, PlanPerimetroDetalle, PuestoPerimetro, TipoZonaPerimetro, VistaPerimetro } from '@cne/shared-types';
import { LIMITES_PERIMETRO, type GuardarPlanPerimetroInput } from '@cne/shared-validation';
import { areaAnillo, distancia, puntosEquidistantes, tramoMasCercano, ZONAS_PERIMETRO } from './geometria';

// Editor del plan: un reducer puro (sin DOM ni mapa) con todas las acciones de
// edición. La pantalla solo despacha acciones y muestra el borrador.

type Punto = [number, number];

export type BorradorPlan = Pick<PlanPerimetroDetalle, 'nombre' | 'perimetro' | 'zonas' | 'vallas' | 'ajustes' | 'puestos'>;

/** Qué se está dibujando con clics en el mapa. */
export type Dibujo = { que: 'perimetro' } | { que: 'zona'; tipo: TipoZonaPerimetro } | { que: 'puesto' };

export interface EstadoEditor {
  plan: BorradorPlan;
  dibujo: Dibujo | null;
  /** Puntos del polígono en curso (perímetro o zona). */
  puntos: Punto[];
  cambios: boolean;
  /** Versiones anteriores del plan, para Deshacer (la última es la más reciente). */
  historial: BorradorPlan[];
  /** Hay un arrastre en curso: sus movimientos cuentan como un solo paso de Deshacer. */
  arrastrando: boolean;
}

/** Pasos de Deshacer que se guardan. */
export const MAX_HISTORIAL = 50;
/** Un clic a menos de esto del punto anterior se ignora (doble clic, mano temblorosa). */
export const DISTANCIA_MIN_PUNTO_M = 0.3;
/** Un polígono con menos área que esto es una línea o un punto: no se acepta. */
export const AREA_MIN_M2 = 1;

/** Perímetro o una zona: dueño de los vértices que se mueven. */
export type Objetivo = { que: 'perimetro' } | { que: 'zona'; id: string };

export type AccionEditor =
  | { tipo: 'reiniciar'; plan: BorradorPlan }
  | { tipo: 'nombre'; nombre: string }
  | { tipo: 'ajustes'; ajustes: Partial<AjustesPerimetro> }
  | { tipo: 'empezarDibujo'; dibujo: Dibujo }
  | { tipo: 'agregarPunto'; punto: Punto }
  | { tipo: 'deshacerPunto' }
  | { tipo: 'terminarDibujo' }
  | { tipo: 'cancelarDibujo' }
  | { tipo: 'deshacer' }
  /** `vivo`: mientras se arrastra (un solo paso de Deshacer por arrastre). */
  | { tipo: 'moverVertice'; objetivo: Objetivo; indice: number; punto: Punto; vivo?: boolean }
  | { tipo: 'quitarVertice'; objetivo: Objetivo; indice: number }
  | { tipo: 'borrarPerimetro' }
  | { tipo: 'editarZona'; id: string; nombre?: string; tipoZona?: TipoZonaPerimetro }
  | { tipo: 'quitarZona'; id: string }
  | { tipo: 'agregarPuesto'; punto: Punto }
  | { tipo: 'moverPuesto'; id: string; punto: Punto }
  | { tipo: 'quitarPuesto'; id: string }
  | { tipo: 'etiquetaPuesto'; id: string; etiqueta: string }
  | { tipo: 'repartirPuestos'; total: number }
  | { tipo: 'repartirVallas'; total: number }
  | { tipo: 'moverValla'; id: string; punto: Punto }
  | { tipo: 'girarValla'; id: string; grados: number }
  | { tipo: 'quitarValla'; id: string };

/** Id local de zona, valla o puesto nuevo (cumple /^[A-Za-z0-9_-]{1,40}$/ del API). */
export function nuevoId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID().replace(/-/g, '');
  // randomUUID exige HTTPS; por IP de la red local se usa getRandomValues.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function estadoInicial(plan: BorradorPlan): EstadoEditor {
  return { plan, dibujo: null, puntos: [], cambios: false, historial: [], arrastrando: false };
}

/** Puestos que tienen persona: repartir nunca los quita. */
export const puestosConPersona = (plan: BorradorPlan) => plan.puestos.filter((p) => p.persona).length;

const renumerar = (puestos: PuestoPerimetro[]): PuestoPerimetro[] => puestos.map((p, i) => ({ ...p, orden: i + 1 }));
const normalizarAngulo = (a: number) => ((a % 180) + 180) % 180;
const limpiar = (s: string, max: number) =>
  // eslint-disable-next-line no-control-regex
  s.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);

/** Aplica un cambio al plan guardando el estado anterior para Deshacer. */
function conPlan(e: EstadoEditor, plan: BorradorPlan): EstadoEditor {
  if (plan === e.plan) return e;
  return { ...e, plan, cambios: true, arrastrando: false, historial: [...e.historial.slice(-(MAX_HISTORIAL - 1)), e.plan] };
}

function verticesDe(plan: BorradorPlan, o: Objetivo): Punto[] | null {
  return o.que === 'perimetro' ? plan.perimetro : (plan.zonas.find((z) => z.id === o.id)?.coords ?? null);
}

function conVertices(plan: BorradorPlan, o: Objetivo, coords: Punto[]): BorradorPlan {
  if (o.que === 'perimetro') return { ...plan, perimetro: coords };
  return { ...plan, zonas: plan.zonas.map((z) => (z.id === o.id ? { ...z, coords } : z)) };
}

/** Ángulo de una valla en `punto`: el del tramo más cercano si se alinean, o el que ya tenía. */
function anguloValla(plan: BorradorPlan, punto: Punto, actual: number): number {
  if (!plan.ajustes.alinearVallas || !plan.perimetro) return actual;
  const t = tramoMasCercano(plan.perimetro, punto);
  return t ? normalizarAngulo(t.rumbo) : actual;
}

function agregarPuesto(e: EstadoEditor, punto: Punto): EstadoEditor {
  if (e.plan.puestos.length >= LIMITES_PERIMETRO.maxPuestos) return e;
  const puesto = { id: nuevoId(), orden: 0, lat: punto[0], lng: punto[1], etiqueta: null, persona: null };
  return conPlan(e, { ...e.plan, puestos: renumerar([...e.plan.puestos, puesto]) });
}

function terminar(e: EstadoEditor): EstadoEditor {
  const { dibujo, puntos, plan } = e;
  const fin = { ...e, dibujo: null, puntos: [] };
  if (!dibujo || dibujo.que === 'puesto') return fin;
  // La pantalla deshabilita "Terminar" con menos de 3; un polígono sin área tampoco sirve.
  if (puntos.length < 3 || areaAnillo(puntos) < AREA_MIN_M2) return e;
  if (dibujo.que === 'perimetro') return conPlan(fin, { ...plan, perimetro: puntos });
  if (plan.zonas.length >= LIMITES_PERIMETRO.maxZonas) return fin;
  const n = plan.zonas.filter((z) => z.tipo === dibujo.tipo).length + 1;
  const zona = { id: nuevoId(), tipo: dibujo.tipo, nombre: `${ZONAS_PERIMETRO[dibujo.tipo].etiqueta} ${n}`, coords: puntos };
  return conPlan(fin, { ...plan, zonas: [...plan.zonas, zona] });
}

/**
 * Reparte `total` puestos a la misma distancia sobre el perímetro. Los puestos
 * con persona se conservan siempre (si sobran, se quitan primero los vacíos del
 * final) y mantienen su orden.
 */
function repartirPuestos(plan: BorradorPlan, total: number): BorradorPlan {
  if (!plan.perimetro || !Number.isFinite(total)) return plan;
  const n = Math.max(puestosConPersona(plan), Math.min(LIMITES_PERIMETRO.maxPuestos, Math.floor(total)));
  const puntos = puntosEquidistantes(plan.perimetro, n);
  if (puntos.length !== n) return plan; // perímetro de largo cero
  let lista = [...plan.puestos];
  for (let i = lista.length - 1; lista.length > n && i >= 0; i--) {
    if (!lista[i].persona) lista.splice(i, 1);
  }
  while (lista.length < n) {
    lista.push({ id: nuevoId(), orden: 0, lat: 0, lng: 0, etiqueta: null, persona: null });
  }
  lista = lista.map((p, i) => ({ ...p, lat: puntos[i].punto[0], lng: puntos[i].punto[1] }));
  return { ...plan, puestos: renumerar(lista) };
}

function repartirVallas(plan: BorradorPlan, total: number): BorradorPlan {
  if (!plan.perimetro || !Number.isFinite(total)) return plan;
  const n = Math.max(0, Math.min(LIMITES_PERIMETRO.maxVallas, Math.floor(total)));
  const puntos = puntosEquidistantes(plan.perimetro, n);
  if (puntos.length !== n) return plan; // perímetro de largo cero
  const vallas = puntos.map(({ punto, rumbo }, i) => ({
    id: plan.vallas[i]?.id ?? nuevoId(),
    lat: punto[0],
    lng: punto[1],
    angulo: plan.ajustes.alinearVallas ? normalizarAngulo(rumbo) : (plan.vallas[i]?.angulo ?? 0),
  }));
  return { ...plan, vallas };
}

export function editorReducer(e: EstadoEditor, a: AccionEditor): EstadoEditor {
  const { plan } = e;
  switch (a.tipo) {
    case 'reiniciar':
      return estadoInicial(a.plan);
    case 'deshacer': {
      if (e.historial.length === 0) return e;
      const historial = e.historial.slice(0, -1);
      return { ...e, plan: e.historial[e.historial.length - 1], historial, cambios: historial.length > 0, arrastrando: false };
    }
    case 'nombre':
      return conPlan(e, { ...plan, nombre: limpiar(a.nombre, LIMITES_PERIMETRO.maxNombrePlan) });
    case 'ajustes':
      return conPlan(e, { ...plan, ajustes: { ...plan.ajustes, ...a.ajustes } });
    case 'empezarDibujo':
      return { ...e, dibujo: a.dibujo, puntos: [] };
    case 'agregarPunto': {
      if (!e.dibujo) return e;
      if (e.dibujo.que === 'puesto') return agregarPuesto(e, a.punto);
      if (e.puntos.length >= LIMITES_PERIMETRO.maxPuntosAnillo) return e;
      const ultimo = e.puntos[e.puntos.length - 1];
      if (ultimo && distancia(ultimo, a.punto) < DISTANCIA_MIN_PUNTO_M) return e;
      return { ...e, puntos: [...e.puntos, a.punto] };
    }
    case 'deshacerPunto':
      return { ...e, puntos: e.puntos.slice(0, -1) };
    case 'terminarDibujo':
      return terminar(e);
    case 'cancelarDibujo':
      return { ...e, dibujo: null, puntos: [] };
    case 'moverVertice': {
      const v = verticesDe(plan, a.objetivo);
      if (!v || !v[a.indice]) return e;
      const movido = conVertices(plan, a.objetivo, v.map((p, i) => (i === a.indice ? a.punto : p)));
      // Durante un arrastre solo el primer movimiento guarda historial; al soltar se cierra el paso.
      if (e.arrastrando) return { ...e, plan: movido, cambios: true, arrastrando: !!a.vivo };
      const siguiente = conPlan(e, movido);
      return { ...siguiente, arrastrando: !!a.vivo };
    }
    case 'quitarVertice': {
      const v = verticesDe(plan, a.objetivo);
      if (!v || v.length <= 3 || !v[a.indice]) return e; // un polígono necesita 3 puntos
      return conPlan(e, conVertices(plan, a.objetivo, v.filter((_, i) => i !== a.indice)));
    }
    case 'borrarPerimetro':
      return conPlan(e, { ...plan, perimetro: null });
    case 'editarZona':
      return conPlan(e, {
        ...plan,
        zonas: plan.zonas.map((z) =>
          z.id === a.id
            ? {
                ...z,
                ...(a.nombre !== undefined ? { nombre: limpiar(a.nombre, LIMITES_PERIMETRO.maxNombre) } : {}),
                ...(a.tipoZona ? { tipo: a.tipoZona } : {}),
              }
            : z,
        ),
      });
    case 'quitarZona':
      return conPlan(e, { ...plan, zonas: plan.zonas.filter((z) => z.id !== a.id) });
    case 'agregarPuesto':
      return agregarPuesto(e, a.punto);
    case 'moverPuesto':
      return conPlan(e, {
        ...plan,
        puestos: plan.puestos.map((p) => (p.id === a.id ? { ...p, lat: a.punto[0], lng: a.punto[1] } : p)),
      });
    case 'quitarPuesto':
      return conPlan(e, { ...plan, puestos: renumerar(plan.puestos.filter((p) => p.id !== a.id)) });
    case 'etiquetaPuesto': {
      const etiqueta = limpiar(a.etiqueta, LIMITES_PERIMETRO.maxNombre);
      return conPlan(e, {
        ...plan,
        puestos: plan.puestos.map((p) => (p.id === a.id ? { ...p, etiqueta: etiqueta.trim() ? etiqueta : null } : p)),
      });
    }
    case 'repartirPuestos':
      return plan.perimetro ? conPlan(e, repartirPuestos(plan, a.total)) : e;
    case 'repartirVallas':
      return plan.perimetro ? conPlan(e, repartirVallas(plan, a.total)) : e;
    case 'moverValla':
      return conPlan(e, {
        ...plan,
        vallas: plan.vallas.map((v) =>
          v.id === a.id ? { ...v, lat: a.punto[0], lng: a.punto[1], angulo: anguloValla(plan, a.punto, v.angulo) } : v,
        ),
      });
    case 'girarValla':
      return conPlan(e, {
        ...plan,
        vallas: plan.vallas.map((v) => (v.id === a.id ? { ...v, angulo: normalizarAngulo(v.angulo + a.grados) } : v)),
      });
    case 'quitarValla':
      return conPlan(e, { ...plan, vallas: plan.vallas.filter((v) => v.id !== a.id) });
  }
}

/** Cuerpo del PUT: el borrador + la vista actual del mapa + la versión leída. */
export function cuerpoGuardar(
  plan: BorradorPlan & Pick<PlanPerimetroDetalle, 'lugar'>,
  vista: VistaPerimetro | null,
  version: number,
): GuardarPlanPerimetroInput {
  return {
    version,
    nombre: plan.nombre.trim(),
    lugar: plan.lugar,
    perimetro: plan.perimetro,
    zonas: plan.zonas.map((z) => ({ ...z, nombre: z.nombre.trim() || ZONAS_PERIMETRO[z.tipo].etiqueta })),
    vallas: plan.vallas,
    ajustes: plan.ajustes,
    vista,
    puestos: plan.puestos.map((p) => ({ lat: p.lat, lng: p.lng, operadorCdaId: p.persona?.id ?? null, etiqueta: p.etiqueta?.trim() || null })),
  };
}

/** Texto para el lector de pantalla después de una acción (null = no anunciar). */
export function describirAccion(a: AccionEditor, antes: EstadoEditor, despues: EstadoEditor): string | null {
  if (despues === antes) {
    if (a.tipo === 'agregarPunto' && antes.dibujo && antes.dibujo.que !== 'puesto') return 'Punto demasiado cerca del anterior: no se agregó';
    if (a.tipo === 'terminarDibujo' && antes.puntos.length >= 3) return 'La figura no tiene área: mueva algún punto';
    return null;
  }
  switch (a.tipo) {
    case 'deshacer':
      return 'Se deshizo el último cambio';
    case 'agregarPunto':
      return antes.dibujo?.que === 'puesto' ? `Puesto ${despues.plan.puestos.length} colocado` : `Punto ${despues.puntos.length} agregado`;
    case 'agregarPuesto':
      return `Puesto ${despues.plan.puestos.length} colocado`;
    case 'deshacerPunto':
      return `Quedan ${despues.puntos.length} puntos`;
    case 'terminarDibujo':
      return antes.dibujo?.que === 'perimetro' ? 'Perímetro listo' : 'Zona creada';
    case 'cancelarDibujo':
      return antes.dibujo ? 'Dibujo cancelado' : null;
    case 'moverVertice':
      return a.vivo ? null : `Vértice ${a.indice + 1} movido`;
    case 'quitarVertice':
      return `Vértice ${a.indice + 1} quitado`;
    case 'moverPuesto':
      return `Puesto ${antes.plan.puestos.find((p) => p.id === a.id)?.orden ?? ''} movido`;
    case 'quitarPuesto':
      return `Puesto ${antes.plan.puestos.find((p) => p.id === a.id)?.orden ?? ''} quitado. Ctrl+Z para deshacer`;
    case 'repartirPuestos':
      return `${despues.plan.puestos.length} puestos repartidos en el perímetro`;
    case 'repartirVallas':
      return `${despues.plan.vallas.length} vallas repartidas en el perímetro`;
    case 'moverValla':
      return 'Valla movida';
    case 'girarValla':
      return `Valla girada a ${Math.round(despues.plan.vallas.find((v) => v.id === a.id)?.angulo ?? 0)}°`;
    case 'quitarValla':
      return 'Valla quitada. Ctrl+Z para deshacer';
    case 'quitarZona':
      return 'Zona quitada. Ctrl+Z para deshacer';
    case 'borrarPerimetro':
      return 'Perímetro borrado. Ctrl+Z para deshacer';
    default:
      return null;
  }
}
