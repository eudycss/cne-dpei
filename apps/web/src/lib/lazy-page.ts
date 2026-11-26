import { lazy, type ComponentType } from 'react';

/** Marca en sessionStorage: cuándo (epoch ms) se recargó por un chunk que no existe. */
export const CLAVE_RECARGA_CHUNK = 'cne.chunk-recargado';
/** Dentro de esta ventana no se vuelve a recargar: evita un ciclo si el chunk sigue roto. */
export const VENTANA_RECARGA_MS = 10_000;

/** No se pudo descargar el archivo de una página (sin red o deploy nuevo). */
export class ErrorCargaPagina extends Error {
  constructor(causa: unknown) {
    super('No se pudo descargar la página', { cause: causa });
    this.name = 'ErrorCargaPagina';
  }
}

/**
 * Carga una página bajo demanda (su propio archivo .js) a partir de un export con
 * nombre. Tras un deploy nuevo, una pestaña abierta pide chunks con el hash viejo
 * que ya no existen: en ese caso recarga la página para traer el index nuevo, a lo
 * sumo una vez cada 10 s. Si no recarga, lanza ErrorCargaPagina al ErrorBoundary.
 */
export function lazyPage<K extends string, M extends Record<K, ComponentType>>(
  cargar: () => Promise<M>,
  nombre: K,
) {
  return lazy(async () => {
    let modulo: M;
    try {
      modulo = await cargar();
    } catch (error) {
      if (puedeRecargar()) {
        window.location.reload();
        // La página se va a recargar: no resolver evita un parpadeo de error.
        return new Promise<never>(() => {});
      }
      throw new ErrorCargaPagina(error);
    }
    const pagina = modulo[nombre];
    if (!pagina) throw new Error(`El módulo no exporta la página "${nombre}"`);
    return { default: pagina };
  });
}

/** true si no se recargó en los últimos 10 s (y deja la marca con la hora actual). */
function puedeRecargar(): boolean {
  try {
    const ultima = Number(sessionStorage.getItem(CLAVE_RECARGA_CHUNK));
    const ahora = Date.now();
    if (ultima && ahora - ultima < VENTANA_RECARGA_MS) return false;
    sessionStorage.setItem(CLAVE_RECARGA_CHUNK, String(ahora));
    return true;
  } catch {
    // Sin sessionStorage (modo privado estricto) no hay cómo evitar un bucle: no recargar.
    return false;
  }
}
