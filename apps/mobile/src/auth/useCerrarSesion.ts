import { useCallback } from 'react';
import { Alert } from 'react-native';
import { contarPendientes, leerRechazadas } from '../lib/offline-queue';
import { hayFotoMilitarPendiente } from '../lib/offline-foto-militar';
import { useAuth } from './AuthContext';

/** Lo que se perdería al cerrar sesión, en palabras del operador. */
async function loQueSePerderia(): Promise<string[]> {
  const [pendientes, rechazadas, foto] = await Promise.all([
    contarPendientes().catch(() => 0),
    leerRechazadas().catch(() => []),
    hayFotoMilitarPendiente().catch(() => false),
  ]);
  const partes: string[] = [];
  if (pendientes > 0) partes.push(`${pendientes} registro(s) guardado(s) en el celular que todavía no llegan al servidor`);
  if (foto) partes.push('la foto del militar, que todavía no se sube');
  if (rechazadas.length > 0) partes.push(`${rechazadas.length} aviso(s) de registros no enviados que aún no revisas`);
  return partes;
}

/**
 * "Cerrar sesión" del operador: si queda algo sin enviar, avisa antes. Al
 * cerrar sesión la cola, los avisos y las fotos se borran (no pueden enviarse
 * con la sesión de otro operador), así que se perderían.
 */
export function useCerrarSesion(): () => Promise<void> {
  const { logout } = useAuth();
  return useCallback(async () => {
    const partes = await loQueSePerderia();
    if (partes.length === 0) {
      await logout();
      return;
    }
    Alert.alert(
      'Tienes datos sin enviar',
      `Si cierras sesión se perderán: ${partes.join('; ')}. Espera a tener señal para que se envíen solos.`,
      [
        { text: 'Esperar', style: 'cancel' },
        { text: 'Cerrar sesión igual', style: 'destructive', onPress: () => void logout() },
      ],
    );
  }, [logout]);
}
