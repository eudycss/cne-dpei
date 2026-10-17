/** Lo mínimo que la búsqueda necesita de un recinto. */
export interface CandidatoRecinto {
  codigoRecinto: string;
  nombreRecinto: string;
  canton: string | null;
  parroquia: string;
}

/** Palabras que no distinguen un recinto de otro ("colegio Ibarra" busca "ibarra"). */
const PALABRAS_VACIAS = new Set([
  'a', 'al', 'de', 'del', 'el', 'en', 'la', 'las', 'los', 'y',
  'recinto', 'colegio', 'escuela', 'unidad', 'educativa', 'ue', 'u', 'e', 'cda',
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

/** Una palabra de la búsqueda coincide si es el inicio de alguna palabra del texto
 * ("ilum" → "iluman"); los números y las palabras cortas tienen que ser exactos. */
function coincide(palabra: string, palabras: string[]): boolean {
  const exacta = palabra.length < 3 || /^\d+$/.test(palabra);
  return palabras.some((p) => (exacta ? p === palabra : p.startsWith(palabra)));
}

/**
 * Recintos que coinciden con lo que escribió la persona. Un código exacto gana;
 * si no, todas las palabras tienen que aparecer en el nombre, el cantón o la
 * parroquia, y se quedan solo los de mejor puntaje (coincidir en el nombre vale
 * más): "colegio Ibarra" devuelve los que se llaman "…Ibarra", no todos los del
 * cantón Ibarra.
 */
export function buscarRecintos<T extends CandidatoRecinto>(texto: string, candidatos: T[]): T[] {
  const palabras = palabrasClave(texto);
  if (palabras.length === 0) return [];

  if (palabras.length === 1) {
    const porCodigo = candidatos.filter((c) => normalizarTexto(c.codigoRecinto) === palabras[0]);
    if (porCodigo.length > 0) return porCodigo;
  }

  let mejor = 0;
  let resultado: T[] = [];
  for (const c of candidatos) {
    const nombre = normalizarTexto(c.nombreRecinto).split(' ');
    const sector = normalizarTexto(`${c.canton ?? ''} ${c.parroquia}`).split(' ');
    let puntaje = 0;
    for (const p of palabras) {
      if (coincide(p, nombre)) puntaje += 2;
      else if (coincide(p, sector)) puntaje += 1;
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
    resultado.push(c);
  }
  return resultado;
}
