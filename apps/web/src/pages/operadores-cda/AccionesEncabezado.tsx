import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Pone los botones de una pestaña en el encabezado de la página (`destino`).
 * Sin destino (p. ej. el panel solo en una prueba) se muestran en su lugar.
 */
export function AccionesEncabezado({ destino, children }: { destino: HTMLElement | null; children: ReactNode }) {
  if (destino) return createPortal(children, destino);
  return <div className="ocda-acciones">{children}</div>;
}
