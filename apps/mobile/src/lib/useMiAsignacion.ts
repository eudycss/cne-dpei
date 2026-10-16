import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { MiAsignacionResponse } from '@cne/shared-types';
import { getMiAsignacionConOrigen } from './queries/tracking';
import { isNetworkError } from './offline-queue';

/**
 * Carga mi-asignacion y, si falla por falta de señal, no lo oculta en
 * silencio: expone `sinConexion` para que la pantalla muestre un aviso
 * discreto (no bloqueante). Reintenta solo cuando la app vuelve a primer
 * plano, igual que el reintento de actas pendientes en SalidaRecintoScreen.
 *
 * Sin señal usa la copia guardada en el celular (ver cache-jornada) y
 * mantiene `sinConexion` en true para que el aviso siga visible.
 *
 * `recargar` permite traer de nuevo el margen y las coordenadas del destino
 * (p. ej. al pulsar "Actualizar ubicación" tras un cambio del administrador).
 */
export function useMiAsignacion() {
  const [asignacion, setAsignacion] = useState<MiAsignacionResponse | null>(null);
  const [sinConexion, setSinConexion] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const { data, desdeCache } = await getMiAsignacionConOrigen();
      setAsignacion(data);
      // La copia local permite seguir trabajando, pero el aviso de sin señal se mantiene.
      setSinConexion(desdeCache);
    } catch (e) {
      const sinRed = isNetworkError(e);
      // Sin señal se conserva lo ya cargado: una recarga fallida en el campo
      // no debe esconder la tarjeta de ubicación.
      if (!sinRed) setAsignacion(null);
      setSinConexion(sinRed);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && sinConexion) cargar();
    });
    return () => sub.remove();
  }, [sinConexion, cargar]);

  return { asignacion, sinConexion, recargar: cargar };
}
