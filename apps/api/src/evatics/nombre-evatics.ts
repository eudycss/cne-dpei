/**
 * Comparación del nombre leído en el certificado con el del personal. La decide
 * el código, no el modelo: la IA solo transcribe lo que ve.
 */

/** Palabras que no identifican a la persona (conectores y títulos). */
const IGNORADAS = new Set([
  'DE',
  'DEL',
  'LA',
  'LAS',
  'LOS',
  'Y',
  'SR',
  'SRA',
  'SRTA',
  'ING',
  'LIC',
  'DR',
  'DRA',
  'MSC',
  'ABG',
  'TLGO',
  'TNLGO',
]);

/** "Pérez López, Ana-María" → ["PEREZ", "LOPEZ", "ANA", "MARIA"]. */
export function palabrasNombre(texto: string | null | undefined): string[] {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z ]+/g, ' ')
    .split(/\s+/)
    .filter((p) => p.length >= 2 && !IGNORADAS.has(p));
}

/** Distancia de edición (inserción, borrado o cambio de una letra); 2 = "más de una". */
function distancia(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const fila = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const arriba = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = arriba;
    }
  }
  return fila[b.length];
}

/**
 * Una letra de diferencia (error de lectura), solo en palabras de 7 letras o
 * más y nunca en la última: FERNANDO/FERNANDA o MARTINEZ/MARTINES son otras
 * personas o familias, no un error de lectura.
 */
function casiIgual(a: string, b: string): boolean {
  return a.length >= 7 && b.length >= 7 && a.at(-1) === b.at(-1) && distancia(a, b) <= 1;
}

/**
 * ¿El nombre del certificado es el de esta persona? El Certificado de
 * Aprobación trae el nombre completo, así que deben coincidir TODAS las
 * palabras: cada nombre y apellido del personal está en el certificado y el
 * certificado no trae palabras de más. Sin importar tildes, mayúsculas ni el
 * orden (nombres antes o después de los apellidos). Se tolera una letra mal
 * leída en UNA sola palabra (ver casiIgual); cada palabra se usa una sola vez.
 */
export function nombreCoincide(leido: string | null | undefined, esperado: string): boolean {
  const deLeido = palabrasNombre(leido);
  const esperadas = palabrasNombre(esperado);
  if (esperadas.length < 2 || deLeido.length !== esperadas.length) return false;
  const libres = [...deLeido];
  // Primero las exactas, para que la tolerancia no "robe" la palabra de otra.
  const pendientes = esperadas.filter((e) => {
    const i = libres.indexOf(e);
    if (i < 0) return true;
    libres.splice(i, 1);
    return false;
  });
  if (pendientes.length === 0) return true;
  return pendientes.length === 1 && libres.some((p) => casiIgual(p, pendientes[0]));
}

const titulo = (p: string) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();

/**
 * "PÉREZ LÓPEZ ANA MARÍA" (apellidos primero, como en el personal) → "Ana P.".
 * Con 3 palabras se asume dos apellidos y un nombre; con 2, uno y uno. Así la
 * página pública confirma a la persona sin mostrar su nombre completo.
 */
export function nombreCortoDeApellidosNombres(apellidosNombres: string): string {
  const p = apellidosNombres.trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return '';
  if (p.length === 1) return `${p[0].charAt(0).toUpperCase()}.`;
  const apellidos = p.length >= 3 ? 2 : 1;
  return `${titulo(p[apellidos])} ${p[0].charAt(0).toUpperCase()}.`;
}

/** Cuentas de usuario (nombres y apellidos por separado) → "Ana P.". */
export function nombreCorto(nombres: string, apellidos: string): string {
  const n = nombres.trim().split(/\s+/)[0] ?? '';
  const a = apellidos.trim().charAt(0).toUpperCase();
  return [n ? titulo(n) : '', a ? `${a}.` : ''].filter(Boolean).join(' ');
}
