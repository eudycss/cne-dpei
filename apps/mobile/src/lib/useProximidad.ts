import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LocationPermissionDeniedError,
  LocationServicesDisabledError,
  UbicacionNoDisponibleError,
  obtenerUbicacionPuntual,
} from './location';
import { distanciaMetros, type Coordenada } from './geo';

export type UbicacionInfo = { distanciaM: number; margenM: number; dentro: boolean };

type Medicion = { distanciaM: number; precisionMetros: number | null };

const MAX_HOLGURA_GPS_METROS = 100;

/**
 * Verifica la cercanía del operador a un destino (recinto o Delegación).
 * Mismo cálculo que usa el servidor (margen configurable + holgura GPS con
 * tope) para que el gate en cliente coincida con la validación autoritativa.
 *
 * Se guarda la medición (distancia + precisión) y no el veredicto: si el
 * administrador cambia el margen y la pantalla lo recarga, `dentro` se
 * recalcula sin volver a leer el GPS.
 */
export function useProximidad(destino: Coordenada | null, margenMetros: number) {
  const [medicion, setMedicion] = useState<Medicion | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Si cambia el destino con una lectura en curso, la respuesta vieja
  // (medida contra las coordenadas anteriores) se descarta.
  const ultimaLectura = useRef(0);

  // Al cambiar (o perderse) el destino, la medición anterior ya no vale y
  // cualquier lectura en curso se invalida; lo mismo al desmontar.
  useEffect(() => {
    ultimaLectura.current++;
    setMedicion(null);
    setVerificando(false);
    return () => {
      ultimaLectura.current++;
    };
  }, [destino]);

  const verificar = useCallback(async () => {
    if (!destino) return;
    const lectura = ++ultimaLectura.current;
    setVerificando(true);
    setError(null);
    try {
      const pos = await obtenerUbicacionPuntual({ permitirUltimaConocida: true });
      if (lectura !== ultimaLectura.current) return;
      setMedicion({
        distanciaM: distanciaMetros({ latitud: pos.latitud, longitud: pos.longitud }, destino),
        precisionMetros: pos.precisionMetros,
      });
    } catch (e) {
      if (lectura !== ultimaLectura.current) return;
      setMedicion(null);
      if (e instanceof LocationPermissionDeniedError) {
        setError('Concede el permiso de ubicación para verificar tu cercanía.');
      } else if (e instanceof LocationServicesDisabledError) {
        setError('Activa los servicios de ubicación para verificar tu cercanía.');
      } else if (e instanceof UbicacionNoDisponibleError) {
        setError('El GPS no respondió. Sal a un lugar despejado y vuelve a intentar.');
      } else {
        setError('No se pudo obtener tu ubicación.');
      }
    } finally {
      if (lectura === ultimaLectura.current) setVerificando(false);
    }
  }, [destino]);

  const info = useMemo<UbicacionInfo | null>(() => {
    if (!medicion) return null;
    const holgura = Math.min(medicion.precisionMetros ?? 0, MAX_HOLGURA_GPS_METROS);
    const margenM = margenMetros + holgura;
    return { distanciaM: medicion.distanciaM, margenM, dentro: medicion.distanciaM <= margenM };
  }, [medicion, margenMetros]);

  return { info, verificando, error, verificar };
}
