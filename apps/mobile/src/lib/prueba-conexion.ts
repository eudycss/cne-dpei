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

export async function leerPruebaConexionLocal(contextoId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(clave(contextoId));
  } catch {
    return null;
  }
}

/**
 * Registra la prueba y devuelve la hora. Si en la cola offline quedan acciones
 * sin enviar (p. ej. la llegada al recinto), la prueba se encola detrás para
 * que llegue al servidor después de ellas (el servidor exige la llegada).
 * Errores no transitorios (4xx) se propagan.
 */
export async function registrarPruebaConexion(contextoId: string): Promise<string> {
  const ocurridoEn = new Date().toISOString();
  const pendientes = await sincronizarPendientes();
  if (pendientes > 0) {
    await enqueue({
      endpoint: '/tracking/prueba-conexion',
      method: 'post',
      payload: { ocurridoEn, desdeOffline: true },
    });
    await marcarPruebaConexionEnCopia();
  } else {
    await postPruebaConexion({ ocurridoEn });
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
 * cola offline descarta en silencio lo que el servidor rechaza, p. ej. si se
 * envió antes que la llegada), la reenvía con la hora original. Best-effort:
 * si vuelve a fallar se reintentará la próxima vez que se abra la pantalla.
 */
export async function reconciliarPruebaConexion(contextoId: string, enServidor: boolean): Promise<void> {
  if (enServidor) return;
  const ocurridoEn = await leerPruebaConexionLocal(contextoId);
  if (!ocurridoEn) return;
  try {
    await postPruebaConexion({ ocurridoEn });
  } catch {
    /* se reintenta al volver a abrir la pantalla */
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
