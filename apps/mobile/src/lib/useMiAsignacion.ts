import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { MiAsignacionResponse } from '@cne/shared-types';
import { getMiAsignacion } from './queries/tracking';
import { isNetworkError } from './offline-queue';

/**
 * Carga mi-asignacion y, si falla por falta de señal, no lo oculta en
 * silencio: expone `sinConexion` para que la pantalla muestre un aviso
 * discreto (no bloqueante). Reintenta solo cuando la app vuelve a primer
 * plano, igual que el reintento de actas pendientes en SalidaRecintoScreen.
 */
export function useMiAsignacion() {
  const [asignacion, setAsignacion] = useState<MiAsignacionResponse | null>(null);
  const [sinConexion, setSinConexion] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const data = await getMiAsignacion();
      setAsignacion(data);
      setSinConexion(false);
    } catch (e) {
      setAsignacion(null);
      setSinConexion(isNetworkError(e));
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

  return { asignacion, sinConexion };
}
