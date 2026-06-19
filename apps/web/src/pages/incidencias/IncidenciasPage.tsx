import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { EstadoIncidencia, Incidencia, TipoIncidencia } from '@cne/shared-types';
import {
  getComentarios,
  getFotoIncidencia,
  getIncidencia,
  getIncidencias,
  updateEstadoIncidencia,
} from '../../lib/queries/incidencias';
import { formatearFechaHora } from '../../lib/notifications';
import { useAuth } from '../../auth/AuthContext';

const ESTADO_INFO: Record<EstadoIncidencia, { label: string; color: string }> = {
  ABIERTA: { label: 'Abierta', color: '#9ca3af' },
  ATENDIDA: { label: 'Atendida', color: '#f59e0b' },
  CERRADA: { label: 'Cerrada', color: '#16a34a' },
};

const TIPO_LABELS: Record<TipoIncidencia, string> = {
  KIT_DANADO: 'Kit dañado',
  KIT_FALTANTE: 'Kit faltante',
  PROBLEMA_RECINTO: 'Problema en el recinto',
  RETRASO: 'Retraso',
  PROBLEMA_SEGURIDAD: 'Problema de seguridad',
  OTRO: 'Otro',
};

function EstadoBadge({ estado }: { estado: EstadoIncidencia }) {
  const info = ESTADO_INFO[estado];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: info.color, display: 'inline-block' }} />
      {info.label}
    </span>
  );
}

function IncidenciaDetalleModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { user } = useAuth();
  const puedeGestionar = user?.roles.some((r) => r === 'ADMINISTRADOR' || r === 'TECNICO_SUPERVISOR') ?? false;
  const qc = useQueryClient();
  const [comentario, setComentario] = useState('');
  const [nuevoEstado, setNuevoEstado] = useState<'ATENDIDA' | 'CERRADA'>('ATENDIDA');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['incidencia', id],
    queryFn: () => getIncidencia(id),
  });

  const { data: comentarios } = useQuery({
    queryKey: ['incidencia-comentarios', id],
    queryFn: () => getComentarios(id),
    enabled: !!data,
  });

  useEffect(() => {
    if (!data?.fotoUrl) return;
    let objectUrl: string | null = null;
    getFotoIncidencia(id).then((blob) => {
      objectUrl = URL.createObjectURL(blob);
      setFotoUrl(objectUrl);
    });
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [data?.fotoUrl, id]);

  async function handleGuardar() {
    setError(null);
    setGuardando(true);
    try {
      await updateEstadoIncidencia(id, { estado: nuevoEstado, comentario: comentario.trim() || undefined });
      setComentario('');
      qc.invalidateQueries({ queryKey: ['incidencias'] });
      qc.invalidateQueries({ queryKey: ['incidencia', id] });
      qc.invalidateQueries({ queryKey: ['incidencia-comentarios', id] });
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'No se pudo actualizar la incidencia');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="center" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1100, padding: '2rem 0' }}>
      <div className="login-card" style={{ maxWidth: 560, width: '100%', padding: 0, overflow: 'hidden', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ margin: 0 }}>Incidencia</h2>
        </div>
        <div style={{ padding: '1.25rem', overflow: 'auto', flex: 1 }}>
          {isLoading || !data ? (
            <p className="muted">Cargando…</p>
          ) : (
            <>
              <p>
                <strong>{TIPO_LABELS[data.tipo]}</strong> · <EstadoBadge estado={data.estado} />
              </p>
              <p className="muted">
                {data.operadorNombre} {data.recintoNombre ? `· ${data.recintoNombre}` : ''}
                {data.kitCodigo ? ` · Kit ${data.kitCodigo}` : ''} · {formatearFechaHora(data.reportadoEn)}
              </p>
              {data.descripcion && <p>{data.descripcion}</p>}
              {fotoUrl && (
                <img src={fotoUrl} alt="Foto de la incidencia" style={{ maxWidth: '100%', maxHeight: 280, borderRadius: 6 }} />
              )}
              {data.latitud != null && data.longitud != null && (
                <p>
                  <a
                    href={`https://maps.google.com/?q=${data.latitud},${data.longitud}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ver ubicación en Google Maps
                  </a>
                </p>
              )}

              <h3 style={{ marginTop: '1.25rem' }}>Comentarios</h3>
              {!comentarios || comentarios.length === 0 ? (
                <p className="muted">Sin comentarios todavía.</p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {comentarios.map((c) => (
                    <li key={c.id} style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border-subtle)' }}>
                      <div>{c.comentario}</div>
                      <div className="muted" style={{ fontSize: '0.75rem' }}>
                        {c.usuarioNombre} · {formatearFechaHora(c.creadoEn)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {puedeGestionar && data.estado !== 'CERRADA' && (
                <div style={{ marginTop: '1.25rem' }}>
                  <h3>Cambiar estado</h3>
                  <div className="field">
                    <select value={nuevoEstado} onChange={(e) => setNuevoEstado(e.target.value as 'ATENDIDA' | 'CERRADA')}>
                      <option value="ATENDIDA">Atendida</option>
                      <option value="CERRADA">Cerrada</option>
                    </select>
                  </div>
                  <div className="field">
                    <textarea
                      placeholder="Comentario (opcional)"
                      value={comentario}
                      onChange={(e) => setComentario(e.target.value)}
                      rows={3}
                    />
                  </div>
                  {error && <p className="error">{error}</p>}
                  <button className="btn" onClick={handleGuardar} disabled={guardando}>
                    {guardando ? 'Guardando…' : 'Guardar'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', padding: '1rem', borderTop: '1px solid var(--border)' }}>
          <button className="btn secondary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

export function IncidenciasPage() {
  const [estadoFiltro, setEstadoFiltro] = useState('');
  const [page, setPage] = useState(1);
  const [detalleId, setDetalleId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['incidencias', { estadoFiltro, page }],
    queryFn: () => getIncidencias({ estado: estadoFiltro || undefined, page, pageSize: 20 }),
    refetchInterval: 30_000,
  });

  const items: Incidencia[] = data?.items ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <h2>Incidencias</h2>
      <p className="muted" style={{ marginTop: '-0.5rem' }}>
        Incidencias reportadas por los operadores en campo. Se actualiza automáticamente cada 30 segundos.
      </p>

      <div className="card">
        <div className="row">
          <select value={estadoFiltro} onChange={(e) => { setEstadoFiltro(e.target.value); setPage(1); }}>
            <option value="">Todos los estados</option>
            <option value="ABIERTA">Abierta</option>
            <option value="ATENDIDA">Atendida</option>
            <option value="CERRADA">Cerrada</option>
          </select>
        </div>

        {isLoading ? (
          <p className="muted">Cargando…</p>
        ) : isError ? (
          <p className="error">No se pudieron cargar las incidencias.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Operador</th>
                  <th>Recinto / Kit</th>
                  <th>Estado</th>
                  <th>Reportado</th>
                </tr>
              </thead>
              <tbody>
                {items.map((inc) => (
                  <tr key={inc.id} style={{ cursor: 'pointer' }} onClick={() => setDetalleId(inc.id)}>
                    <td>{TIPO_LABELS[inc.tipo]}</td>
                    <td>{inc.operadorNombre}</td>
                    <td>{inc.recintoNombre ?? inc.kitCodigo ?? '—'}</td>
                    <td><EstadoBadge estado={inc.estado} /></td>
                    <td>{formatearFechaHora(inc.reportadoEn)}</td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted" style={{ textAlign: 'center', padding: '1.5rem' }}>
                      No hay incidencias para este filtro
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {data && totalPages > 1 && (
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: '0.75rem' }}>
            <button className="btn secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</button>
            <span className="muted">Página {page} de {totalPages}</span>
            <button className="btn secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Siguiente</button>
          </div>
        )}
      </div>

      {detalleId && <IncidenciaDetalleModal id={detalleId} onClose={() => setDetalleId(null)} />}
    </div>
  );
}
