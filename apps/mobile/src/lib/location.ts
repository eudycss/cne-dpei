import * as Location from 'expo-location';

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
