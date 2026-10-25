import { cloneElement, type ReactElement } from 'react';

/**
 * Etiqueta + control + ayuda + error de los formularios de Operadores CDA. El
 * error va fuera de la etiqueta y, como la ayuda, se enlaza con aria-describedby.
 * `id` es el del control (el foco va ahí cuando tiene error).
 */
export function Campo({
  id,
  etiqueta,
  error,
  ayuda,
  ancho,
  requerido = true,
  children,
}: {
  id: string;
  etiqueta: string;
  error?: string;
  ayuda?: string;
  ancho: boolean;
  requerido?: boolean;
  children: ReactElement;
}) {
  const describe = [ayuda && `${id}-ayuda`, error && `${id}-error`].filter(Boolean).join(' ');
  return (
    <div className={`ocda-form-campo${ancho ? ' ancho' : ''}`}>
      <label htmlFor={id}>{etiqueta}</label>
      {cloneElement(children, {
        id,
        'aria-required': requerido || undefined,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describe || undefined,
      })}
      {ayuda && (
        // aria-live: si la ayuda cambia (p. ej. el aviso al elegir otro cargo CDA), el lector de pantalla la anuncia.
        <span id={`${id}-ayuda`} className="ocda-form-ayuda" aria-live="polite">
          {ayuda}
        </span>
      )}
      {error && (
        <span id={`${id}-error`} className="ocda-form-error">
          {error}
        </span>
      )}
    </div>
  );
}
