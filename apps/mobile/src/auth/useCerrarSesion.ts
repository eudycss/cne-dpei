import { useCallback } from 'react';
import { Alert } from 'react-native';
import { contarPendientes } from '../lib/offline-queue';
import { useAuth } from './AuthContext';

/**
 * "Cerrar sesión" del operador: si quedan registros sin enviar, avisa antes.
 * Al cerrar sesión la cola se vacía (no puede enviarse con la sesión de otro
 * operador), así que esos registros se perderían.
 */
export function useCerrarSesion(): () => Promise<void> {
  const { logout } = useAuth();
  return useCallback(async () => {
    const pendientes = await contarPendientes().catch(() => 0);
    if (pendientes === 0) {
      await logout();
      return;
    }
    Alert.alert(
      'Registros sin enviar',
      `Tienes ${pendientes} registro(s) guardado(s) en el celular que todavía no llegan al servidor. ` +
        'Si cierras sesión se perderán. Espera a tener señal para que se envíen solos.',
      [
        { text: 'Esperar', style: 'cancel' },
        { text: 'Cerrar sesión igual', style: 'destructive', onPress: () => void logout() },
      ],
    );
  }, [logout]);
}
