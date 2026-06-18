import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { postPosiciones } from './queries/retorno';

export type UbicacionPuntual = {
  latitud: number;
  longitud: number;
  precisionMetros: number | null;
};

export class LocationPermissionDeniedError extends Error {
  constructor() {
    super('Permiso de ubicación denegado');
    this.name = 'LocationPermissionDeniedError';
  }
}

export class LocationServicesDisabledError extends Error {
  constructor() {
    super('Los servicios de ubicación están desactivados');
    this.name = 'LocationServicesDisabledError';
  }
}

/**
 * HU2-CA3: obtiene una ubicación GPS puntual (no rastreo continuo).
 * Solicita permisos si es necesario. Lanza errores tipados para que la UI
 * pueda guiar al usuario a habilitar el permiso.
 */
export async function obtenerUbicacionPuntual(): Promise<UbicacionPuntual> {
  const servicesEnabled = await Location.hasServicesEnabledAsync();
  if (!servicesEnabled) throw new LocationServicesDisabledError();

  const current = await Location.getForegroundPermissionsAsync();
  let granted = current.status === 'granted';
  if (!granted) {
    const req = await Location.requestForegroundPermissionsAsync();
    granted = req.status === 'granted';
  }
  if (!granted) throw new LocationPermissionDeniedError();

  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  return {
    latitud: pos.coords.latitude,
    longitud: pos.coords.longitude,
    precisionMetros: pos.coords.accuracy ?? null,
  };
}

/**
 * HU4-CA2: garantiza que los servicios de ubicación del dispositivo estén
 * activados antes de permitir el registro de la salida del recinto.
 */
export async function asegurarServiciosUbicacion(): Promise<void> {
  const servicesEnabled = await Location.hasServicesEnabledAsync();
  if (!servicesEnabled) throw new LocationServicesDisabledError();
}

/**
 * HU4-CA3: solicita permisos de ubicación en primer y segundo plano, necesarios
 * para mantener el rastreo cuando la app está minimizada durante el retorno.
 */
export async function solicitarPermisoBackground(): Promise<void> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') throw new LocationPermissionDeniedError();

  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== 'granted') throw new LocationPermissionDeniedError();
}

// ---------------------------------------------------------------------------
// HU4-CA3: rastreo GPS continuo en segundo plano durante el retorno al DPI.
// expo-task-manager ejecuta la tarea aun con la app minimizada; cada actualización
// envía las posiciones recibidas al backend. El batching offline robusto (para
// zonas sin señal) se aborda en HU13.
// ---------------------------------------------------------------------------

export const TRACKING_TASK = 'cne-tracking-retorno';

TaskManager.defineTask(TRACKING_TASK, async ({ data, error }) => {
  if (error) return;
  const locations = (data as { locations?: Location.LocationObject[] })?.locations ?? [];
  if (locations.length === 0) return;

  const posiciones = locations.map((l) => ({
    latitud: l.coords.latitude,
    longitud: l.coords.longitude,
    capturadoEn: new Date(l.timestamp).toISOString(),
  }));

  try {
    await postPosiciones({ posiciones });
  } catch {
    // Sin conexión o error transitorio: se descarta el lote (HU13 añadirá
    // persistencia local y reenvío en orden cronológico).
  }
});

export async function iniciarRastreo(): Promise<void> {
  const yaActivo = await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK).catch(() => false);
  if (yaActivo) return;

  await Location.startLocationUpdatesAsync(TRACKING_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 15000,
    distanceInterval: 25,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Rastreo activo',
      notificationBody: 'Registrando tu retorno al DPI durante la jornada electoral.',
    },
  });
}

export async function detenerRastreo(): Promise<void> {
  const yaActivo = await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK).catch(() => false);
  if (yaActivo) {
    await Location.stopLocationUpdatesAsync(TRACKING_TASK);
  }
}

/**
 * Rastreo en primer plano: complementa a `iniciarRastreo` para que el punto
 * en el mapa del supervisor también se actualice probando en Expo Go, donde
 * el rastreo en segundo plano (TaskManager) no corre.
 */
export async function iniciarRastreoPrimerPlano(): Promise<Location.LocationSubscription | null> {
  const servicesEnabled = await Location.hasServicesEnabledAsync();
  if (!servicesEnabled) return null;

  const current = await Location.getForegroundPermissionsAsync();
  let granted = current.status === 'granted';
  if (!granted) {
    const req = await Location.requestForegroundPermissionsAsync();
    granted = req.status === 'granted';
  }
  if (!granted) return null;

  return Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 0 },
    async (loc) => {
      const posiciones = [
        {
          latitud: loc.coords.latitude,
          longitud: loc.coords.longitude,
          capturadoEn: new Date(loc.timestamp).toISOString(),
        },
      ];
      try {
        await postPosiciones({ posiciones });
      } catch {
        // Sin conexión o error transitorio: se descarta el lote.
      }
    },
  );
}
