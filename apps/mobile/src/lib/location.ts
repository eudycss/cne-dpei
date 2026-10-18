import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { postPosiciones } from './queries/retorno';
import { revisarProximidad } from './aviso-proximidad';

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

export class UbicacionNoDisponibleError extends Error {
  constructor() {
    super('No se pudo obtener la ubicación a tiempo');
    this.name = 'UbicacionNoDisponibleError';
  }
}

/** Espera máxima a un fix GPS nuevo antes de recurrir a la última posición conocida. */
export const LIMITE_GPS_MS = 20_000;
/** Antigüedad máxima de la última posición conocida (el rastreo en primer plano la refresca cada 10 s). */
export const MAX_ANTIGUEDAD_ULTIMA_POSICION_MS = 30_000;
/** Precisión mínima exigida a la última posición conocida (igual al tope de holgura GPS). */
export const PRECISION_ULTIMA_POSICION_METROS = 100;

export type OpcionesUbicacion = {
  /**
   * Solo para el control informativo de cercanía: si el GPS falla o no
   * responde en LIMITE_GPS_MS, usa la última posición conocida reciente.
   * Los registros (llegada, salida, kits) no lo usan y exigen un fix nuevo,
   * para no guardar una posición vieja como actual.
   */
  permitirUltimaConocida?: boolean;
  limiteMs?: number;
};

/**
 * HU2-CA3: obtiene una ubicación GPS puntual (no rastreo continuo).
 * Solicita permisos si es necesario. Lanza errores tipados para que la UI
 * pueda guiar al usuario a habilitar el permiso.
 *
 * En zonas rurales sin datos (sin A-GPS) `getCurrentPositionAsync` puede
 * fallar o no resolver nunca y dejar la pantalla en "Verificando…" con el
 * botón deshabilitado (caso Apuela, 2026-10-16): ver `permitirUltimaConocida`.
 */
export async function obtenerUbicacionPuntual(opciones: OpcionesUbicacion = {}): Promise<UbicacionPuntual> {
  const servicesEnabled = await Location.hasServicesEnabledAsync();
  if (!servicesEnabled) throw new LocationServicesDisabledError();

  const current = await Location.getForegroundPermissionsAsync();
  let granted = current.status === 'granted';
  if (!granted) {
    const req = await Location.requestForegroundPermissionsAsync();
    granted = req.status === 'granted';
  }
  if (!granted) throw new LocationPermissionDeniedError();

  const actual = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  const pos = opciones.permitirUltimaConocida
    ? await fixConRespaldo(actual, opciones.limiteMs ?? LIMITE_GPS_MS)
    : await actual;
  return {
    latitud: pos.coords.latitude,
    longitud: pos.coords.longitude,
    precisionMetros: pos.coords.accuracy ?? null,
  };
}

async function fixConRespaldo(
  actual: Promise<Location.LocationObject>,
  limiteMs: number,
): Promise<Location.LocationObject> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), limiteMs);
  });
  let pos: Location.LocationObject | null;
  try {
    // Un rechazo (sin señal suele ser un error rápido, no un cuelgue) cuenta igual que el timeout.
    pos = await Promise.race([actual.catch(() => null), limite]);
  } finally {
    clearTimeout(timer);
  }
  pos ??= await Location.getLastKnownPositionAsync({
    maxAge: MAX_ANTIGUEDAD_ULTIMA_POSICION_MS,
    requiredAccuracy: PRECISION_ULTIMA_POSICION_METROS,
  }).catch(() => null);
  if (!pos) throw new UbicacionNoDisponibleError();
  return pos;
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
    // Si no hay señal, postPosiciones encola el lote en AsyncStorage (HU13).
  } catch {
    // Solo errores inesperados llegan aquí; los errores de red ya los absorbe withOffline.
  }

  // Después del envío (un aviso lento no frena el rastreo) pero dentro de la
  // tarea, para que el sistema no la dé por terminada antes de sonar. Se revisa
  // todo el lote: una posición intermedia puede ser la única dentro de los 200 m.
  for (const l of locations) {
    const aviso = await revisarProximidad({
      latitud: l.coords.latitude,
      longitud: l.coords.longitude,
      precisionMetros: l.coords.accuracy ?? null,
    });
    if (aviso) break;
  }
});

export async function iniciarRastreo(): Promise<void> {
  const yaActivo = await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK).catch(() => false);
  if (yaActivo) return;

  await Location.startLocationUpdatesAsync(TRACKING_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 30000,
    distanceInterval: 60,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Rastreo activo',
      notificationBody: 'Registrando tu retorno al DPI durante la jornada electoral.',
    },
  });
}

export type ResultadoRastreo = 'activo' | 'fallo' | 'pendiente';

/** Tiempo máximo que la pantalla espera al permiso + inicio del rastreo. */
// Alcanza para un diálogo de permiso normal; si tarda más, la activación sigue por detrás.
export const LIMITE_ACTIVAR_RASTREO_MS = 10_000;

/**
 * Pide el permiso en segundo plano e inicia el rastreo sin dejar la pantalla
 * esperando para siempre: en Android 17 (emulador) `requestBackgroundPermissionsAsync`
 * no resolvía y la salida ya registrada quedaba en "Registrando…".
 *
 * - 'activo': rastreo iniciado.
 * - 'fallo': permiso denegado o error; quien llama avisa al operador.
 * - 'pendiente': venció el límite. La activación sigue en curso (p. ej. el
 *   operador aún está en Ajustes eligiendo "Permitir siempre") y arrancará sola
 *   si se concede, así que no se avisa de un fallo que quizá no ocurra.
 */
export async function activarRastreoSegundoPlano(
  limiteMs: number = LIMITE_ACTIVAR_RASTREO_MS,
): Promise<ResultadoRastreo> {
  const activacion = (async () => {
    await solicitarPermisoBackground();
    await iniciarRastreo();
  })();
  // Si falla después del límite, nadie la espera: evita un rechazo sin manejar.
  activacion.catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<'pendiente'>((resolve) => {
    timer = setTimeout(() => resolve('pendiente'), limiteMs);
  });
  try {
    return await Promise.race([activacion.then(() => 'activo' as const), limite]);
  } catch {
    return 'fallo';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Estado real del rastreo en segundo plano, para no anunciar "Rastreo activo"
 * cuando nunca arrancó. Si el permiso "Permitir siempre" ya está concedido
 * (p. ej. el operador lo dio en Ajustes después) lo arranca sin preguntar;
 * nunca abre diálogos de permiso: eso queda para el botón del aviso.
 */
export async function asegurarRastreoSiHayPermiso(): Promise<boolean> {
  const activo = () => Location.hasStartedLocationUpdatesAsync(TRACKING_TASK).catch(() => false);
  try {
    if (!(await Location.hasServicesEnabledAsync())) return false;
    if (await activo()) return true;
    const bg = await Location.getBackgroundPermissionsAsync();
    if (bg.status !== 'granted') return false;
    await iniciarRastreo();
    return await activo();
  } catch {
    return false;
  }
}

/** Si el permiso "Permitir todo el tiempo" está concedido (sin abrir diálogos). */
export async function permisoSegundoPlanoConcedido(): Promise<boolean> {
  const bg = await Location.getBackgroundPermissionsAsync().catch(() => null);
  return bg?.status === 'granted';
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
        // Solo errores inesperados; los de red los absorbe withOffline.
      }
      await revisarProximidad({
        latitud: loc.coords.latitude,
        longitud: loc.coords.longitude,
        precisionMetros: loc.coords.accuracy ?? null,
      });
    },
  );
}
