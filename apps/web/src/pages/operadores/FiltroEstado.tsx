import { useRef, type KeyboardEvent } from 'react';
import type { EstadoOperadorCda } from '@cne/shared-types';
import { ESTADO_INFO, ORDEN_ESTADOS, type ConteoEstados } from './estado-info';

export type FiltroEstadoValor = EstadoOperadorCda | 'TODOS';

interface Props {
  valor: FiltroEstadoValor;
  onChange: (valor: FiltroEstadoValor) => void;
  conteo: ConteoEstados;
  total: number;
}

const OPCIONES: FiltroEstadoValor[] = ['TODOS', ...ORDEN_ESTADOS];

/**
 * Control segmentado con el patrón de radiogroup de ARIA: un solo Tab entra al
 * grupo y las flechas cambian la selección (WCAG 2.1.1).
 */
export function FiltroEstado({ valor, onChange, conteo, total }: Props) {
  const botones = useRef<(HTMLButtonElement | null)[]>([]);

  function mover(e: KeyboardEvent, indice: number) {
    const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    let destino: number | null = null;
    if (delta !== undefined) destino = (indice + delta + OPCIONES.length) % OPCIONES.length;
    if (e.key === 'Home') destino = 0;
    if (e.key === 'End') destino = OPCIONES.length - 1;
    if (destino === null) return;
    e.preventDefault();
    onChange(OPCIONES[destino]);
    botones.current[destino]?.focus();
  }

  return (
    <div className="segmented" role="radiogroup" aria-label="Filtrar CDAs por estado">
      {OPCIONES.map((opcion, i) => {
        const activo = opcion === valor;
        const etiqueta = opcion === 'TODOS' ? 'Todos' : ESTADO_INFO[opcion].label;
        const cantidad = opcion === 'TODOS' ? total : conteo[opcion] ?? 0;
        return (
          <button
            key={opcion}
            ref={(el) => {
              botones.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={activo}
            tabIndex={activo ? 0 : -1}
            className="segmented-opcion"
            onClick={() => onChange(opcion)}
            onKeyDown={(e) => mover(e, i)}
          >
            {opcion !== 'TODOS' ? (
              <span
                className="kpi-dot"
                aria-hidden="true"
                style={{ background: ESTADO_INFO[opcion].color }}
              />
            ) : null}
            {etiqueta}
            <span className="segmented-cantidad">{cantidad}</span>
          </button>
        );
      })}
    </div>
  );
}
