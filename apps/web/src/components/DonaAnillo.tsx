import { useId } from 'react';
import { NumeroAnimado } from './NumeroAnimado';

export interface TramoDona {
  clave: string;
  etiqueta: string;
  cantidad: number;
  /** Color CSS del arco y del punto de la leyenda (hex o var(--…)). */
  color: string;
}

// Anillo SVG de radio 40 en un lienzo de 100 (trazo de 16). Cada tramo es un arco:
// al cambiar los datos, el arco crece o se encoge solo (transición CSS).
const RADIO = 40;
const CIRCUNFERENCIA = 2 * Math.PI * RADIO;
// Hueco entre arcos vecinos: separa los colores aunque su contraste con el fondo sea bajo.
const HUECO = 2;

const porcentaje = (parte: number, total: number) => (total > 0 ? Math.round((parte / total) * 100) : 0);

/**
 * Dona de reparto con leyenda. Cada cifra va también en texto: el color nunca
 * es la única pista (WCAG 1.4.1). `unidad` es lo que se cuenta ("parejas", "personas").
 */
export function DonaAnillo({ titulo, unidad, tramos }: { titulo: string; unidad: string; tramos: TramoDona[] }) {
  const total = tramos.reduce((suma, t) => suma + t.cantidad, 0);
  const resumen = tramos.map((t) => `${t.etiqueta}: ${t.cantidad}`).join(', ');
  const idTitulo = useId();
  const conHueco = tramos.filter((t) => t.cantidad > 0).length > 1;
  let acumulado = 0;

  return (
    <section className="estad-dona" aria-labelledby={idTitulo}>
      <h3 id={idTitulo} style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>
        {titulo}
      </h3>
      <div className="estad-dona-cuerpo">
        <div className="estad-dona-grafico" role="img" aria-label={`${titulo}. Total ${total}. ${resumen}`}>
          <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
            <circle className="estad-dona-fondo" cx="50" cy="50" r={RADIO} />
            {tramos.map((t) => {
              const parte = total > 0 ? (t.cantidad / total) * CIRCUNFERENCIA : 0;
              const largo = conHueco && parte > 0 ? Math.max(parte - HUECO, 0.01) : parte;
              const desfase = -acumulado;
              acumulado += parte;
              return (
                <circle
                  key={t.clave}
                  className="estad-dona-tramo"
                  cx="50"
                  cy="50"
                  r={RADIO}
                  style={{ stroke: t.color }}
                  strokeDasharray={`${largo} ${CIRCUNFERENCIA - largo}`}
                  strokeDashoffset={desfase}
                />
              );
            })}
          </svg>
          <span className="estad-dona-total" aria-hidden="true">
            <NumeroAnimado valor={total} />
            <small>{unidad}</small>
          </span>
        </div>
        <ul className="estad-dona-leyenda">
          {tramos.map((t) => (
            <li key={t.clave}>
              <span className="estad-dona-punto" style={{ background: t.color }} aria-hidden="true" />
              <span>{t.etiqueta}</span>
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
