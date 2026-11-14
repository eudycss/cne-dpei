import type { ConteoEvatics } from '@cne/shared-types';
import { DonaAnillo } from '../../components/DonaAnillo';
import { TRAMOS } from './AvanceEvatics';

// Mismos colores de estado que las barras (variables del tema), en el mismo orden.
const COLOR_TRAMO: Record<(typeof TRAMOS)[number]['clase'], string> = {
  aprobado: 'var(--f-exito)',
  pendiente: 'var(--f-aviso)',
  rechazado: 'var(--f-error)',
  'sin-subir': 'var(--f-text-muted)',
};

/** Reparto de todo el personal por estado de su certificado Evatics. */
export function DonaEvatics({ totales }: { totales: ConteoEvatics }) {
  return (
    <DonaAnillo
      titulo="Certificados por estado"
      unidad="personas"
      tramos={TRAMOS.map((t) => ({
        clave: t.clave,
        etiqueta: t.etiqueta,
        cantidad: totales[t.clave],
        color: COLOR_TRAMO[t.clase],
      }))}
    />
  );
}
