import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MiAsignacionRecinto } from '@cne/shared-types';
import { NoCdaBarra } from './NoCdaBarra';
import { introLlegada, NoCdaListaModal } from './NoCdaListaModal';

interface Props {
  noCdas: MiAsignacionRecinto[];
  bloqueo: string | null;
  onMarcado: () => void;
  /**
   * Si se da (p. ej. evento + recinto), la primera vez que la lista se puede
   * marcar se abre sola con la bienvenida; queda recordado en el celular para
   * no volver a interrumpir.
   */
  bienvenidaClave?: string;
  /** Solo para pruebas: pausa antes de abrir la bienvenida. */
  pausaBienvenidaMs?: number;
}

const PREFIJO = 'cne:no-cda-bienvenida:';
/** Pausa antes de abrirla sola: deja pasar el pedido de permiso de avisos que sale al entrar. */
export const PAUSA_BIENVENIDA_MS = 1500;

/** true si la bienvenida de esa clave ya se vio (se marca recién al cerrarla). */
export async function bienvenidaVista(clave: string): Promise<boolean> {
  try {
    return !!(await AsyncStorage.getItem(PREFIJO + clave));
  } catch {
    return true; // sin almacenamiento: mejor no interrumpir
  }
}

export async function marcarBienvenidaVista(clave: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIJO + clave, new Date().toISOString());
  } catch {
    // sin almacenamiento: a lo sumo se vuelve a mostrar
  }
}

/** Barra fija de NO CDA al pie + su ventana con el listado (y la bienvenida al llegar). */
export function NoCdaPanel({ noCdas, bloqueo, onMarcado, bienvenidaClave, pausaBienvenidaMs = PAUSA_BIENVENIDA_MS }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [intro, setIntro] = useState<string | undefined>(undefined);
  const faltan = noCdas.filter((nc) => !nc.llegadaRegistradaEn).length;

  useEffect(() => {
    if (!bienvenidaClave || bloqueo || faltan === 0) return;
    let vigente = true;
    const temporizador = setTimeout(() => {
      bienvenidaVista(bienvenidaClave).then((vista) => {
        if (!vigente || vista) return;
        setIntro(introLlegada(noCdas.length));
        setAbierto(true);
      });
    }, pausaBienvenidaMs);
    // Si la pantalla se desmonta antes (p. ej. al recargar), no queda marcada: se mostrará al volver.
    return () => {
      vigente = false;
      clearTimeout(temporizador);
    };
    // Solo al habilitarse (llegada al recinto) o cambiar de recinto, no en cada marca.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bienvenidaClave, bloqueo, faltan > 0]);

  if (noCdas.length === 0) return null;
  return (
    <>
      <NoCdaBarra
        noCdas={noCdas}
        bloqueo={bloqueo}
        onPress={() => {
          setIntro(undefined);
          setAbierto(true);
        }}
      />
      <NoCdaListaModal
        visible={abierto}
        noCdas={noCdas}
        bloqueo={bloqueo}
        intro={intro}
        onMarcado={onMarcado}
        onCerrar={() => {
          setAbierto(false);
          if (intro && bienvenidaClave) void marcarBienvenidaVista(bienvenidaClave);
        }}
      />
    </>
  );
}
