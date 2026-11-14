import { useId } from 'react';
import type { TramoReparto } from './estadisticas';
import { porcentaje } from './estadisticas';
import { ESTADO_INFO } from './estado-info';
import { NumeroAnimado } from '../../components/NumeroAnimado';

// Anillo SVG de radio 40 en un lienzo de 100 (trazo de 16). Cada tramo es un arco:
// al cambiar los datos, el arco crece o se encoge solo (transición CSS).
const RADIO = 40;
const CIRCUNFERENCIA = 2 * Math.PI * RADIO;
// Hueco entre arcos vecinos: separa los colores aunque su contraste con el fondo sea bajo.
const HUECO = 2;

/**
 * Reparto de las parejas por estado (en el DPEI, en tránsito, en el recinto, en
 * retorno, llegaron). Se redibuja con cada actualización de la pantalla. Cada
 * cifra va también en texto: el color nunca es la única pista (WCAG 1.4.1).
 */
export function DonaEstados({ reparto }: { reparto: TramoReparto[] }) {
  const total = reparto.reduce((suma, t) => suma + t.cantidad, 0);
  const resumen = reparto.map((t) => `${ESTADO_INFO[t.estado].label}: ${t.cantidad}`).join(', ');
  const titulo = useId();
  const conHueco = reparto.filter((t) => t.cantidad > 0).length > 1;
  let acumulado = 0;

  return (
    <section className="estad-dona" aria-labelledby={titulo}>
      <h3 id={titulo} style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Parejas por estado</h3>
      <div className="estad-dona-cuerpo">
        <div className="estad-dona-grafico" role="img" aria-label={`Parejas por estado. Total ${total}. ${resumen}`}>
          <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
            <circle className="estad-dona-fondo" cx="50" cy="50" r={RADIO} />
            {reparto.map((t) => {
              const parte = total > 0 ? (t.cantidad / total) * CIRCUNFERENCIA : 0;
              const largo = conHueco && parte > 0 ? Math.max(parte - HUECO, 0.01) : parte;
              const desfase = -acumulado;
              acumulado += parte;
              return (
                <circle
                  key={t.estado}
                  className="estad-dona-tramo"
                  cx="50"
                  cy="50"
                  r={RADIO}
                  stroke={ESTADO_INFO[t.estado].color}
                  strokeDasharray={`${largo} ${CIRCUNFERENCIA - largo}`}
                  strokeDashoffset={desfase}
                />
              );
            })}
          </svg>
          <span className="estad-dona-total" aria-hidden="true">
            <NumeroAnimado valor={total} />
            <small>parejas</small>
          </span>
        </div>
        <ul className="estad-dona-leyenda">
          {reparto.map((t) => (
            <li key={t.estado}>
              <span className="estad-dona-punto" style={{ background: ESTADO_INFO[t.estado].color }} aria-hidden="true" />
              <span>{ESTADO_INFO[t.estado].label}</span>
              <strong>
                {t.cantidad} · {porcentaje(t.cantidad, total)} %
              </strong>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
