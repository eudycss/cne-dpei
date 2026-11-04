import type { DispositivoCda, FilaPropuestaParejaCda, PersonaPropuestaCda, RecintoParejaCda } from '@cne/shared-types';

/**
 * Propuesta automática de parejas para una nueva prueba técnica: el personal
 * que no fue en las fechas de referencia va a los recintos no visitados, una
 * pareja Operador + Asistente por recinto y otra más en los recintos
 * marcados. Primero salen las parejas con al menos un Android (la APK solo
 * se instala en Android); las que no tienen ninguno van al final, y la web
 * las marca en rojo. Si no alcanza el personal, la fila queda vacía para
 * elegir a mano. Es solo una sugerencia: no guarda nada.
 */

export interface PersonaParaProponer {
  id: string;
  apellidosNombres: string;
  cedula: string;
  grupo: string;
  dispositivo: string | null;
}

export interface EntradaPropuesta {
  /** Operadores y Asistentes CDA activos. */
  personas: PersonaParaProponer[];
  /** Recintos CDA activos. */
  recintos: RecintoParejaCda[];
  /** Personas que estuvieron en una pareja en las fechas de referencia. */
  fueron: Set<string>;
  /** Recintos visitados en las fechas de referencia. */
  visitados: Set<string>;
  /** Ya tienen pareja en la fecha nueva (no se proponen). */
  personasDelDia: Set<string>;
  recintosDelDia: Set<string>;
  /** Recintos que llevan una pareja más. */
  extras: Set<string>;
}

const dispositivo = (d: string | null): DispositivoCda | null => (d === 'ANDROID' || d === 'IPHONE' ? d : null);
const android = (p: PersonaPropuestaCda | null) => p?.dispositivo === 'ANDROID';

type Par = { operador: PersonaPropuestaCda; asistente: PersonaPropuestaCda | null };

/**
 * Arma las parejas para que la mayor cantidad tenga al menos un Android:
 * operador sin Android con asistente con Android, operador con Android con
 * asistente sin Android, luego los dos con Android y al final los dos sin.
 * Los operadores que sobran van solos (el asistente es opcional).
 */
function armarParejas(operadores: PersonaPropuestaCda[], asistentes: PersonaPropuestaCda[]): Par[] {
  const opA = operadores.filter(android);
  const opN = operadores.filter((p) => !android(p));
  const asA = asistentes.filter(android);
  const asN = asistentes.filter((p) => !android(p));
  const pares: Par[] = [];
  const emparejar = (ops: PersonaPropuestaCda[], ass: PersonaPropuestaCda[]) => {
    while (ops.length && ass.length) pares.push({ operador: ops.shift()!, asistente: ass.shift()! });
  };
  emparejar(opN, asA);
  emparejar(opA, asN);
  emparejar(opA, asA);
  emparejar(opN, asN);
  for (const operador of [...opA, ...opN]) pares.push({ operador, asistente: null });
  // Estable: dentro de cada grupo se respeta el orden en que se armaron.
  const sinAndroid = (p: Par) => Number(!android(p.operador) && !android(p.asistente));
  return pares.sort((a, b) => sinAndroid(a) - sinAndroid(b));
}

export function proponerParejas(e: EntradaPropuesta): { filas: FilaPropuestaParejaCda[]; personas: PersonaPropuestaCda[] } {
  const personas: PersonaPropuestaCda[] = e.personas
    .filter((p) => !e.personasDelDia.has(p.id))
    .map((p) => ({
      id: p.id,
      apellidosNombres: p.apellidosNombres,
      cedula: p.cedula,
      grupo: p.grupo,
      dispositivo: dispositivo(p.dispositivo),
      yaFue: e.fueron.has(p.id),
    }))
    .sort((a, b) => a.apellidosNombres.localeCompare(b.apellidosNombres, 'es'));
  const libres = personas.filter((p) => !p.yaFue);

  const recintos = [...e.recintos].sort(
    (a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }) || a.nombre.localeCompare(b.nombre, 'es'),
  );
  // Primero una pareja por recinto no visitado; las extras al final (si falta gente, se quedan vacías).
  const lugares: { recinto: RecintoParejaCda; extra: boolean }[] = [
    ...recintos.filter((r) => !e.visitados.has(r.id) && !e.recintosDelDia.has(r.id)).map((recinto) => ({ recinto, extra: false })),
    ...recintos.filter((r) => e.extras.has(r.id)).map((recinto) => ({ recinto, extra: true })),
  ];

  const pares = armarParejas(
    libres.filter((p) => p.grupo === 'OPERADOR'),
    libres.filter((p) => p.grupo === 'ASISTENTE'),
  );
  const filas = lugares.map((l, i) => ({
    recinto: l.recinto,
    operador: pares[i]?.operador ?? null,
    asistente: pares[i]?.asistente ?? null,
    extra: l.extra,
  }));
  return { filas, personas };
}
