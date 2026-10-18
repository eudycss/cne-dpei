import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { MiAsignacionResponse } from '@cne/shared-types';
import { leerAsignacion, leerEtapa, PREFIJO_AVISO, reiniciarAvisos } from './cache-jornada';
import { etapaDesdeAsignacion, etapaMasAvanzada, type OperadorEtapa } from './etapa-operador';
import { distanciaMetros, type Coordenada } from './geo';

/**
 * Pitido al acercarse (Fase 4): avisa con sonido, vibración y texto cuando el
 * operador entra a RADIO_AVISO_METROS del recinto (ida) o de la Delegación
 * (retorno). Una sola vez por tramo y evento, aunque se cierre la app.
 *
 * Es una notificación local: suena sin internet y con la app minimizada,
 * porque se evalúa en el mismo rastreo GPS que ya corre en segundo plano.
 * Solo usa la copia local de la asignación (no llama al servidor).
 */

export const RADIO_AVISO_METROS = 200;
// Un fix impreciso (p. ej. ±500 m sin A-GPS) podría disparar el aviso lejos del destino.
export const PRECISION_MAXIMA_METROS = 100;
export const CANAL_AVISO = 'aviso-proximidad';

export type Tramo = 'IDA' | 'RETORNO';

export type Objetivo = { tramo: Tramo; nombre: string; coordenada: Coordenada };

export type PosicionGps = Coordenada & { precisionMetros: number | null };

const TRAMO_POR_ETAPA: Partial<Record<OperadorEtapa, Tramo>> = {
  EN_TRANSITO: 'IDA',
  LLEGADA: 'IDA',
  EN_RETORNO: 'RETORNO',
  LLEGADA_DPI: 'RETORNO',
};

/** Hacia dónde va el operador según su etapa, o null si no está en camino (o faltan coordenadas). */
export function objetivoDelTramo(a: MiAsignacionResponse, etapa: OperadorEtapa): Objetivo | null {
  const tramo = TRAMO_POR_ETAPA[etapa];
  if (tramo === 'IDA') {
    const { latitud, longitud, nombre } = a.recinto;
    if (latitud == null || longitud == null) return null;
    return { tramo, nombre, coordenada: { latitud, longitud } };
  }
  if (tramo === 'RETORNO') {
    if (!a.delegacion) return null;
    return { tramo, nombre: 'la Delegación', coordenada: a.delegacion };
  }
  return null;
}

function claveMarca(eventoId: string, tramo: Tramo): string {
  // Bajo el prefijo de cache-jornada: cerrar sesión o cambiar de operador las borra.
  return `${PREFIJO_AVISO}${eventoId}:${tramo}`;
}

// El rastreo en segundo plano y el de primer plano pueden entregar posiciones
// a la vez: se evalúan de a una para no avisar dos veces.
let candado: Promise<unknown> = Promise.resolve();
function conCandado<T>(fn: () => Promise<T>): Promise<T> {
  const resultado = candado.then(fn, fn);
  candado = resultado.catch(() => undefined);
  return resultado;
}

/**
 * Evalúa una posición del rastreo y avisa si corresponde. Devuelve true si
 * avisó. Nunca lanza: un fallo aquí no debe cortar el envío de posiciones.
 */
export function revisarProximidad(pos: PosicionGps): Promise<boolean> {
  return conCandado(async () => {
    const asignacion = await leerAsignacion();
    if (!asignacion) return false;
    const guardada = await leerEtapa();
    const etapa = etapaMasAvanzada(
      guardada?.eventoId === asignacion.eventoId ? guardada.etapa : null,
      etapaDesdeAsignacion(asignacion),
    );
    if (etapa === 'SALIDA') {
      // Respaldo: el reinicio normal lo hace useEtapaOperador al volver a "Salida del DPI".
      await reiniciarAvisos(asignacion.eventoId);
      return false;
    }
    const objetivo = objetivoDelTramo(asignacion, etapa);
    if (!objetivo) return false;
    if (pos.precisionMetros != null && pos.precisionMetros > PRECISION_MAXIMA_METROS) return false;
    const metros = distanciaMetros(pos, objetivo.coordenada);
    if (metros > RADIO_AVISO_METROS) return false;

    const clave = claveMarca(asignacion.eventoId, objetivo.tramo);
    if (await AsyncStorage.getItem(clave)) return false;
    // Sin permiso Android no muestra la notificación pero tampoco da error: no
    // se marca, para que avise si el operador concede el permiso más adelante.
    if (!(await Notifications.getPermissionsAsync()).granted) return false;
    // Se marca antes de avisar: si la notificación falla, no se reintenta en cada posición.
    await AsyncStorage.setItem(clave, new Date().toISOString());
    await avisar(objetivo, metros);
    return true;
  }).catch((e: unknown) => {
    // Sin coordenadas en el log: solo el motivo, para diagnosticar en campo.
    console.warn('[aviso-proximidad] no se pudo avisar:', e instanceof Error ? e.message : e);
    return false;
  });
}

async function avisar(objetivo: Objetivo, metros: number): Promise<void> {
  await prepararCanal();
  const accion = objetivo.tramo === 'IDA' ? 'Llegada al Recinto' : 'Llegada a la Delegación';
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Estás llegando a ${objetivo.nombre}`,
      body: `A unos ${Math.round(metros)} m. Al llegar, registra la "${accion}" en la app.`,
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority.MAX,
    },
    trigger: Platform.OS === 'android' ? { channelId: CANAL_AVISO } : null,
  });
}

let canalListo = false;
async function prepararCanal(): Promise<void> {
  if (canalListo || Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CANAL_AVISO, {
    name: 'Aviso de llegada',
    description: 'Suena y vibra al estar a 200 m del recinto o de la Delegación.',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    enableVibrate: true,
    vibrationPattern: [0, 600, 300, 600, 300, 600],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  canalListo = true;
}

// Con la app abierta Android no muestra la notificación salvo que se indique.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Pide el permiso de notificaciones (Android 13+). Se llama desde las
 * pantallas de tránsito y retorno: en segundo plano no se pueden abrir diálogos.
 */
export async function pedirPermisoAvisos(): Promise<boolean> {
  try {
    const actual = await Notifications.getPermissionsAsync();
    if (actual.granted) return true;
    if (!actual.canAskAgain) return false;
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch (e: unknown) {
    console.warn('[aviso-proximidad] no se pudo pedir el permiso:', e instanceof Error ? e.message : e);
    return false;
  }
}
