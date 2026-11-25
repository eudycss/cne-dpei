import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { MiAsignacionRecinto, MiAsignacionResponse } from '@cne/shared-types';

/**
 * Recordatorio de recintos NO CDA sin marcar su llegada al CDA.
 *
 * Mientras el operador está en su CDA (pantalla "Salida del recinto") y falta
 * marcar algún NO CDA, el celular suena cada INTERVALO_AVISO_NO_CDA_S con el
 * número de pendientes, aunque la app esté minimizada. Es una notificación
 * local repetida: se reprograma cada vez que cambia el número y se cancela
 * cuando ya no falta ninguno, al registrar la salida o al cerrar sesión.
 */

export const INTERVALO_AVISO_NO_CDA_S = 30 * 60;
export const CANAL_AVISO_NO_CDA = 'aviso-no-cda';
// Identificador fijo: programar de nuevo reemplaza al aviso anterior (nunca hay dos).
export const ID_AVISO_NO_CDA = 'recordatorio-no-cda';

/** NO CDA de la asignación que aún no tienen la llegada marcada. */
export function noCdasPendientes(a: MiAsignacionResponse | null | undefined): MiAsignacionRecinto[] {
  return a ? a.noCdas.filter((nc) => !nc.llegadaRegistradaEn) : [];
}

/** "Falta 1 recinto NO CDA" / "Faltan 3 recintos NO CDA". */
export function textoFaltan(n: number): string {
  return n === 1 ? 'Falta 1 recinto NO CDA' : `Faltan ${n} recintos NO CDA`;
}

// Programar y cancelar se ejecutan de a uno y en orden de llamada: si un
// programar lento terminara después de un cancelar posterior, quedaría sonando
// un recordatorio con un número viejo.
let cola: Promise<unknown> = Promise.resolve();
function enOrden(fn: () => Promise<void>): Promise<void> {
  const resultado = cola.then(fn, fn);
  cola = resultado.catch(() => undefined);
  return resultado;
}

/**
 * Deja programado el recordatorio con `pendientes` NO CDA, o lo cancela si es 0.
 * Reprogramar reinicia la cuenta de 30 min (el aviso suena 30 min después del
 * último cambio). Nunca lanza: un fallo de notificaciones no debe frenar la jornada.
 */
export function sincronizarAvisoNoCda(pendientes: number): Promise<void> {
  return enOrden(() => (pendientes <= 0 ? cancelar() : programar(pendientes)));
}

/** Quita el recordatorio (salida registrada, cambio de etapa o fin de sesión). */
export function cancelarAvisoNoCda(): Promise<void> {
  return enOrden(cancelar);
}

async function programar(pendientes: number): Promise<void> {
  try {
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    await prepararCanal();
    await Notifications.scheduleNotificationAsync({
      identifier: ID_AVISO_NO_CDA,
      content: {
        title: `${textoFaltan(pendientes)} por marcar`,
        body: 'Cuando llegue cada NO CDA, márquelo en la app (pantalla Salida del recinto).',
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.MAX,
      },
      trigger: {
        seconds: INTERVALO_AVISO_NO_CDA_S,
        repeats: true,
        ...(Platform.OS === 'android' ? { channelId: CANAL_AVISO_NO_CDA } : {}),
      },
    });
  } catch (e: unknown) {
    console.warn('[aviso-no-cda] no se pudo programar:', e instanceof Error ? e.message : e);
  }
}

async function cancelar(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(ID_AVISO_NO_CDA);
  } catch (e: unknown) {
    console.warn('[aviso-no-cda] no se pudo cancelar:', e instanceof Error ? e.message : e);
  }
}

let canalListo = false;
async function prepararCanal(): Promise<void> {
  if (canalListo || Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CANAL_AVISO_NO_CDA, {
    name: 'NO CDA por marcar',
    description: 'Recuerda cada 30 min los recintos NO CDA que aún no marcan su llegada.',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    enableVibrate: true,
    vibrationPattern: [0, 500, 250, 500],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  canalListo = true;
}
