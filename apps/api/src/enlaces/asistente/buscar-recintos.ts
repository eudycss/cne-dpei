import { ALIAS_RECINTOS } from './alias-recintos';

/** Lo mínimo que la búsqueda necesita de un recinto. */
export interface CandidatoRecinto {
  codigoRecinto: string;
  nombreRecinto: string;
  canton: string | null;
  parroquia: string;
}

/** Palabras que no distinguen un recinto de otro ("contacto del colegio Ibarra" busca "ibarra"). */
const PALABRAS_VACIAS = new Set([
  'a', 'al', 'de', 'del', 'el', 'en', 'la', 'las', 'lo', 'los', 'y', 'me', 'por', 'favor',
  'recinto', 'recintos', 'colegio', 'colegios', 'escuela', 'escuelas', 'unidad', 'unidades',
  'educativa', 'educativas', 'ue', 'u', 'e', 'cda',
  'contacto', 'contactos', 'numero', 'numeros', 'telefono', 'telefonos', 'celular',
  'encargado', 'encargada', 'encargados', 'dame', 'deme',
]);

/** Minúsculas, sin tildes y solo letras/dígitos separados por un espacio. */
export function normalizarTexto(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Palabras con las que se busca: sin las vacías. */
export function palabrasClave(valor: string): string[] {
  return normalizarTexto(valor)
    .split(' ')
    .filter((p) => p && !PALABRAS_VACIAS.has(p));
}

/** Distancia de edición (letras cambiadas, de más o de menos) entre dos palabras. */
function distancia(a: string, b: string): number {
  let previa = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const fila = [i];
    for (let j = 1; j <= b.length; j++) {
      fila[j] = Math.min(previa[j] + 1, fila[j - 1] + 1, previa[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previa = fila;
  }
  return previa[b.length];
}

/** Errores de tipeo tolerados: ninguno en palabras cortas, 1 desde 4 letras y 2 desde 8. */
function erroresPermitidos(palabra: string): number {
  if (palabra.length >= 8) return 2;
  return palabra.length >= 4 ? 1 : 0;
}

/**
 * Una palabra de la búsqueda coincide si es el inicio de alguna palabra del texto
 * ("ilum" → "iluman"); los números y las palabras cortas tienen que ser exactos.
 * Con `tolerante`, acepta además un error de tipeo ("willi" → "willy").
 */
function coincide(palabra: string, palabras: string[], tolerante = false): boolean {
  const exacta = palabra.length < 3 || /^\d+$/.test(palabra);
  if (exacta) return palabras.includes(palabra);
  if (palabras.some((p) => p.startsWith(palabra))) return true;
  const errores = erroresPermitidos(palabra);
  return (
    tolerante &&
    errores > 0 &&
    palabras.some((p) => !/^\d+$/.test(p) && distancia(palabra, p.slice(0, palabra.length + errores)) <= errores)
  );
}

/**
 * true si todas las palabras buscadas aparecen en el texto (ver `coincide`).
 * Sirve para nombres de personas: "willi" encuentra a "Willy Chávez" en modo tolerante.
 */
export function contienePalabras(palabras: string[], texto: string, tolerante = false): boolean {
  const delTexto = normalizarTexto(texto).split(' ');
  return palabras.length > 0 && palabras.every((p) => coincide(p, delTexto, tolerante));
}

/** Códigos de los alias que aparecen en lo buscado ("recinto de golondrinas" → 4241). */
function codigosPorAlias(texto: string, alias: Record<string, string[]>): Set<string> {
  const buscado = ` ${normalizarTexto(texto)} `;
  const codigos = new Set<string>();
  for (const [nombre, deAlias] of Object.entries(alias)) {
    const clave = normalizarTexto(nombre);
    if (clave && buscado.includes(` ${clave} `)) deAlias.forEach((c) => codigos.add(c));
  }
  return codigos;
}

/**
 * Recintos que coinciden con lo que escribió la persona. Un alias o un código
 * exacto gana; si no, todas las palabras tienen que aparecer en el nombre, la
 * parroquia o el cantón, y se quedan solo los de mejor puntaje. El nombre y la
 * parroquia valen más que el cantón: "colegio Ibarra" devuelve los que se llaman
 * "…Ibarra" (no todos los del cantón) y "Ilumán" devuelve todos los de la
 * parroquia. Si no hay nada, se intenta otra vez tolerando errores de tipeo.
 */
export function buscarRecintos<T extends CandidatoRecinto>(
  texto: string,
  candidatos: T[],
  alias: Record<string, string[]> = ALIAS_RECINTOS,
): T[] {
  return buscarRecintosDetalle(texto, candidatos, alias).recintos;
}

/** Como buscarRecintos, y además dice si hizo falta tolerar errores de tipeo (para avisarlo). */
export function buscarRecintosDetalle<T extends CandidatoRecinto>(
  texto: string,
  candidatos: T[],
  alias: Record<string, string[]> = ALIAS_RECINTOS,
): { recintos: T[]; aproximado: boolean } {
  const porAlias = codigosPorAlias(texto, alias);
  if (porAlias.size > 0) {
    const encontrados = candidatos.filter((c) => porAlias.has(c.codigoRecinto));
    if (encontrados.length > 0) return { recintos: encontrados, aproximado: false };
  }

  const palabras = palabrasClave(texto);
  if (palabras.length === 0) return { recintos: [], aproximado: false };

  if (palabras.length === 1) {
    const porCodigo = candidatos.filter((c) => normalizarTexto(c.codigoRecinto) === palabras[0]);
    if (porCodigo.length > 0) return { recintos: porCodigo, aproximado: false };
  }

  const exactos = mejoresCoincidencias(palabras, candidatos, false);
  if (exactos.length > 0) return { recintos: exactos, aproximado: false };
  const aproximados = mejoresCoincidencias(palabras, candidatos, true);
  return { recintos: aproximados, aproximado: aproximados.length > 0 };
}

function mejoresCoincidencias<T extends CandidatoRecinto>(palabras: string[], candidatos: T[], tolerante: boolean): T[] {
  let mejor = 0;
  let resultado: { c: T; porNombre: boolean }[] = [];
  for (const c of candidatos) {
    const nombre = normalizarTexto(c.nombreRecinto).split(' ');
    const parroquia = normalizarTexto(c.parroquia).split(' ');
    const canton = normalizarTexto(c.canton ?? '').split(' ');
    let puntaje = 0;
    let porNombre = true;
    for (const p of palabras) {
      const enNombre = coincide(p, nombre, tolerante);
      porNombre &&= enNombre;
      if (enNombre || coincide(p, parroquia, tolerante)) puntaje += 2;
      else if (coincide(p, canton, tolerante)) puntaje += 1;
      else {
        puntaje = 0;
        break;
      }
    }
    if (puntaje === 0 || puntaje < mejor) continue;
    if (puntaje > mejor) {
      mejor = puntaje;
      resultado = [];
    }
    resultado.push({ c, porNombre });
  }
  // Los que lo llevan en el nombre van primero ("colegio San Antonio" antes que el resto de la parroquia).
  return [...resultado.filter((r) => r.porNombre), ...resultado.filter((r) => !r.porNombre)].map((r) => r.c);
}
