import { actuaComoAdmin } from '../../lib/roles';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { EstadoEvento, EventoElectoral } from '@cne/shared-types';
import { sileo } from 'sileo';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { getTiposEvento } from '../../lib/queries/tipos-evento';
import { TiposEventoPage } from '../tipos-evento/TiposEventoPage';
import { PasoFlujo } from '../../components/PasoFlujo';
import { ConfigAlertasModal } from './ConfigAlertasModal';
import { ReopenEventoModal } from './ReopenEventoModal';
import { CloseEventoModal } from './CloseEventoModal';
import { EventoModal } from './EventoModal';

function EstadoBadge({ estado }: { estado: EstadoEvento }) {
  const styles: Record<EstadoEvento, React.CSSProperties> = {
    BORRADOR: { background: 'var(--border-subtle)', color: 'var(--text-muted)' },
    ACTIVO: { background: 'var(--success-bg)', color: 'var(--success-text)' },
    CERRADO: { background: 'var(--error-bg)', color: 'var(--error-text)' },
  };
  const labels: Record<EstadoEvento, string> = {
    BORRADOR: 'Borrador',
    ACTIVO: 'Activo',
    CERRADO: 'Cerrado',
  };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.15rem 0.6rem',
        borderRadius: 999,
        fontSize: '0.78rem',
        fontWeight: 600,
        ...styles[estado],
      }}
    >
      {labels[estado]}
    </span>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export function EventosPage() {
  const { user } = useAuth();
  const isAdmin = actuaComoAdmin(user?.roles);
  const qc = useQueryClient();

  const [tab, setTab] = useState<'eventos' | 'tipos'>('eventos');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<EventoElectoral | null>(null);
  const [closing, setClosing] = useState<EventoElectoral | null>(null);
  const [configurando, setConfigurando] = useState<EventoElectoral | null>(null);
  const [reabriendo, setReabriendo] = useState<EventoElectoral | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);

  const { data: eventos, isLoading } = useQuery({
    queryKey: ['eventos'],
    queryFn: async () => (await api.get<EventoElectoral[]>('/eventos')).data,
  });

  const { data: tiposEvento = [] } = useQuery({
    queryKey: ['tipos-evento'],
    queryFn: async () => (await getTiposEvento()).data,
    staleTime: Infinity,
  });

  function tipoLabel(codigo: string) {
    return tiposEvento.find((t) => t.codigo === codigo)?.etiqueta ?? codigo;
  }

  async function handleActivar(e: EventoElectoral) {
    if (
      !window.confirm(
        `¿Activar el evento "${e.nombre}"?\n\nSolo puede haber un evento activo a la vez. Si existe otro activo, la operación fallará.`,
      )
    )
      return;
    setActivatingId(e.id);
    try {
      await api.post(`/eventos/${e.id}/activate`);
      qc.invalidateQueries({ queryKey: ['eventos'] });
    } catch (err: any) {
      sileo.error({ title: err?.response?.data?.message ?? 'No se pudo activar el evento' });
    } finally {
      setActivatingId(null);
    }
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '0.45rem 1rem',
    border: 'none',
    borderBottom: active ? '2px solid var(--primary)' : '2px solid transparent',
    background: 'none',
    color: active ? 'var(--primary)' : 'var(--text-muted)',
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    fontSize: '0.9rem',
  });

  return (
    <>
      <h2>Eventos Electorales</h2>
      <PasoFlujo paso="evento" />

      {isAdmin && (
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '1rem' }}>
          <button style={tabStyle(tab === 'eventos')} onClick={() => setTab('eventos')}>
            Eventos
          </button>
          <button style={tabStyle(tab === 'tipos')} onClick={() => setTab('tipos')}>
            Tipos de Evento
          </button>
        </div>
      )}

      {tab === 'tipos' ? (
        <TiposEventoPage />
      ) : (
      <div className="card">
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {isAdmin && (
            <button className="btn" onClick={() => setShowCreate(true)}>
              + Nuevo evento
            </button>
          )}
        </div>

        {isLoading ? (
          <p className="muted">Cargando…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Fecha jornada</th>
                <th>Estado</th>
                {isAdmin && <th style={{ width: 320 }}>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {eventos?.map((e) => (
                <tr key={e.id}>
                  <td>
                    <strong>{e.nombre}</strong>
                    {e.descripcion && (
                      <div className="muted" style={{ fontSize: '0.78rem' }}>
                        {e.descripcion}
                      </div>
                    )}
                  </td>
                  <td>{tipoLabel(e.tipo)}</td>
                  <td>{e.fechaJornada}</td>
                  <td>
                    <EstadoBadge estado={e.estado} />
                    {e.estado === 'ACTIVO' && e.reabiertoEn && (
                      <div className="muted" style={{ fontSize: '0.75rem' }}>
                        <strong>Reabierto (solo consulta)</strong> ·{' '}
                        {new Date(e.reabiertoEn).toLocaleString('es-EC')}
                      </div>
                    )}
                    {e.estado === 'CERRADO' && e.cerradoEn && (
                      <div className="muted" style={{ fontSize: '0.75rem' }}>
                        {new Date(e.cerradoEn).toLocaleString('es-EC')}
                      </div>
                    )}
                  </td>
                  {isAdmin && (
                    <td>
                      <div className="row" style={{ margin: 0, gap: '0.3rem', flexWrap: 'wrap' }}>
                        {e.estado === 'BORRADOR' && (
                          <>
                            <button
                              className="btn secondary"
                              style={{ padding: '0.3rem 0.55rem', fontSize: '0.78rem' }}
                              onClick={() => setEditing(e)}
                            >
                              Editar
                            </button>
                            <button
                              className="btn"
                              style={{
                                padding: '0.3rem 0.55rem',
                                fontSize: '0.78rem',
                                background: '#16a34a',
                              }}
                              disabled={activatingId === e.id}
                              onClick={() => handleActivar(e)}
                            >
                              {activatingId === e.id ? '…' : 'Activar'}
                            </button>
                          </>
                        )}
                        {e.estado === 'ACTIVO' && (
                          <>
                            <button
                              className="btn danger"
                              style={{ padding: '0.3rem 0.55rem', fontSize: '0.78rem' }}
                              onClick={() => setClosing(e)}
                            >
                              Cerrar evento
                            </button>
                            <button
                              className="btn secondary"
                              style={{ padding: '0.3rem 0.55rem', fontSize: '0.78rem' }}
                              onClick={() => setConfigurando(e)}
                            >
                              Config alertas
                            </button>
                          </>
                        )}
                        {e.estado === 'CERRADO' && (
                          <button
                            className="btn secondary"
                            style={{ padding: '0.3rem 0.55rem', fontSize: '0.78rem' }}
                            onClick={() => setReabriendo(e)}
                            aria-label={`Reabrir el evento ${e.nombre} para consulta`}
                          >
                            Reabrir
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {eventos?.length === 0 && (
                <tr>
                  <td
                    colSpan={isAdmin ? 5 : 4}
                    className="muted"
                    style={{ textAlign: 'center', padding: '1.5rem' }}
                  >
                    No hay eventos registrados
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      )}

      {tab === 'eventos' && showCreate && (
        <EventoModal
          tiposEvento={tiposEvento}
          onClose={() => setShowCreate(false)}
          onDone={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ['eventos'] });
          }}
        />
      )}

      {tab === 'eventos' && editing && (
        <EventoModal
          evento={editing}
          tiposEvento={tiposEvento}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ['eventos'] });
          }}
        />
      )}

      {tab === 'eventos' && closing && (
        <CloseEventoModal
          evento={closing}
          onClose={() => setClosing(null)}
          onDone={() => {
            setClosing(null);
            qc.invalidateQueries({ queryKey: ['eventos'] });
          }}
        />
      )}

      {tab === 'eventos' && reabriendo && (
        <ReopenEventoModal
          evento={reabriendo}
          onClose={() => setReabriendo(null)}
          onDone={() => {
            setReabriendo(null);
            qc.invalidateQueries({ queryKey: ['eventos'] });
          }}
        />
      )}

      {tab === 'eventos' && configurando && (
        <ConfigAlertasModal
          evento={configurando}
          onClose={() => setConfigurando(null)}
          onDone={() => {
            setConfigurando(null);
            qc.invalidateQueries({ queryKey: ['eventos'] });
          }}
        />
      )}
    </>
  );
}
