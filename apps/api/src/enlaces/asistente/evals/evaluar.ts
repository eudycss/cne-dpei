import { normalizarTexto } from '../buscar-recintos';

/**
 * Lo que debe cumplir la respuesta a una pregunta del banco. Se compara contra el
 * texto que vería la persona en Telegram (sin HTML), no contra la consulta interna,
 * así sirve igual para el asistente actual y para el de SQL.
 */
export interface Esperado {
  /** Exactamente estos códigos de recinto (ni uno más ni uno menos). */
  codigos?: string[];
  /** Cuántos códigos distintos deben aparecer. */
  cantidadCodigos?: number;
  /** Todos los códigos que aparezcan deben estar en esta lista. */
  codigosDentroDe?: string[];
  /** Textos que deben aparecer (sin importar mayúsculas ni tildes). */
  contiene?: string[];
  /** Textos que NO deben aparecer (sin importar mayúsculas ni tildes). */
  noContiene?: string[];
  /** Números que deben aparecer como número suelto (p. ej. un conteo). */
  numeros?: number[];
}

export interface CasoEval {
  pregunta: string;
  esperado: Esperado;
}

export interface ResultadoCaso {
  ok: boolean;
  fallas: string[];
}

/** Quita etiquetas HTML y deshace los escapes de Telegram para comparar el texto visible. */
export function textoVisible(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

/** Códigos de recinto conocidos que aparecen como número suelto (no dentro de un teléfono). */
export function codigosEn(texto: string, conocidos: readonly string[]): string[] {
  const sueltos = new Set(texto.match(/(?<!\d)\d{3,5}(?!\d)/g) ?? []);
  return conocidos.filter((c) => sueltos.has(c));
}

export function evaluarCaso(salida: string, esperado: Esperado, conocidos: readonly string[]): ResultadoCaso {
  const texto = textoVisible(salida);
  const normal = normalizarTexto(texto);
  const codigos = codigosEn(texto, conocidos);
  const fallas: string[] = [];
  const lista = (v: string[]) => (v.length ? v.join(', ') : 'ninguno');

  if (esperado.codigos) {
    const faltan = esperado.codigos.filter((c) => !codigos.includes(c));
    const sobran = codigos.filter((c) => !esperado.codigos!.includes(c));
    if (faltan.length) fallas.push(`faltan códigos: ${lista(faltan)}`);
    if (sobran.length) fallas.push(`sobran códigos: ${lista(sobran)}`);
  }
  if (esperado.cantidadCodigos !== undefined && codigos.length !== esperado.cantidadCodigos) {
    fallas.push(`esperaba ${esperado.cantidadCodigos} códigos y hubo ${codigos.length}`);
  }
  if (esperado.codigosDentroDe) {
    const fuera = codigos.filter((c) => !esperado.codigosDentroDe!.includes(c));
    if (fuera.length) fallas.push(`códigos que no corresponden: ${lista(fuera)}`);
  }
  for (const t of esperado.contiene ?? []) {
    if (!normal.includes(normalizarTexto(t))) fallas.push(`falta "${t}"`);
  }
  for (const t of esperado.noContiene ?? []) {
    if (normal.includes(normalizarTexto(t))) fallas.push(`no debía decir "${t}"`);
  }
  const numeros = new Set((texto.match(/(?<!\d)\d+(?!\d)/g) ?? []).map(Number));
  for (const n of esperado.numeros ?? []) {
    if (!numeros.has(n)) fallas.push(`falta el número ${n}`);
  }
  return { ok: fallas.length === 0, fallas };
}
