import { useEffect, useState } from 'react';
import { hayPendiente } from './offline-queue';

/**
 * true si la llegada al recinto está en la cola sin señal (aún no llegó al
 * servidor). La barra y la lista de NO CDA la cuentan como hecha, en todas las
 * pantallas por igual. Se revisa de nuevo cada vez que cambia `recargarCon`.
 */
export function useLlegadaEnCola(recargarCon: unknown): boolean {
  const [enCola, setEnCola] = useState(false);
  useEffect(() => {
    let vigente = true;
    hayPendiente('/tracking/llegada-recinto')
      .catch(() => false)
      .then((v) => {
        if (vigente) setEnCola(v);
      });
    return () => {
      vigente = false;
    };
  }, [recargarCon]);
  return enCola;
}
