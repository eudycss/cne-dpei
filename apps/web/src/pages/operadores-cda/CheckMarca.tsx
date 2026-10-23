import { useId } from 'react';
import { Check } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { TipoMarcaAsistenciaCda } from '@cne/shared-types';
import { horaEcuador } from './utils';

interface Props {
  tipo: TipoMarcaAsistenciaCda;
  /** ISO de la marca; null = pendiente. */
  marcaEn: string | null;
  por: string | null;
  nombre: string;
  /** Día pasado (solo lectura) o salida sin entrada. */
  deshabilitado: boolean;
  /** Motivo que se lee junto al botón deshabilitado. */
  motivo?: string;
  ocupado: boolean;
  onMarcar: () => void;
  onQuitar: () => void;
}

/**
 * Check de entrada (cian) o salida (violeta). Es un botón de alternancia
 * (aria-pressed): sin marca lo marca; con marca ofrece quitarla. El nombre
 * accesible no cambia ("Entrada de …"); el estado lo da aria-pressed y la
 * hora, quién marcó o por qué no se puede usar van en aria-describedby.
 * Usa aria-disabled (no disabled) para que el teclado llegue y lea el motivo.
 */
export function CheckMarca({ tipo, marcaEn, por, nombre, deshabilitado, motivo, ocupado, onMarcar, onQuitar }: Props) {
  const reducirMovimiento = useReducedMotion();
  const idDetalle = useId();
  const etiqueta = tipo === 'ENTRADA' ? 'Entrada' : 'Salida';
  const marcado = !!marcaEn;
  const hora = marcaEn ? horaEcuador(marcaEn) : null;
  const inactivo = deshabilitado || ocupado;
  const detalle = [
    marcado ? `Registrada a las ${hora}${por ? ` por ${por}` : ''}. Pulse para quitarla.` : 'Pendiente.',
    deshabilitado && motivo ? motivo : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <motion.button
      type="button"
      className={`ocda-check ${tipo === 'ENTRADA' ? 'entrada' : 'salida'}${marcado ? ' marcado' : ''}`}
      aria-pressed={marcado}
      aria-label={`${etiqueta} de ${nombre}`}
      aria-describedby={idDetalle}
      aria-disabled={inactivo || undefined}
      aria-busy={ocupado || undefined}
      title={detalle}
      onClick={() => {
        if (inactivo) return;
        if (marcado) onQuitar();
        else onMarcar();
      }}
      whileTap={reducirMovimiento || inactivo ? undefined : { scale: 0.94 }}
    >
      <span id={idDetalle} className="sr-only">
        {detalle}
      </span>
      <motion.span
        className="ocda-check-caja"
        aria-hidden="true"
        key={marcado ? 'si' : 'no'}
        initial={reducirMovimiento ? false : { scale: 0.6, opacity: 0.4 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 22 }}
      >
        {marcado && <Check size={16} strokeWidth={3} />}
      </motion.span>
      <span className="ocda-check-texto" aria-hidden="true">
        <span>{etiqueta}</span>
        <span className="mono">{hora ?? '— : —'}</span>
      </span>
    </motion.button>
  );
}
