import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { getMiAsignacion } from './queries/tracking';
import { etapaDesdeAsignacion, etapaMasAvanzada, type OperadorEtapa } from './etapa-operador';

// Redacción neutra a propósito: el avance puede venir del supervisor, de otro dispositivo
// o del propio operador (p. ej. volvió de Ajustes justo tras registrar la salida).
const AVISO_POR_ETAPA: Partial<Record<OperadorEtapa, string>> = {
  EN_TRANSITO: 'La salida del DPI ya está registrada.',
  EN_RECINTO: 'La llegada al recinto ya está registrada.',
  EN_RETORNO: 'La salida del recinto ya está registrada.',
  RETORNADO: 'La llegada a la Delegación ya está registrada.',
};

/**
 * Etapa del operador en la jornada (HU2 → HU5). Se sincroniza con el servidor al montar
 * y al volver al foreground, porque el servidor puede avanzar mientras la app está abierta
 * (p. ej. llegada manual del supervisor). Nunca retrocede: ni por el servidor (acciones aún
 * en la cola offline) ni por un callback local tardío.
 */
export function useEtapaOperador() {
  const [etapa, setEtapa] = useState<OperadorEtapa | null>(null);
  const etapaRef = useRef(etapa);
  etapaRef.current = etapa;

  const avanzarA = useCallback((siguiente: OperadorEtapa) => {
    setEtapa((local) => etapaMasAvanzada(local, siguiente));
  }, []);

  useEffect(() => {
    const sincronizar = async () => {
      try {
        const servidor = etapaDesdeAsignacion(await getMiAsignacion());
        const actual = etapaRef.current;
        // Sin aviso en la carga inicial (actual === null): ahí no hay pantalla que cambie.
        if (actual !== null && etapaMasAvanzada(actual, servidor) !== actual) {
          // Alert es un diálogo nativo: TalkBack lo anuncia sin configuración extra.
          Alert.alert('Jornada actualizada', AVISO_POR_ETAPA[servidor] ?? 'Tu jornada se actualizó.');
        }
        avanzarA(servidor);
      } catch {
        // Si falla la carga inicial, SalidaDpiScreen mostrará el error con reintento;
        // si falla al volver al foreground, se conserva la etapa actual.
        setEtapa((local) => local ?? 'SALIDA');
      }
    };

    sincronizar();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') sincronizar();
    });
    return () => sub.remove();
  }, [avanzarA]);

  return { etapa, avanzarA };
}
