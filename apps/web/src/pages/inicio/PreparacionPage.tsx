import { Link } from 'react-router';
import { CheckCircle2, Circle, CircleDot } from 'lucide-react';
import { PASOS_PREPARACION, type PasoId } from '../../lib/flujo';
import { pasoActual, usePreparacion, type EstadoPreparacion } from '../../lib/queries/preparacion';

const UNIDADES: Record<PasoId, [string, string]> = {
  recintos: ['recinto', 'recintos'],
  usuarios: ['operador CDA activo', 'operadores CDA activos'],
  militares: ['militar', 'militares'],
  evento: ['evento activo', 'eventos activos'],
  asignaciones: ['asignación en el evento activo', 'asignaciones en el evento activo'],
  kits: ['kit en el evento activo', 'kits en el evento activo'],
};

function detalle(id: PasoId, estado: EstadoPreparacion): string {
  if (id === 'evento') return estado.evento ? estado.evento.nombre : 'Ningún evento activo';
  const n = estado.conteos[id];
  const [singular, plural] = UNIDADES[id];
  return `${n} ${n === 1 ? singular : plural}`;
}

/** Panel de inicio: qué pasos de la preparación del evento ya tienen datos y cuál sigue. */
export function PreparacionPage() {
  const { data, isLoading, isError, refetch } = usePreparacion();

  if (isLoading) {
    return (
      <p className="muted" role="status">
        Cargando…
      </p>
    );
  }
  if (isError || !data) {
    return (
      <div className="card" role="alert">
        <p>No se pudo cargar el estado de la preparación.</p>
        <button type="button" className="btn secondary" onClick={() => refetch()}>
          Reintentar
        </button>
      </div>
    );
  }

  const listos = PASOS_PREPARACION.filter((p) => data.conteos[p.id] > 0).length;
  const total = PASOS_PREPARACION.length;
  const actual = pasoActual(data.conteos);

  return (
    <section className="card preparacion" aria-labelledby="preparacion-titulo">
      <h2 id="preparacion-titulo">Preparación del evento</h2>
      <p className="muted" id="preparacion-resumen" aria-live="polite">
        {actual ? `${listos} de ${total} pasos con datos` : 'Todos los pasos tienen datos. Puede pasar a Operación.'}
      </p>
      <div
        className="preparacion-progreso"
        role="progressbar"
        aria-labelledby="preparacion-resumen"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={listos}
      >
        <div className="preparacion-progreso-barra" style={{ width: `${(listos / total) * 100}%` }} />
      </div>

      <ol className="preparacion-pasos">
        {PASOS_PREPARACION.map((paso, i) => {
          const hecho = data.conteos[paso.id] > 0;
          const esActual = paso.id === actual;
          const Icono = hecho ? CheckCircle2 : esActual ? CircleDot : Circle;
          const estadoTexto = hecho ? 'Listo' : esActual ? 'Siguiente' : 'Pendiente';
          return (
            <li
              key={paso.id}
              className={`preparacion-paso ${hecho ? 'hecho' : esActual ? 'actual' : 'pendiente'}`}
              aria-current={esActual ? 'step' : undefined}
            >
              <Icono size={20} aria-hidden="true" className="preparacion-paso-icono" />
              <div className="preparacion-paso-texto">
                <span className="preparacion-paso-nombre">
                  {i + 1}. {paso.etiqueta}
                </span>
                <span className="muted">
                  {estadoTexto} · {detalle(paso.id, data)}
                </span>
              </div>
              <Link to={paso.ruta} className={esActual ? 'btn' : 'btn secondary'}>
                {esActual ? 'Ir' : 'Abrir'}
                <span className="sr-only"> a {paso.etiqueta}</span> <span aria-hidden="true">→</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
