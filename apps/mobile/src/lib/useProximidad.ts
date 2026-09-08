import { useCallback, useState } from 'react';
import {
  LocationPermissionDeniedError,
  LocationServicesDisabledError,
  obtenerUbicacionPuntual,
} from './location';
import { distanciaMetros, type Coordenada } from './geo';

export type UbicacionInfo = { distanciaM: number; margenM: number; dentro: boolean };

const MAX_HOLGURA_GPS_METROS = 100;

/**
 * Verifica la cercanía del operador a un destino (recinto o Delegación).
 * Mismo cálculo que usa el servidor (margen configurable + holgura GPS con
 * tope) para que el gate en cliente coincida con la validación autoritativa.
 */
export function useProximidad(destino: Coordenada | null, margenMetros: number) {
  const [info, setInfo] = useState<UbicacionInfo | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verificar = useCallback(async () => {
    if (!destino) return;
    setVerificando(true);
    setError(null);
    try {
      const pos = await obtenerUbicacionPuntual();
      const distanciaM = distanciaMetros({ latitud: pos.latitud, longitud: pos.longitud }, destino);
      const holgura = Math.min(pos.precisionMetros ?? 0, MAX_HOLGURA_GPS_METROS);
      const margenM = margenMetros + holgura;
      setInfo({ distanciaM, margenM, dentro: distanciaM <= margenM });
    } catch (e) {
      setInfo(null);
      if (e instanceof LocationPermissionDeniedError) {
        setError('Concede el permiso de ubicación para verificar tu cercanía.');
      } else if (e instanceof LocationServicesDisabledError) {
        setError('Activa los servicios de ubicación para verificar tu cercanía.');
      } else {
        setError('No se pudo obtener tu ubicación.');
      }
    } finally {
      setVerificando(false);
    }
  }, [destino, margenMetros]);

  return { info, verificando, error, verificar };
}
