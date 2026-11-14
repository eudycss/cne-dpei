import type { TramoReparto } from './estadisticas';
import { ESTADO_INFO } from './estado-info';
import { DonaAnillo } from '../../components/DonaAnillo';

/**
 * Reparto de las parejas por estado (en el DPEI, en tránsito, en el recinto, en
 * retorno, llegaron). Se redibuja con cada actualización de la pantalla.
 */
export function DonaEstados({ reparto }: { reparto: TramoReparto[] }) {
  return (
    <DonaAnillo
      titulo="Parejas por estado"
      unidad="parejas"
      tramos={reparto.map((t) => ({
        clave: t.estado,
        etiqueta: ESTADO_INFO[t.estado].label,
        cantidad: t.cantidad,
        color: ESTADO_INFO[t.estado].color,
      }))}
    />
  );
}
