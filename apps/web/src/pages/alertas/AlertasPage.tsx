import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Alerta, EstadoAlerta, EventoElectoral, TipoAlerta } from '@cne/shared-types';
import { sileo } from 'sileo';
import { getAlertas, updateEstadoAlerta } from '../../lib/queries/alertas';
import { formatearFechaHora } from '../../lib/notifications';
import { api } from '../../lib/api';

const TIPO_LABELS: Record<TipoAlerta, string> = {
  NO_LLEGO_RECINTO: 'No llegó al recinto',
  NO_LLEGO_DPI: 'No llegó al DPI',
  SIN_SINCRONIZAR: 'Sin sincronización',
  KIT_NO_CORRESPONDE: 'Kit no corresponde',
};

const ESTADO_INFO: Record<EstadoAlerta, { label: string; color: string }> = {
  GENERADA: { label: 'Generada', color: '#ef4444' },
  VISTA: { label: 'Vista', color: '#f59e0b' },
  ATENDIDA: { label: 'Atendida', color: '#16a34a' },
};

function EstadoBadge({ estado }: { estado: EstadoAlerta }) {
  const info = ESTADO_INFO[estado];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: info.color, display: 'inline-block' }} />
      {info.label}
    </span>
  );
}

export function AlertasPage() {
  const qc = useQueryClient();
  const [eventoId, setEventoId] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('GENERADA');
  const [accionando, setAccionando] = useState<string | null>(null);

  const { data: eventos } = useQuery<EventoElectoral[]>({
    queryKey: ['eventos-selector'],
    queryFn: async () => (await api.get<EventoElectoral[]>('/eventos')).data,
  });

  const { data: alertas = [], isLoading } = useQuery<Alerta[]>({
    queryKey: ['alertas', eventoId, filtroTipo, filtroEstado],
    queryFn: () =>
      getAlertas({
        eventoId,
        tipo: filtroTipo || undefined,
        estado: filtroEstado || undefined,
      }),
    enabled: !!eventoId,
  });

  async function marcar(id: string, estado: 'VISTA' | 'ATENDIDA') {
    setAccionando(id);
    try {
      await updateEstadoAlerta(id, { estado });
      qc.invalidateQueries({ queryKey: ['alertas', eventoId] });
      sileo.success({ title: `Alerta marcada como ${estado.toLowerCase()}` });
    } catch (e: any) {
      sileo.error({ title: e?.response?.data?.message ?? 'Error al actualizar alerta' });
    } finally {
      setAccionando(null);
    }
  }

  return (
    <>
      <h2>Alertas</h2>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', margin: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: '1 1 200px' }}>
            <label style={{ fontWeight: 600, fontSize: '0.85rem' }}>Evento</label>
            <select value={eventoId} onChange={(e) => setEventoId(e.target.value)}
              style={{ padding: '0.5rem 0.65rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.9rem' }}>
              <option value="">— Selecciona un evento —</option>
              {eventos?.map((e) => (
                <option key={e.id} value={e.id}>{e.nombre}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: '1 1 160px' }}>
            <label style={{ fontWeight: 600, fontSize: '0.85rem' }}>Tipo</label>
            <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}
              style={{ padding: '0.5rem 0.65rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.9rem' }}>
              <option value="">Todos</option>
              {(Object.keys(TIPO_LABELS) as TipoAlerta[]).map((t) => (
                <option key={t} value={t}>{TIPO_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: '1 1 140px' }}>
            <label style={{ fontWeight: 600, fontSize: '0.85rem' }}>Estado</label>
            <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}
              style={{ padding: '0.5rem 0.65rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.9rem' }}>
              <option value="">Todos</option>
              <option value="GENERADA">Generada</option>
              <option value="VISTA">Vista</option>
              <option value="ATENDIDA">Atendida</option>
            </select>
          </div>
        </div>
      </div>

      {!eventoId ? (
        <p className="muted" style={{ textAlign: 'center', padding: '2rem 0' }}>
          Selecciona un evento para ver sus alertas.
        </p>
      ) : isLoading ? (
        <p className="muted">Cargando alertas…</p>
      ) : alertas.length === 0 ? (
        <p className="muted" style={{ textAlign: 'center', padding: '2rem 0' }}>
          No hay alertas con los filtros seleccionados.
        </p>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Operador</th>
                <th>Mensaje</th>
                <th>Generada</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {alertas.map((a) => (
                <tr key={a.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{TIPO_LABELS[a.tipo]}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{a.operadorNombre ?? '—'}</td>
                  <td style={{ fontSize: '0.85rem', maxWidth: 320 }}>{a.mensaje}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>{formatearFechaHora(a.generadaEn)}</td>
                  <td><EstadoBadge estado={a.estado} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'nowrap' }}>
                      {a.estado === 'GENERADA' && (
                        <button className="btn secondary" disabled={accionando === a.id}
                          onClick={() => marcar(a.id, 'VISTA')}>
                          Ver
                        </button>
                      )}
                      {a.estado !== 'ATENDIDA' && (
                        <button className="btn" disabled={accionando === a.id}
                          onClick={() => marcar(a.id, 'ATENDIDA')}>
                          Atender
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '0.75rem 1rem', fontSize: '0.85rem', opacity: 0.7 }}>
            {alertas.length} alerta(s)
          </div>
        </div>
      )}
    </>
  );
}
