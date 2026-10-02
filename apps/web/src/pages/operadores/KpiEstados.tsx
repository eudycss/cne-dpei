import type { CSSProperties } from 'react';
import { TextoAnimado } from '../../components/TextoAnimado';
import { ESTADO_INFO, ORDEN_ESTADOS, type ConteoEstados } from './estado-info';

interface Props {
  conteo: ConteoEstados;
  total: number;
}

export function porcentajeLlegada(conteo: ConteoEstados, total: number): number {
  if (total <= 0) return 0;
  return Math.round(((conteo.RETORNADO ?? 0) / total) * 100);
}

/** Tarjetas con el número de CDAs por estado y el avance de llegada al DPEI. */
export function KpiEstados({ conteo, total }: Props) {
  const porcentaje = porcentajeLlegada(conteo, total);
  const llegados = conteo.RETORNADO ?? 0;

  return (
    <div className="kpi-grid">
      <div className="kpi-card kpi-card--avance">
        <div
          className="kpi-gauge"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={porcentaje}
          aria-valuetext={`${porcentaje} %, ${llegados} de ${total} CDAs`}
          aria-label="CDAs que llegaron al DPEI"
          style={{ '--avance': `${porcentaje}%` } as CSSProperties}
        >
          <span className="kpi-gauge-valor" aria-hidden="true">
            {porcentaje}%
          </span>
        </div>
        <div>
          <div className="kpi-label">Llegaron al DPEI</div>
          <div className="kpi-detalle">
            {llegados} de {total} CDAs
          </div>
        </div>
      </div>

      {ORDEN_ESTADOS.map((estado) => {
        const info = ESTADO_INFO[estado];
        return (
          <div
            key={estado}
            className="kpi-card"
            style={{ '--kpi-color': info.color } as CSSProperties}
          >
            <div className="kpi-label">
              <span className="kpi-dot" aria-hidden="true" />
              {info.label}
            </div>
            <div className="kpi-num">
              <TextoAnimado text={String(conteo[estado] ?? 0)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
