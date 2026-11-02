import AsyncStorage from '@react-native-async-storage/async-storage';
import { enqueue, sincronizarPendientes } from './offline-queue';
import { marcarPruebaConexionEnCopia, postPruebaConexion } from './queries/tracking';

/**
 * Prueba de conexión del operador CDA (después de la llegada al recinto, antes
 * de la salida). La app la exige para continuar; el servidor la guarda para el
 * Informe del Operador CDA.
 *
 * La hora se guarda también en el teléfono, namespaceada por evento+recinto
 * como las actas (offline-actas.ts): si se registró sin señal y la app se
 * reinicia antes de sincronizar, el paso sigue marcado como hecho.
 */
const clave = (contextoId: string) => `prueba-conexion:${contextoId}`;

/** Hora (Ecuador) desde la que se habilita la prueba; el servidor rechaza las anteriores. */
export const HORA_INICIO_PRUEBA_CONEXION = 9;
// Ecuador continental es UTC-5 todo el año: no depende de la zona del teléfono.
const OFFSET_ECUADOR_HORAS = -5;

export function pruebaConexionHabilitada(ahora: Date = new Date()): boolean {
  const horaEcuador = (ahora.getUTCHours() + 24 + OFFSET_ECUADOR_HORAS) % 24;
  return horaEcuador >= HORA_INICIO_PRUEBA_CONEXION;
}

export async function leerPruebaConexionLocal(contextoId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(clave(contextoId));
  } catch {
    return null;
  }
}

/**
 * Registra la prueba (con la foto de la computadora del test, si ya subió) y
 * devuelve la hora. Si en la cola offline quedan acciones sin enviar (p. ej.
 * la llegada al recinto), la prueba se encola detrás para que llegue al
 * servidor después de ellas (el servidor exige la llegada). Errores no
 * transitorios (4xx) se propagan.
 */
export async function registrarPruebaConexion(contextoId: string, fotoUrl?: string | null): Promise<string> {
  const ocurridoEn = new Date().toISOString();
  const conFoto = fotoUrl ? { fotoUrl } : {};
  const pendientes = await sincronizarPendientes();
  if (pendientes > 0) {
    await enqueue({
      endpoint: '/tracking/prueba-conexion',
      method: 'post',
      payload: { ocurridoEn, desdeOffline: true, ...conFoto },
    });
    await marcarPruebaConexionEnCopia();
  } else {
    await postPruebaConexion({ ocurridoEn, ...conFoto });
  }
  try {
    await AsyncStorage.setItem(clave(contextoId), ocurridoEn);
  } catch {
    // Best-effort: solo se pierde la marca local si la app se reinicia sin señal.
  }
  return ocurridoEn;
}

/**
 * Si el teléfono dice que la prueba se hizo pero el servidor no la tiene (la
 * cola offline descarta lo que el servidor rechaza, p. ej. si se envió antes
 * que la llegada), la reenvía con la hora original. Si el servidor la vuelve a
 * rechazar (4xx: antes de las 9:00, hora adelantada…), se borra la marca local
 * para que el operador la repita y se devuelve el motivo. Sin señal se
 * conserva y se reintentará la próxima vez que se abra la pantalla.
 */
export async function reconciliarPruebaConexion(
  contextoId: string,
  enServidor: boolean,
): Promise<{ rechazada: string | null }> {
  if (enServidor) return { rechazada: null };
  const ocurridoEn = await leerPruebaConexionLocal(contextoId);
  if (!ocurridoEn) return { rechazada: null };
  try {
    await postPruebaConexion({ ocurridoEn });
    return { rechazada: null };
  } catch (e: any) {
    const status: number | undefined = e?.response?.status;
    if (status === undefined || status < 400 || status >= 500) return { rechazada: null };
    await limpiarPruebaConexion(contextoId);
    return { rechazada: e?.response?.data?.message ?? 'El servidor no aceptó la prueba de conexión' };
  }
}

/**
 * La foto de la computadora del test subió después de registrar la prueba (sin
 * señal): se reenvía la prueba con la foto y el servidor se la agrega. Si el
 * servidor aún no tenía la prueba, la crea con la hora original. Best-effort.
 */
export async function adjuntarFotoPruebaConexion(contextoId: string, fotoUrl: string): Promise<boolean> {
  const ocurridoEn = (await leerPruebaConexionLocal(contextoId)) ?? new Date().toISOString();
  try {
    await postPruebaConexion({ ocurridoEn, fotoUrl });
    return true;
  } catch {
    return false; // se reintenta al volver a abrir la pantalla o al registrar la salida
  }
}

/** Tras registrar la salida del recinto, la marca local ya no hace falta. */
export async function limpiarPruebaConexion(contextoId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(clave(contextoId));
  } catch {
    /* sin efecto: se sobrescribe en la próxima jornada de este contexto */
  }
}
