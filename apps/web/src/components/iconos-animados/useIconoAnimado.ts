import { useCallback, useMemo, useRef, type FocusEvent } from 'react';

/** Control imperativo que exponen todos los iconos de AnimateIcons. */
export interface IconoAnimadoHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

/**
 * Conecta un icono animado con el botón que lo contiene: anima al pasar el
 * mouse y también al llegar con el teclado (Tab), no solo sobre el dibujo.
 * Con «reducir movimiento» activo el propio icono no se mueve.
 */
export function useIconoAnimado() {
  const ref = useRef<IconoAnimadoHandle>(null);
  const animar = useCallback(() => ref.current?.startAnimation(), []);
  const detener = useCallback(() => ref.current?.stopAnimation(), []);
  // Solo el foco de teclado: al hacer clic o tocar, el botón también recibe
  // foco y el icono se animaría dos veces.
  const alEnfocar = useCallback(
    (e: FocusEvent<HTMLElement>) => {
      if (esFocoDeTeclado(e.currentTarget)) animar();
    },
    [animar],
  );
  const disparadores = useMemo(
    () => ({ onMouseEnter: animar, onMouseLeave: detener, onFocus: alEnfocar, onBlur: detener }),
    [animar, detener, alEnfocar],
  );
  return { ref, animar, disparadores };
}

function esFocoDeTeclado(el: HTMLElement): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    // Navegador sin :focus-visible: mejor animar de más que nunca con teclado.
    return true;
  }
}
