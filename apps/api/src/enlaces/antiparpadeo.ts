/**
 * Anti-parpadeo de enlaces: la hoja de monitoreo a veces marca un recinto en
 * FALLO un ciclo y ACTIVO el siguiente (y así por horas). Avisar cada cambio
 * llenó el grupo de Telegram con dos mensajes cada 5 min (11-nov-2026). Un
 * cambio solo cuenta cuando se lee igual dos ciclos seguidos (10 min con el
 * cron de 5 min) y es distinto del último estado que ya se confirmó.
 */
export type EstadoLectura = 'ACTIVO' | 'FALLO';
export type CambioConfirmado = 'CAIDA' | 'RECUPERACION' | null;

export interface EstadoGuardado {
  /** Lectura del ciclo anterior (tal cual la hoja). */
  estado: EstadoLectura;
  /** Último estado confirmado; null = aún sin confirmar (recinto recién visto). */
  estadoConfirmado?: EstadoLectura | null;
}

/**
 * Qué queda confirmado tras la lectura de este ciclo y si eso es una caída o una
 * recuperación que hay que avisar.
 * - Recinto nunca visto: se espera a la siguiente lectura.
 * - Lectura distinta de la anterior: no se confirma nada (puede ser un parpadeo).
 * - Dos lecturas iguales y distintas de lo confirmado: cambio confirmado. Un
 *   recinto que se confirma en FALLO por primera vez cuenta como caída (si no, un
 *   enlace ya caído antes de arrancar el monitoreo quedaría mudo para siempre); uno
 *   que se confirma ACTIVO por primera vez no es recuperación.
 */
export function evaluarLectura(
  lectura: EstadoLectura,
  anterior: EstadoGuardado | null,
): { confirmado: EstadoLectura | null; cambio: CambioConfirmado } {
  if (!anterior) return { confirmado: null, cambio: null };
  const previo = anterior.estadoConfirmado ?? null;
  if (lectura !== anterior.estado || lectura === previo) return { confirmado: previo, cambio: null };
  if (lectura === 'FALLO') return { confirmado: 'FALLO', cambio: 'CAIDA' };
  return { confirmado: 'ACTIVO', cambio: previo === 'FALLO' ? 'RECUPERACION' : null };
}

/** Caídas confirmadas en la última hora a partir de las cuales un recinto es "intermitente". */
export const CAIDAS_INTERMITENTE = 3;
export const VENTANA_INTERMITENTE_MS = 60 * 60_000;

/**
 * Con `caidasUltimaHora` (contando la de este ciclo, si la hubo):
 * - 'avisar': cambio normal. Las recuperaciones siempre se avisan (en silencio,
 *   salvo que sea la última): si no, un intermitente que por fin se levanta
 *   quedaría como caído para el grupo.
 * - 'marcar': justo llegó a intermitente; se avisa una vez, en silencio, que sus
 *   caídas dejan de avisarse.
 * - 'omitir': ya era intermitente; su caída no genera aviso (si se queda caído,
 *   el escalamiento lo recuerda igual).
 */
export function clasificarIntermitencia(
  cambio: Exclude<CambioConfirmado, null>,
  caidasUltimaHora: number,
): 'avisar' | 'marcar' | 'omitir' {
  if (cambio === 'RECUPERACION' || caidasUltimaHora < CAIDAS_INTERMITENTE) return 'avisar';
  return caidasUltimaHora === CAIDAS_INTERMITENTE ? 'marcar' : 'omitir';
}
