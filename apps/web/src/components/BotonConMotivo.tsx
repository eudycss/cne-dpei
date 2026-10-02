import { useId, type ReactNode } from 'react';
import WarmTooltip from './micro/WarmTooltip/WarmTooltip';

interface Props {
  children: ReactNode;
  onClick: () => void;
  /** Si hay motivo, el botón queda inactivo y el motivo se anuncia y se muestra en un tooltip. */
  motivo?: string | null;
  ariaLabel?: string;
}

/**
 * Botón pequeño de tabla que explica por qué no se puede usar. Un <button disabled>
 * no recibe foco, así que ni el teclado ni el lector de pantalla llegan al motivo;
 * con aria-disabled sigue siendo enfocable y el motivo va en aria-describedby.
 */
export function BotonConMotivo({ children, onClick, motivo, ariaLabel }: Props) {
  const idMotivo = useId();
  const inactivo = Boolean(motivo);

  const boton = (
    <button
      type="button"
      className="btn secondary"
      style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
      aria-label={ariaLabel}
      aria-disabled={inactivo || undefined}
      aria-describedby={inactivo ? idMotivo : undefined}
      onClick={inactivo ? undefined : onClick}
    >
      {children}
    </button>
  );

  // WarmTooltip (React Bits) muestra el motivo al pasar el mouse o al enfocar
  // con teclado; mientras está abierto, apunta aria-describedby a sí mismo, y
  // cerrado se conserva el .sr-only de abajo. El envoltorio se monta siempre
  // (desactivado si no hay motivo) para que el botón no se remonte y pierda el
  // foco cuando cambia entre activo e inactivo.
  return (
    <>
      <WarmTooltip
        content={motivo ?? ''}
        disabled={!inactivo}
        side="top"
        size="sm"
        surfaceColor="var(--text)"
        inkColor="var(--bg-card)"
      >
        {boton}
      </WarmTooltip>
      {inactivo ? (
        <span id={idMotivo} className="sr-only">
          {motivo}
        </span>
      ) : null}
    </>
  );
}
