import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { getMiAsignacionConOrigen } from './queries/tracking';
import { guardarEtapa, leerEtapa, reiniciarAvisos } from './cache-jornada';
import { contarPendientes } from './offline-queue';
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
 *
 * La etapa se guarda en el celular: si el operador cierra la app en un recinto sin señal y
 * la vuelve a abrir, no regresa a "Salida del DPI" (caso Apuela, 2026-10-16). Al abrir, la
 * etapa guardada solo se usa si es del mismo evento y el servidor aún no la conoce (sin
 * señal o con acciones pendientes de enviar); con señal y nada pendiente manda el
 * servidor, para que "Resetear estado" del administrador siga funcionando.
 */
export function useEtapaOperador() {
  const [etapa, setEtapa] = useState<OperadorEtapa | null>(null);
  const etapaRef = useRef(etapa);
  etapaRef.current = etapa;
  const eventoRef = useRef<string | null>(null);

  const avanzarA = useCallback((siguiente: OperadorEtapa) => {
    setEtapa((local) => etapaMasAvanzada(local, siguiente));
  }, []);

  useEffect(() => {
    if (etapa && eventoRef.current) guardarEtapa(eventoRef.current, etapa).catch(() => {});
    // Jornada en "Salida del DPI" (inicio o "Resetear estado"): el próximo recorrido vuelve a pitar.
    if (etapa === 'SALIDA' && eventoRef.current) reiniciarAvisos(eventoRef.current).catch(() => {});
  }, [etapa]);

  useEffect(() => {
    const sincronizar = async () => {
      try {
        // Se cuenta lo pendiente ANTES de pedir la asignación: si se contara después, un
        // flush concurrente podía vaciar la cola mientras la respuesta del servidor aún no
        // incluía esas acciones, y la etapa retrocedía.
        const pendientesAntes = await contarPendientes().catch(() => 0);
        const { data, desdeCache } = await getMiAsignacionConOrigen();
        const eventoAnterior = eventoRef.current;
        eventoRef.current = data.eventoId;
        let servidor = etapaDesdeAsignacion(data);
        const actual = etapaRef.current;
        if (eventoAnterior !== null && eventoAnterior !== data.eventoId) {
          // Evento nuevo: la etapa del anterior no aplica (nunca-retroceder es dentro de un evento).
          setEtapa(servidor);
          return;
        }
        if (actual === null) {
          const guardada = await leerEtapa();
          const vigente =
            guardada?.eventoId === data.eventoId && (desdeCache || pendientesAntes > 0) ? guardada.etapa : null;
          servidor = etapaMasAvanzada(vigente, servidor);
        } else if (!desdeCache && etapaMasAvanzada(actual, servidor) !== actual) {
          // Sin aviso en la carga inicial (actual === null): ahí no hay pantalla que cambie.
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
