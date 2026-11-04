import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { AplicarParejasCdaResult, ParejaCdaFila, ParejaReservaCda, PersonaParejaCda, RecintoParejaCda } from '@cne/shared-types';
import { Modal } from '../../components/Modal';
import { asignarRecintoParejaCda, getDisponiblesParejasCda, pasarAReservaParejaCda, quitarParejaCda } from '../../lib/queries/operadores-cda';
import { ComboFiltrable, textoRecinto } from './ParejaFormModal';
import { DispositivoPersona } from './DispositivoPersona';
import { mensajeError } from './utils';

/** Pareja que va a la app en cada recinto (la que cede su lugar al asignarle una de reserva). */
function titularesPorRecinto(parejas: ParejaCdaFila[]): Map<string, ParejaCdaFila> {
  const m = new Map<string, ParejaCdaFila>();
  for (const p of parejas) if (p.estado !== 'SOLO_REGISTRADA' && !m.has(p.recinto.id)) m.set(p.recinto.id, p);
  for (const p of parejas) if (!m.has(p.recinto.id)) m.set(p.recinto.id, p);
  return m;
}

const nombre = (p: PersonaParejaCda | null) => p?.apellidosNombres ?? 'Sin asistente';

/**
 * La tarjeta o fila que abrió el modal desaparece al terminar (la pareja cambia
 * de pestaña): el foco va a la pestaña en vez de perderse en la página.
 * Después del cierre del Modal, que devuelve el foco a quien lo abrió.
 */
const enfocarPestana = (id: 'reserva' | 'en-recintos') => requestAnimationFrame(() => document.getElementById(`pestana-${id}`)?.focus());

/** Campo de justificación cuando la jornada ya inició (va a la bitácora). */
function Justificacion({ id, valor, onChange }: { id: string; valor: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <label htmlFor={id}>Justificación (la jornada ya inició)</label>
      <input
        id={id}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        maxLength={500}
        required
        autoComplete="off"
        aria-describedby={`${id}-ayuda`}
      />
      <p id={`${id}-ayuda`} className="muted" style={{ margin: '0.25rem 0 0' }}>
        Obligatoria: queda en la bitácora.
      </p>
    </div>
  );
}

