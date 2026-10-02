import { useEffect, useState } from 'react';
import { Check, CircleAlert, RefreshCw } from 'lucide-react';

interface Props {
  /** dataUpdatedAt de React Query (ms); 0 si todavía no hubo datos. */
  actualizadoEn: number;
  actualizando: boolean;
  error: boolean;
}

export function haceCuanto(desdeMs: number, ahoraMs: number): string {
  const s = Math.max(0, Math.floor((ahoraMs - desdeMs) / 1000));
  if (s < 5) return 'justo ahora';
  if (s < 60) return `hace ${s} s`;
  return `hace ${Math.floor(s / 60)} min`;
}

/**
 * Muestra cuándo se actualizó por última vez el estado de los CDAs. Solo el
 * error se anuncia al lector de pantalla: anunciar cada refresco de 10 s
 * sería ruido constante.
 */
export function IndicadorSync({ actualizadoEn, actualizando, error }: Props) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  let icono = <Check size={14} aria-hidden="true" />;
  let texto = actualizadoEn ? `Actualizado ${haceCuanto(actualizadoEn, ahora)}` : 'Esperando datos…';
  let clase = 'sync-indicator';
  if (actualizando) {
    icono = <RefreshCw size={14} aria-hidden="true" className="sync-spin" />;
    texto = 'Actualizando…';
  }
  if (error) {
    icono = <CircleAlert size={14} aria-hidden="true" />;
    texto = 'No se pudo actualizar';
    clase += ' sync-indicator--error';
  }

  return (
    <span className={clase}>
      {icono}
      <span>{texto}</span>
      <span className="sr-only" role="status">
        {error ? 'No se pudo actualizar el estado de los CDAs' : ''}
      </span>
    </span>
  );
}
