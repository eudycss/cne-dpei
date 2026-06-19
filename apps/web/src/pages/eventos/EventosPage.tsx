import { FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ConfigAlertas,
  EstadoEvento,
  EventoElectoral,
  TipoEventoElectoral,
} from '@cne/shared-types';
import {
  configAlertasSchema,
  createEventoSchema,
  updateEventoSchema,
} from '@cne/shared-validation';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TIPO_LABELS: Record<TipoEventoElectoral, string> = {
  ELECCION_GENERAL: 'Elección General',
  SEGUNDA_VUELTA: 'Segunda Vuelta',
  CONSULTA_POPULAR: 'Consulta Popular',
  REFERENDUM: 'Referéndum',
  ELECCIONES_SECCIONALES: 'Elecciones Seccionales',
  OTRO: 'Otro',
};

const TIPOS: TipoEventoElectoral[] = [
  'ELECCION_GENERAL',
  'SEGUNDA_VUELTA',
  'CONSULTA_POPULAR',
  'REFERENDUM',
  'ELECCIONES_SECCIONALES',
  'OTRO',
];

function EstadoBadge({ estado }: { estado: EstadoEvento }) {
  const styles: Record<EstadoEvento, React.CSSProperties> = {
    BORRADOR: { background: '#f3f4f6', color: '#6b7280' },
    ACTIVO: { background: '#d1fae5', color: '#065f46' },
    CERRADO: { background: '#fee2e2', color: '#991b1b' },
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
  const isAdmin = user?.roles.includes('ADMINISTRADOR') ?? false;
  const qc = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<EventoElectoral | null>(null);
  const [closing, setClosing] = useState<EventoElectoral | null>(null);
  const [configurando, setConfigurando] = useState<EventoElectoral | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);

  const { data: eventos, isLoading } = useQuery({
    queryKey: ['eventos'],
    queryFn: async () => (await api.get<EventoElectoral[]>('/eventos')).data,
  });

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
      window.alert(err?.response?.data?.message ?? 'No se pudo activar el evento');
    } finally {
      setActivatingId(null);
    }
  }

  return (
    <>
      <h2>Eventos Electorales</h2>
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
                  <td>{TIPO_LABELS[e.tipo]}</td>
                  <td>{e.fechaJornada}</td>
                  <td>
                    <EstadoBadge estado={e.estado} />
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
                          <span className="muted" style={{ fontSize: '0.78rem' }}>
                            Cerrado
                          </span>
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

      {showCreate && (
        <EventoModal
          onClose={() => setShowCreate(false)}
          onDone={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ['eventos'] });
          }}
        />
      )}

      {editing && (
        <EventoModal
          evento={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ['eventos'] });
          }}
        />
      )}

      {closing && (
        <CloseEventoModal
          evento={closing}
          onClose={() => setClosing(null)}
          onDone={() => {
            setClosing(null);
            qc.invalidateQueries({ queryKey: ['eventos'] });
          }}
        />
      )}

      {configurando && (
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

// ─── Modal crear / editar evento ─────────────────────────────────────────────

function EventoModal({
  evento,
  onClose,
  onDone,
}: {
  evento?: EventoElectoral;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    nombre: evento?.nombre ?? '',
    tipo: (evento?.tipo ?? 'ELECCION_GENERAL') as TipoEventoElectoral,
    fechaJornada: evento?.fechaJornada ?? '',
    descripcion: evento?.descripcion ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function field(k: keyof typeof form) {
    return (
      e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
    ) => setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = {
      nombre: form.nombre,
      tipo: form.tipo,
      fechaJornada: form.fechaJornada,
      descripcion: form.descripcion || null,
    };
    const schema = evento ? updateEventoSchema : createEventoSchema;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos');
      return;
    }
    setSaving(true);
    try {
      if (evento) {
        await api.patch(`/eventos/${evento.id}`, parsed.data);
      } else {
        await api.post('/eventos', parsed.data);
      }
      onDone();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="center"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10 }}
    >
      <form
        className="login-card"
        style={{ maxWidth: 540, width: '100%' }}
        onSubmit={onSubmit}
      >
        <h1>{evento ? 'Editar evento' : 'Nuevo evento electoral'}</h1>

        <div className="field">
          <label>Nombre</label>
          <input
            value={form.nombre}
            onChange={field('nombre')}
            required
            maxLength={160}
            placeholder="Ej.: Elecciones Generales 2025"
          />
        </div>

        <div className="field">
          <label>Tipo</label>
          <select value={form.tipo} onChange={field('tipo')}>
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {TIPO_LABELS[t]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Fecha de jornada</label>
          <input
            type="date"
            value={form.fechaJornada}
            onChange={field('fechaJornada')}
            required
          />
        </div>

        <div className="field">
          <label>Descripción (opcional)</label>
          <textarea
            value={form.descripcion}
            onChange={field('descripcion')}
            rows={3}
            maxLength={2000}
            style={{
              width: '100%',
              padding: '0.5rem 0.65rem',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              fontSize: '0.9rem',
              resize: 'vertical',
            }}
          />
        </div>

        {error && <div className="banner error">{error}</div>}

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? 'Guardando…' : evento ? 'Guardar cambios' : 'Crear'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Modal cerrar evento ──────────────────────────────────────────────────────

function CloseEventoModal({
  evento,
  onClose,
  onDone,
}: {
  evento: EventoElectoral;
  onClose: () => void;
  onDone: () => void;
}) {
  const [justificacion, setJustificacion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendientes, setPendientes] = useState<Array<{ id: string; nombre: string }>>([]);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPendientes([]);
    setSaving(true);
    try {
      await api.post(`/eventos/${evento.id}/close`, {
        confirmar: true,
        justificacion: justificacion.trim() || undefined,
      });
      onDone();
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.pendientes) {
        setPendientes(data.pendientes);
        setError(data.message);
      } else {
        setError(data?.message ?? 'No se pudo cerrar el evento');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="center"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10 }}
    >
      <form
        className="login-card"
        style={{ maxWidth: 520, width: '100%' }}
        onSubmit={onSubmit}
      >
        <h1>Cerrar evento</h1>
        <p>
          Estás a punto de cerrar el evento{' '}
          <strong>"{evento.nombre}"</strong>. Esta acción no se puede deshacer.
        </p>

        {pendientes.length > 0 && (
          <div className="banner error">
            <strong>{pendientes.length} operador(es) sin llegada al DPI:</strong>
            <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
              {pendientes.map((p) => (
                <li key={p.id}>{p.nombre}</li>
              ))}
            </ul>
            <p style={{ margin: '0.5rem 0 0' }}>
              Proporciona una justificación para continuar el cierre.
            </p>
          </div>
        )}

        <div className="field">
          <label>
            Justificación{pendientes.length > 0 ? ' (requerida)' : ' (opcional)'}
          </label>
          <textarea
            value={justificacion}
            onChange={(e) => setJustificacion(e.target.value)}
            rows={3}
            maxLength={1000}
            required={pendientes.length > 0}
            style={{
              width: '100%',
              padding: '0.5rem 0.65rem',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              fontSize: '0.9rem',
              resize: 'vertical',
            }}
          />
        </div>

        {error && pendientes.length === 0 && (
          <div className="banner error">{error}</div>
        )}

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn danger" disabled={saving}>
            {saving ? 'Cerrando…' : 'Confirmar cierre'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Modal configurar alertas ─────────────────────────────────────────────────

function ConfigAlertasModal({
  evento,
  onClose,
  onDone,
}: {
  evento: EventoElectoral;
  onClose: () => void;
  onDone: () => void;
}) {
  // Cargar config actual del evento (incluye configAlertas)
  const { data: detalle } = useQuery({
    queryKey: ['evento-detalle', evento.id],
    queryFn: async () => (await api.get<EventoElectoral>(`/eventos/${evento.id}`)).data,
  });

  const cfg = detalle?.configAlertas;

  const [form, setForm] = useState<ConfigAlertas>({
    umbralLlegadaRecintoMin: cfg?.umbralLlegadaRecintoMin ?? 120,
    umbralLlegadaDpiMin: cfg?.umbralLlegadaDpiMin ?? 120,
    umbralSinSyncMin: cfg?.umbralSinSyncMin ?? 30,
    margenLlegadaMetros: cfg?.margenLlegadaMetros ?? 150,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Sincronizar form cuando llegue el detalle
  const [synced, setSynced] = useState(false);
  if (cfg && !synced) {
    setForm({
      umbralLlegadaRecintoMin: cfg.umbralLlegadaRecintoMin,
      umbralLlegadaDpiMin: cfg.umbralLlegadaDpiMin,
      umbralSinSyncMin: cfg.umbralSinSyncMin,
      margenLlegadaMetros: cfg.margenLlegadaMetros,
    });
    setSynced(true);
  }

  function numField(k: keyof ConfigAlertas) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: Number(e.target.value) }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = configAlertasSchema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos');
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/eventos/${evento.id}/config-alertas`, parsed.data);
      onDone();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="center"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10 }}
    >
      <form
        className="login-card"
        style={{ maxWidth: 480, width: '100%' }}
        onSubmit={onSubmit}
      >
        <h1>Configurar umbrales de alerta</h1>
        <p className="muted" style={{ marginBottom: '1rem' }}>
          Evento: <strong>{evento.nombre}</strong>. Los valores se expresan en
          minutos.
        </p>

        <div className="field">
          <label>Umbral llegada al recinto (min)</label>
          <input
            type="number"
            min={1}
            max={1440}
            value={form.umbralLlegadaRecintoMin}
            onChange={numField('umbralLlegadaRecintoMin')}
            required
          />
          <span className="muted">
            Alerta si el operador no llega al recinto antes de X minutos de la
            jornada.
          </span>
        </div>

        <div className="field">
          <label>Umbral llegada al DPI (min)</label>
          <input
            type="number"
            min={1}
            max={1440}
            value={form.umbralLlegadaDpiMin}
            onChange={numField('umbralLlegadaDpiMin')}
            required
          />
          <span className="muted">
            Alerta si el operador no registra llegada al DPI en X minutos.
          </span>
        </div>

        <div className="field">
          <label>Umbral sin sincronización (min)</label>
          <input
            type="number"
            min={1}
            max={1440}
            value={form.umbralSinSyncMin}
            onChange={numField('umbralSinSyncMin')}
            required
          />
          <span className="muted">
            Alerta si no se recibe ningún dato del operador en X minutos.
          </span>
        </div>

        <div className="field">
          <label>Margen de llegada al recinto (m)</label>
          <input
            type="number"
            min={10}
            max={50000}
            value={form.margenLlegadaMetros}
            onChange={numField('margenLlegadaMetros')}
            required
          />
          <span className="muted">
            Distancia máxima permitida para registrar "Llegada al Recinto". Sube este valor
            temporalmente en un evento de prueba para hacer una demo sin estar en el recinto real.
          </span>
        </div>

        {error && <div className="banner error">{error}</div>}

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}
