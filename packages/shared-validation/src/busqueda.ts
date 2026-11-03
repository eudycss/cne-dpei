/**
 * Regla común de los buscadores (web y API): sin distinguir mayúsculas ni
 * tildes ("ñ" cuenta como "n") y por palabras en cualquier orden. "juan
 * perez", "Pérez Juan" y "perez gom" encuentran a "PÉREZ GÓMEZ JUAN".
 */

/** Minúsculas y sin tildes ni diéresis: "MUÑOZ Pérez" → "munoz perez". */
export function normalizarBusqueda(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Palabras normalizadas de lo que se escribió en el buscador (sin vacías). */
export function palabrasBusqueda(consulta: string): string[] {
  return normalizarBusqueda(consulta).split(/\s+/).filter(Boolean);
}

/**
 * true si cada palabra de la consulta aparece en alguno de los textos
 * (nombre, cédula, código…). Una consulta vacía coincide con todo.
 */
export function coincideBusqueda(textos: ReadonlyArray<string | null | undefined>, consulta: string): boolean {
  const palabras = palabrasBusqueda(consulta);
  if (palabras.length === 0) return true;
  const contenido = normalizarBusqueda(textos.filter(Boolean).join(' '));
  return palabras.every((p) => contenido.includes(p));
}
