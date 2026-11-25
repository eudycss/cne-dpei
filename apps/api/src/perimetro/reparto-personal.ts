/**
 * Elige y ordena personas para `total` puestos vacíos según el % de mujeres.
 *
 * - Las mujeres quedan repartidas a lo largo de los puestos (no amontonadas):
 *   el puesto i lleva mujer cuando floor((i+1)·m/total) > floor(i·m/total), con
 *   m = round(total·pct/100) (la misma idea que una línea de Bresenham).
 * - Si falta gente de un sexo, se completa con el otro y luego con quienes no
 *   tienen sexo registrado. Nadie se repite.
 * - El orden de preferencia de cada grupo es el que traen (quien no está en otro
 *   plan del evento va primero; ver PerimetroPersonalService).
 *
 * El sexo solo se usa aquí, en el servidor: el resultado no lo incluye.
 *
 * Riesgo asumido: quien puede editar planes podría deducir el sexo comparando
 * propuestas con 0 % y 100 % (cualquier reparto por sexo lo revela al verse el
 * resultado). Esos roles ya ven el sexo en el módulo de personal CDA/CPE. Para
 * no darlo en bandeja, el orden dentro de cada grupo es al azar (ver `barajar`).
 */
export interface PersonaReparto {
  id: string;
  nombre: string;
  sexo: string | null;
  enOtroPlan: boolean;
}

export interface ResultadoReparto {
  personas: { id: string; nombre: string; enOtroPlan: boolean }[];
  faltan: number;
}

/**
 * Baraja (Fisher-Yates) respetando la preferencia: primero quienes no están en
 * otro plan. `azar` se inyecta en las pruebas.
 */
export function barajar<T extends { enOtroPlan: boolean }>(lista: T[], azar: () => number = Math.random): T[] {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia.sort((a, b) => Number(a.enOtroPlan) - Number(b.enOtroPlan));
}

export function repartirPorSexo(candidatos: PersonaReparto[], total: number, pctMujeres: number): ResultadoReparto {
  const n = Math.max(0, Math.floor(total));
  const pct = Math.min(100, Math.max(0, pctMujeres));
  const mujeres = candidatos.filter((c) => c.sexo === 'F');
  const hombres = candidatos.filter((c) => c.sexo === 'M');
  const sinSexo = candidatos.filter((c) => c.sexo !== 'F' && c.sexo !== 'M');
  const m = Math.round((n * pct) / 100);

  const elegidas: PersonaReparto[] = [];
  for (let i = 0; i < n; i++) {
    const tocaMujer = Math.floor(((i + 1) * m) / n) > Math.floor((i * m) / n);
    const persona = (tocaMujer ? mujeres.shift() ?? hombres.shift() : hombres.shift() ?? mujeres.shift()) ?? sinSexo.shift();
    if (!persona) break;
    elegidas.push(persona);
  }
  return {
    personas: elegidas.map(({ id, nombre, enOtroPlan }) => ({ id, nombre, enOtroPlan })),
    faltan: n - elegidas.length,
  };
}
