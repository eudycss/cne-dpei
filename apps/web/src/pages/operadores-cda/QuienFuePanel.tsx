import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { PersonaAsignacionesCda, RecintoAsignacionesCda } from '@cne/shared-types';
import { Cargando } from '../../components/Cargando';
import { SearchInput } from '../../components/SearchInput';
import { buscarAsignacionesCda } from '../../lib/queries/operadores-cda';
import { useCargosCda } from './grupo';
import { fechaCorta, mensajeError } from './utils';

/** La API pide al menos 3 caracteres. */
const MINIMO = 3;
const COMO: Record<'OPERADOR' | 'ASISTENTE', string> = { OPERADOR: 'de operador', ASISTENTE: 'de asistente' };

/**
 * "¿Quién fue a dónde?": se escribe una persona (nombre o cédula) o un recinto
 * (código o nombre; un NO CDA da su CDA) y se ven todas sus parejas, de la
 * fecha más reciente a la más antigua. Cada fecha abre ese día en Parejas.
 */
export function QuienFuePanel() {
  const [texto, setTexto] = useState('');
  const limpio = texto.trim();
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(limpio), 300);
    return () => clearTimeout(t);
  }, [limpio]);
  const { data, isFetching, isError, error } = useQuery({
    queryKey: ['parejas-cda', 'buscar', q],
    queryFn: () => buscarAsignacionesCda(q),
    enabled: q.length >= MINIMO,
  });
  // Mientras se escribe, lo anterior ya no corresponde a lo que dice el campo.
  const resultado = q === limpio && q.length >= MINIMO ? data : undefined;
  const vacio = resultado && resultado.personas.length === 0 && resultado.recintos.length === 0;

  return (
    <section aria-labelledby="quien-fue-titulo">
      <h2 id="quien-fue-titulo" className="sr-only">
        ¿Quién fue a dónde?
      </h2>
      <div className="ocda-filtros">
        <span className="ocda-campo" style={{ flex: '1 1 320px', maxWidth: 480 }}>
          <SearchInput
            value={texto}
            onChange={setTexto}
            placeholder="Persona (nombre o cédula) o recinto (código o nombre)…"
            ariaLabel="Buscar persona o recinto para ver a dónde fue o quién fue"
          />
        </span>
      </div>

      <div role="status" aria-live="polite">
        {limpio.length > 0 && limpio.length < MINIMO && <p className="muted">Escriba al menos {MINIMO} caracteres.</p>}
        {limpio.length === 0 && (
          <p className="muted">Escriba una persona para ver a qué recintos fue, o un recinto para ver quiénes fueron.</p>
        )}
        {vacio && <p className="muted">No hay personas ni recintos que coincidan con "{q}".</p>}
        {resultado && !vacio && (
          <p className="muted">
            {resultado.personas.length} persona(s) · {resultado.recintos.length} recinto(s)
            {resultado.truncado && ' · Hay más resultados: afine la búsqueda (más letras del nombre o el código completo).'}
          </p>
        )}
      </div>
      {isError && (
        <p className="ocda-estado aviso" role="alert">
          {mensajeError(error, 'No se pudo buscar')}
        </p>
      )}
      {isFetching && !resultado && limpio.length >= MINIMO && <Cargando texto="Buscando…" />}

      {resultado && resultado.personas.length > 0 && <Personas personas={resultado.personas} />}
      {resultado && resultado.recintos.length > 0 && <Recintos recintos={resultado.recintos} />}
    </section>
  );
}

/** Abre ese día en la pestaña Parejas. */
function useAbrirDia() {
  const [, setParams] = useSearchParams();
  return (fecha: string) =>
    setParams((prev) => {
      const n = new URLSearchParams(prev);
      n.set('tab', 'parejas');
      n.set('dia', fecha);
      return n;
    });
}

/** `detalle`: qué es esa fecha (el recinto o la pareja), para que cada botón se distinga en un lector de pantalla. */
function BotonFecha({ fecha, detalle }: { fecha: string; detalle: string }) {
  const abrir = useAbrirDia();
  return (
    <button
      type="button"
      className="ocda-chip mono"
      onClick={() => abrir(fecha)}
      title="Abrir este día en Parejas"
      aria-label={`Abrir el ${fechaCorta(fecha)} en Parejas: ${detalle}`}
    >
      {fechaCorta(fecha)}
    </button>
  );
}

function Personas({ personas }: { personas: PersonaAsignacionesCda[] }) {
  const { textos } = useCargosCda();
  return (
    <>
      <h3 style={{ fontSize: '1rem', margin: '1rem 0 0.5rem' }}>Personas</h3>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.75rem' }}>
        {personas.map((p) => (
          <li key={p.id} className="card" style={{ padding: '0.75rem 1rem' }}>
            <strong>{p.apellidosNombres}</strong> <span className="muted mono">{p.cedula}</span>{' '}
            <span className="muted">· {textos(p.grupo).titulo}</span>
            {p.asignaciones.length === 0 ? (
              <p className="muted" style={{ margin: '0.35rem 0 0' }}>
                Todavía no ha estado en ninguna pareja.
              </p>
            ) : (
              <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem', display: 'grid', gap: '0.35rem' }}>
                {p.asignaciones.map((a, i) => (
                  <li key={`${a.fecha}-${i}`}>
                    <BotonFecha fecha={a.fecha} detalle={a.recinto ? `${a.recinto.codigo} · ${a.recinto.nombre}` : 'Reserva'} />{' '}
                    {a.recinto ? (
                      <>
                        <strong className="mono">{a.recinto.codigo}</strong> · {a.recinto.nombre}
                      </>
                    ) : (
                      <span className="ocda-estado vacio">Reserva</span>
                    )}{' '}
                    <span className="muted">
                      {COMO[a.como]}
                      {a.pareja ? ` con ${a.pareja}` : ' sin pareja'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function Recintos({ recintos }: { recintos: RecintoAsignacionesCda[] }) {
  return (
    <>
      <h3 style={{ fontSize: '1rem', margin: '1rem 0 0.5rem' }}>Recintos</h3>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.75rem' }}>
        {recintos.map((r) => (
          <li key={r.id} className="card" style={{ padding: '0.75rem 1rem' }}>
            <strong className="mono">{r.codigo}</strong> · <strong>{r.nombre}</strong>
            {r.noCdas.length > 0 && (
              <div className="muted" style={{ fontSize: '0.85rem' }}>
                CDA del NO CDA {r.noCdas.map((n) => `${n.codigo} · ${n.nombre}`).join(', ')}
              </div>
            )}
            {r.asignaciones.length === 0 ? (
              <p className="muted" style={{ margin: '0.35rem 0 0' }}>
                Nadie ha ido a este recinto todavía.
              </p>
            ) : (
              <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem', display: 'grid', gap: '0.35rem' }}>
                {r.asignaciones.map((a, i) => (
                  <li key={`${a.fecha}-${i}`}>
                    <BotonFecha fecha={a.fecha} detalle={`${r.codigo} · ${a.operador}`} /> {a.operador}
                    {a.asistente ? ` + ${a.asistente}` : <span className="muted"> (sin asistente)</span>}
                    {a.kit && <span className="muted mono"> · kit {a.kit}</span>}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
