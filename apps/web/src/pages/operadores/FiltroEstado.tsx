import type { MouseEvent } from 'react';
import type { EstadoOperadorCda } from '@cne/shared-types';
import RubberSegment from '../../components/micro/RubberSegment/RubberSegment';
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
 * Filtro por estado sobre RubberSegment (React Bits): radiogroup de ARIA, un
 * solo Tab entra al grupo y las flechas/Inicio/Fin cambian la selección.
 */
export function FiltroEstado({ valor, onChange, conteo, total }: Props) {
  const items = OPCIONES.map((opcion) => {
    const etiqueta = opcion === 'TODOS' ? 'Todos' : ESTADO_INFO[opcion].label;
    const cantidad = opcion === 'TODOS' ? total : conteo[opcion] ?? 0;
    return {
      value: opcion,
      icon:
        opcion === 'TODOS' ? undefined : (
          <span className="kpi-dot" aria-hidden="true" style={{ background: ESTADO_INFO[opcion].color }} />
        ),
      label: (
        <span className="filtro-estado-opcion">
          {etiqueta}
          <span className="segmented-cantidad">{cantidad}</span>
        </span>
      ),
    };
  });

  // RubberSegment solo selecciona con pointerdown y flechas. Los lectores de
  // pantalla (modo exploración), Voice Control o Switch Control envían un
  // "click" sin pointerdown, y Enter/Espacio también llegan como click: este
  // manejador cubre esos casos sin modificar el componente de terceros.
  function alHacerClic(e: MouseEvent<HTMLDivElement>) {
    const radio = (e.target as HTMLElement).closest('[role="radio"]');
    if (!radio) return;
    const indice = Array.from(e.currentTarget.querySelectorAll('[role="radio"]')).indexOf(radio);
    const opcion = OPCIONES[indice];
    if (opcion !== undefined && opcion !== valor) onChange(opcion);
  }

  return (
    <div className="filtro-estado-contenedor" onClick={alHacerClic}>
      <RubberSegment
        items={items}
        value={valor}
        onChange={(v) => onChange(v as FiltroEstadoValor)}
        aria-label="Filtrar CDAs por estado"
        size="md"
        equalSlots={false}
        trackColor="var(--border-subtle)"
        thumbColor="var(--bg-card)"
        textColor="var(--text)"
        activeTextColor="var(--text)"
        radius={999}
        className="filtro-estado"
      />
    </div>
  );
}
