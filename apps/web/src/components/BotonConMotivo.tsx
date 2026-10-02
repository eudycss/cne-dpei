import { useId, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onClick: () => void;
  /** Si hay motivo, el botón queda inactivo y el motivo se anuncia y se muestra al pasar el mouse. */
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

  return (
    <>
      <button
        type="button"
        className="btn secondary"
        style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
        aria-label={ariaLabel}
        aria-disabled={inactivo || undefined}
        aria-describedby={inactivo ? idMotivo : undefined}
        title={motivo ?? undefined}
        onClick={inactivo ? undefined : onClick}
      >
        {children}
      </button>
      {inactivo ? (
        <span id={idMotivo} className="sr-only">
          {motivo}
        </span>
      ) : null}
    </>
  );
}
