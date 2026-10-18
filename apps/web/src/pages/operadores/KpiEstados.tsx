import type { CSSProperties } from 'react';
import { TextoAnimado } from '../../components/TextoAnimado';
import { ESTADO_INFO, ORDEN_ESTADOS, type ConteoEstados } from './estado-info';

// Dona: anillo SVG de radio 30 en un lienzo de 72 px (trazo de 8 px).
const RADIO_DONA = 30;
const CIRCUNFERENCIA = 2 * Math.PI * RADIO_DONA;

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
        {/* Dona (pedido del usuario: el medidor tipo batería se confundía). El %
            va en el nombre accesible porque aria-valuenow no lleva unidad. */}
        <div
          className="kpi-dona"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={porcentaje}
          aria-label={`CDAs que llegaron al DPEI: ${porcentaje} % (${llegados} de ${total})`}
        >
          <svg viewBox="0 0 72 72" aria-hidden="true" focusable="false">
            <circle className="kpi-dona-fondo" cx="36" cy="36" r={RADIO_DONA} />
            {/* En 0 % no se dibuja: el extremo redondeado dejaría un punto suelto. */}
            {porcentaje > 0 && (
              <circle
                className="kpi-dona-avance"
                cx="36"
                cy="36"
                r={RADIO_DONA}
                strokeDasharray={CIRCUNFERENCIA}
                strokeDashoffset={CIRCUNFERENCIA * (1 - porcentaje / 100)}
              />
            )}
          </svg>
          <span className="kpi-dona-valor" aria-hidden="true">
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
