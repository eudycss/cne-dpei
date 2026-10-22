import { ReactNode, useEffect, useRef, useState } from 'react';

const ENFOCABLES =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Mantiene Tab y Shift+Tab dentro del diálogo (WCAG 2.4.3). */
export function atraparFoco(e: KeyboardEvent, dialogo: HTMLElement | null) {
  if (!dialogo) return;
  const enfocables = Array.from(dialogo.querySelectorAll<HTMLElement>(ENFOCABLES));
  if (enfocables.length === 0) return;
  const primero = enfocables[0];
  const ultimo = enfocables[enfocables.length - 1];
  const fuera = !dialogo.contains(document.activeElement);
  if (e.shiftKey && (document.activeElement === primero || fuera)) {
    e.preventDefault();
    ultimo.focus();
  } else if (!e.shiftKey && (document.activeElement === ultimo || fuera)) {
    e.preventDefault();
    primero.focus();
  }
}

/**
 * Diálogo modal accesible: foco atrapado, Escape para cerrar y, al cerrarse,
 * devuelve el foco al elemento que lo abrió (WCAG 2.1.2 / 2.4.3).
 * Si ningún hijo tomó el foco con autoFocus, enfoca el primer control.
 */
export function Modal({
  labelledBy,
  onClose,
  maxWidth = 520,
  children,
}: {
  /** id del título visible del diálogo. */
  labelledBy: string;
  onClose: () => void;
  maxWidth?: number;
  children: ReactNode;
}) {
  const dialogoRef = useRef<HTMLDivElement>(null);
  // En un ref: el padre pasa una función nueva en cada render y no debe re-enfocar el modal.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Se captura en el primer render: un hijo con autoFocus toma el foco antes
  // de que corra el efecto, y entonces document.activeElement ya sería él.
  const [anterior] = useState(() => document.activeElement as HTMLElement | null);

  useEffect(() => {
    const dialogo = dialogoRef.current;
    if (dialogo && !dialogo.contains(document.activeElement)) {
      dialogo.querySelector<HTMLElement>(ENFOCABLES)?.focus();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCloseRef.current();
      else if (e.key === 'Tab') atraparFoco(e, dialogoRef.current);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      anterior?.focus?.();
    };
  }, [anterior]);

  return (
    <div
      className="center"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10, padding: '1rem' }}
    >
      <div
        ref={dialogoRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        style={{ maxWidth, width: '100%', maxHeight: '100%', overflowY: 'auto' }}
      >
        {children}
      </div>
    </div>
  );
}
