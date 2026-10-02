import type { CSSProperties } from 'react';
import { TextoAnimado } from '../../components/TextoAnimado';
import SloshGauge from '../../components/micro/SloshGauge/SloshGauge';
import { ESTADO_INFO, ORDEN_ESTADOS, type ConteoEstados } from './estado-info';

// Verde más oscuro que el del estado (#16a34a): con texto blanco encima da
// ~5:1 de contraste; el del estado solo llega a ~3.3:1 (WCAG 1.4.3).
const COLOR_LIQUIDO = '#15803d';

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
        {/* SloshGauge (React Bits) ya expone role="meter" y aria-valuenow, pero
            sin unidad: el % va en el nombre. El liquidColor va en hex porque el
            componente calcula con él el color del texto sobre el líquido. */}
        <SloshGauge
          value={porcentaje}
          ariaLabel={`CDAs que llegaron al DPEI: ${porcentaje} % (${llegados} de ${total})`}
          liquidColor={COLOR_LIQUIDO}
          glassColor="var(--border-subtle)"
          width={52}
          height={76}
          radius={14}
          ticks={4}
        />
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