/** Errores del paso a la app que dejan el modal abierto. */
function ErroresApp({ r }: { r: AplicarParejasCdaResult | undefined }) {
  if (!r?.errores.length) return null;
  return (
    <div className="banner error" role="alert">
      <p style={{ margin: 0 }}>
        <strong>El cambio se guardó, pero no pasó a la app:</strong>
      </p>
      <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem' }}>
        {r.errores.map((e) => (
          <li key={e.pareja}>{e.error}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Pestaña "Reserva" de Parejas: parejas del día sin recinto (no reciben kit ni
 * salen en la app). "Asignar a recinto" las ubica; si el recinto ya tiene
 * pareja, se intercambian.
 */
export function ReservaParejas({
  dia,
  reserva,
  parejas,
  isAdmin,
  congelado,
  justificacionInicial,
  onResultado,
}: {
  dia: string;
  reserva: ParejaReservaCda[];
  parejas: ParejaCdaFila[];
  isAdmin: boolean;
  congelado: boolean;
  justificacionInicial: string;
  onResultado: (r: AplicarParejasCdaResult) => void;
}) {
  const qc = useQueryClient();
  const [asignando, setAsignando] = useState<ParejaReservaCda | null>(null);
  const [quitarA, setQuitarA] = useState<ParejaReservaCda | null>(null);
  const quitar = useMutation({
    mutationFn: (p: ParejaReservaCda) => quitarParejaCda(p.id),
    onSuccess: (_, p) => {
      setQuitarA(null);
      qc.invalidateQueries({ queryKey: ['parejas-cda'] });
      sileo.success({ title: 'Pareja de reserva quitada', description: p.operador.apellidosNombres });
      enfocarPestana('reserva');
    },
  });

  if (reserva.length === 0) {
    return (
      <div className="banner info">
        <p style={{ margin: 0 }}>
          <strong>No hay parejas de reserva este día.</strong>
        </p>
        <p style={{ margin: '0.35rem 0 0' }}>
          Cárguelas con la plantilla escribiendo <strong className="mono">RESERVA</strong> en <span className="mono">codigo_recinto</span>, o use{' '}
          <strong>Pasar a reserva</strong> en una pareja de la pestaña En recintos.
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        Quedan registradas sin recinto ni kit, y salen en la hoja <strong>Reserva</strong> del reporte. Asígneles un recinto cuando haga falta.
      </p>
      <ul className="ocda-grid" aria-label={`Parejas de reserva del ${dia}`}>
        {reserva.map((p, i) => (
          <li key={p.id} className="ocda-tarjeta">
            <div className="ocda-tarjeta-top">
              <span className="ocda-estado vacio">Reserva {i + 1}</span>
            </div>
            <dl className="ocda-datos" style={{ borderTop: 0, paddingTop: 0 }}>
              <div>
                <dt>Operador CDA</dt>
                <dd>
                  {p.operador.apellidosNombres}
                  <br />
                  <span className="muted mono">{p.operador.cedula}</span>
                </dd>
              </div>
              <div>
                <dt>Asistente CDA</dt>
                <dd>
                  {p.asistente ? (
                    <>
                      {p.asistente.apellidosNombres}
                      <br />
                      <span className="muted mono">{p.asistente.cedula}</span>
                    </>
                  ) : (
                    <span className="muted">Sin asistente</span>
                  )}
                </dd>
              </div>
            </dl>
            <div>
              <DispositivoPersona rol="Operador" persona={p.operador} editable={isAdmin} />
              <DispositivoPersona rol="Asistente" persona={p.asistente} editable={isAdmin} />
            </div>
            {isAdmin && (
              <div className="ocda-tarjeta-admin">
                <button
                  type="button"
                  className="ocda-btn-texto"
                  aria-label={`Asignar a recinto la pareja de reserva de ${p.operador.apellidosNombres}`}
                  onClick={() => setAsignando(p)}
                >
                  Asignar a recinto
                </button>
                <button
                  type="button"
                  className="ocda-btn-texto peligro"
                  aria-label={`Quitar la pareja de reserva de ${p.operador.apellidosNombres}`}
                  onClick={() => {
                    quitar.reset();
                    setQuitarA(p);
                  }}
                >
                  Quitar
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {asignando && (
        <AsignarRecintoModal
          dia={dia}
          pareja={asignando}
          parejas={parejas}
          congelado={congelado}
          justificacionInicial={justificacionInicial}
          onResultado={onResultado}
          onClose={() => setAsignando(null)}
        />
      )}
      {quitarA && (
        <Modal labelledBy="quitar-reserva-titulo" onClose={() => setQuitarA(null)} maxWidth={480}>
          <div className="login-card" style={{ width: '100%', maxWidth: 'none' }}>
            <h1 id="quitar-reserva-titulo">Quitar pareja de reserva</h1>
            <p>
              ¿Quitar la pareja de reserva de {quitarA.operador.apellidosNombres} y {nombre(quitarA.asistente)}? Ya no saldrá en el reporte de
              este día.
            </p>
            {quitar.isError && (
              <p className="banner error" role="alert">
                {mensajeError(quitar.error, 'No se pudo quitar la pareja')}
              </p>
            )}
            <div className="row" style={{ justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className="btn secondary" onClick={() => setQuitarA(null)} disabled={quitar.isPending}>
                Cancelar
              </button>
              <button type="button" className="btn" onClick={() => quitar.mutate(quitarA)} disabled={quitar.isPending}>
                {quitar.isPending ? 'Quitando…' : 'Sí, quitar'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/**
 * Elige el recinto CDA de una pareja de reserva. Un recinto con pareja se
 * marca como ocupado y, antes de confirmar, se avisa quién pasa a reserva.
 */
function AsignarRecintoModal({
  dia,
  pareja,
  parejas,
  congelado,
  justificacionInicial,
  onResultado,
  onClose,
}: {
  dia: string;
  pareja: ParejaReservaCda;
  parejas: ParejaCdaFila[];
  congelado: boolean;
  justificacionInicial: string;
  onResultado: (r: AplicarParejasCdaResult) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [recintoId, setRecintoId] = useState('');
  const [justificacion, setJustificacion] = useState(justificacionInicial);
  const motivo = justificacion.trim() || undefined;
  // Todos los recintos CDA activos (con "todos" no se ocultan los ya usados).
  const { data, isLoading, error } = useQuery({
    queryKey: ['parejas-cda', 'disponibles', dia, 'todos'],
    queryFn: () => getDisponiblesParejasCda(dia, true),
  });
  const titulares = titularesPorRecinto(parejas);
  // Libres primero: así el caso común (cubrir un recinto vacío) queda arriba.
  const recintos = [...(data?.recintos ?? [])].sort((a, b) => Number(titulares.has(a.id)) - Number(titulares.has(b.id)));
  const texto = (r: RecintoParejaCda) => {
    const t = titulares.get(r.id);
    return t ? `${textoRecinto(r)} — ocupado por ${t.operador.apellidosNombres}` : `${textoRecinto(r)} — libre`;
  };
  const ocupante = recintoId ? titulares.get(recintoId) : undefined;

  const asignar = useMutation({
    mutationFn: () => asignarRecintoParejaCda(pareja.id, recintoId, motivo),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['parejas-cda'] });
      if (!r.errores.length) {
        onResultado(r);
        onClose();
        enfocarPestana('reserva');
      }
    },
  });
  // Ubicar la pareja siempre cambia una asignación (toma o crea el kit del recinto): con la jornada iniciada pide motivo.
  // Ya guardado (aunque no pasara a la app), solo queda cerrar: la pareja ya no es de reserva.
  const puede = !!recintoId && (!congelado || !!motivo) && !ocupante?.kitSalio && !asignar.isPending && !asignar.data;

  return (
    <Modal labelledBy="asignar-recinto-titulo" onClose={onClose} maxWidth={560}>
      <form
        className="login-card"
        style={{ width: '100%', maxWidth: 'none' }}
        aria-busy={asignar.isPending}
        onSubmit={(e) => {
          e.preventDefault();
          if (puede) asignar.mutate();
        }}
      >
        <h1 id="asignar-recinto-titulo">Asignar a recinto</h1>
        <p>
          Pareja de reserva: <strong>{pareja.operador.apellidosNombres}</strong> y <strong>{nombre(pareja.asistente)}</strong>.
        </p>
        {isLoading && (
          <p className="muted" role="status">
            Cargando recintos…
          </p>
        )}
        {error && (
          <p className="banner error" role="alert">
            {mensajeError(error, 'No se pudieron cargar los recintos')}
          </p>
        )}
        {data && (
          <ComboFiltrable
            id="reserva-recinto"
            etiqueta="Recinto CDA"
            opciones={recintos}
            valor={recintoId}
            onChange={(id) => {
              asignar.reset();
              setRecintoId(id);
            }}
            texto={texto}
            vacio="Elija un recinto"
            requerido
          />
        )}
        <div aria-live="polite">
          {ocupante?.kitSalio ? (
            <p className="banner error">
              El kit de {ocupante.operador.apellidosNombres} ya salió de la Delegación: esta pareja no se puede cambiar (cadena de custodia). Elija otro
              recinto.
            </p>
          ) : ocupante ? (
            <p className="banner aviso">
              Este recinto ya tiene pareja: <strong>{ocupante.operador.apellidosNombres}</strong> y <strong>{nombre(ocupante.asistente)}</strong> pasan
              a reserva{ocupante.kitCodigo ? ` y su kit ${ocupante.kitCodigo} pasa a esta pareja` : ''}.
            </p>
          ) : (
            recintoId && <p className="banner info">El recinto está libre: la pareja pasa a la app con el kit del recinto (si no tiene, se crea).</p>
          )}
        </div>
        {congelado && <Justificacion id="asignar-recinto-justificacion" valor={justificacion} onChange={setJustificacion} />}
        {asignar.isError && (
          <p className="banner error" role="alert">
            {mensajeError(asignar.error, 'No se pudo asignar el recinto')}
          </p>
        )}
        <ErroresApp r={asignar.data} />
        <div className="row" style={{ justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
          <button type="button" className="btn secondary" onClick={onClose} disabled={asignar.isPending}>
            {asignar.data ? 'Cerrar' : 'Cancelar'}
          </button>
          <button type="submit" className="btn" disabled={!puede}>
            {asignar.isPending ? 'Asignando…' : ocupante ? 'Sí, intercambiar' : 'Asignar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Confirmación de "Pasar a reserva" desde la tabla de recintos. */
export function PasarAReservaModal({
  pareja,
  congelado,
  justificacionInicial,
  onClose,
}: {
  pareja: ParejaCdaFila;
  congelado: boolean;
  justificacionInicial: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [justificacion, setJustificacion] = useState(justificacionInicial);
  const motivo = justificacion.trim() || undefined;
  const pasar = useMutation({
    mutationFn: () => pasarAReservaParejaCda(pareja.id, motivo),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['parejas-cda'] });
      // Con error (otra pareja del recinto no pasó a la app) se queda abierto para mostrar el motivo.
      if (!r.errores.length) {
        sileo.success({ title: 'Pareja pasada a reserva', description: pareja.operador.apellidosNombres });
        onClose();
        enfocarPestana('en-recintos');
      }
    },
  });
  const tieneKit = pareja.estado === 'EN_APP';
  // Sin kit en la app no cambia ninguna asignación: no hace falta motivo aunque la jornada haya iniciado.
  const puede = (!congelado || !tieneKit || !!motivo) && !pareja.kitSalio && !pasar.isPending && !pasar.data;

  return (
    <Modal labelledBy="pasar-reserva-titulo" onClose={onClose} maxWidth={520}>
      <form
        className="login-card"
        style={{ width: '100%', maxWidth: 'none' }}
        aria-busy={pasar.isPending}
        onSubmit={(e) => {
          e.preventDefault();
          if (puede) pasar.mutate();
        }}
      >
        <h1 id="pasar-reserva-titulo">Pasar a reserva</h1>
        <p>
          <strong>{pareja.operador.apellidosNombres}</strong> y <strong>{nombre(pareja.asistente)}</strong> dejan el recinto{' '}
          <strong>{textoRecinto(pareja.recinto)}</strong> y quedan de reserva este día.
        </p>
        {pareja.kitSalio ? (
          <p className="banner error">Su kit ya salió de la Delegación: no se puede pasar a reserva (cadena de custodia).</p>
        ) : (
          tieneKit && (
            <p className="banner aviso">
              El kit {pareja.kitCodigo} se quitará de la app de {pareja.portador?.apellidosNombres ?? pareja.operador.apellidosNombres} y queda en el
              recinto sin operador. Si el recinto tiene otra pareja, ella pasa a la app.
            </p>
          )
        )}
        {congelado && tieneKit && <Justificacion id="pasar-reserva-justificacion" valor={justificacion} onChange={setJustificacion} />}
        {pasar.isError && (
          <p className="banner error" role="alert">
            {mensajeError(pasar.error, 'No se pudo pasar a reserva')}
          </p>
        )}
        <ErroresApp r={pasar.data} />
        <div className="row" style={{ justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
          <button type="button" className="btn secondary" onClick={onClose} disabled={pasar.isPending}>
            {pasar.data ? 'Cerrar' : 'Cancelar'}
          </button>
          <button type="submit" className="btn" disabled={!puede}>
            {pasar.isPending ? 'Pasando…' : 'Sí, pasar a reserva'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
