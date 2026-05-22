import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Asignacion, EventoElectoral, Paginated, User } from '@cne/shared-types';
import { api } from '../../lib/api';

// ─── Constantes ──────────────────────────────────────────────────────────────

const SIN_ASIGNAR = '';

// ─── Página ──────────────────────────────────────────────────────────────────

export function AsignacionesPage() {
  const [eventoId, setEventoId] = useState<string>('');
  const qc = useQueryClient();

  // Todos los eventos (para el selector)
  const { data: eventos } = useQuery({
    queryKey: ['eventos'],
    queryFn: async () => (await api.get<EventoElectoral[]>('/eventos')).data,
  });

  // Operadores CDA (rol OPERADOR_CDA)
  const { data: operadoresData } = useQuery({
    queryKey: ['users-operadores'],
    queryFn: async () =>
      (await api.get<Paginated<User>>('/users?role=OPERADOR_CDA&pageSize=500')).data,
    staleTime: 60_000,
  });

  // Técnicos supervisores (rol TECNICO_SUPERVISOR)
  const { data: supervisoresData } = useQuery({
    queryKey: ['users-supervisores'],
    queryFn: async () =>
      (await api.get<Paginated<User>>('/users?role=TECNICO_SUPERVISOR&pageSize=500')).data,
    staleTime: 60_000,
  });

  // Asignaciones actuales del evento seleccionado
  const { data: asignaciones, isLoading: loadingAsig } = useQuery({
    queryKey: ['asignaciones', eventoId],
    queryFn: async () => (await api.get<Asignacion[]>(`/asignaciones?eventoId=${eventoId}`)).data,
    enabled: !!eventoId,
  });

  const operadores = operadoresData?.items ?? [];
  const supervisores = supervisoresData?.items ?? [];

  // Mapeo operadorId → asignación actual
  const asigByOperador = new Map<string, Asignacion>(
    (asignaciones ?? []).map((a) => [a.operadorId, a]),
  );

  // Seleccionar automáticamente el evento activo al cargar
  if (!eventoId && eventos) {
    const activo = eventos.find((e) => e.estado === 'ACTIVO');
    if (activo) setEventoId(activo.id);
    else if (eventos.length > 0) setEventoId(eventos[0].id);
  }

  async function handleChange(operadorId: string, supervisorId: string) {
    if (!eventoId) return;

    if (supervisorId === SIN_ASIGNAR) {
      // Eliminar asignación existente si la hay
      const existente = asigByOperador.get(operadorId);
      if (existente) {
        try {
          await api.delete(`/asignaciones/${existente.id}`);
          qc.invalidateQueries({ queryKey: ['asignaciones', eventoId] });
        } catch (e: any) {
          window.alert(e?.response?.data?.message ?? 'No se pudo eliminar la asignación');
        }
      }
      return;
    }

    try {
      await api.put('/asignaciones', { eventoId, operadorId, supervisorId });
      qc.invalidateQueries({ queryKey: ['asignaciones', eventoId] });
    } catch (e: any) {
      window.alert(e?.response?.data?.message ?? 'No se pudo guardar la asignación');
    }
  }

  const eventoSeleccionado = eventos?.find((e) => e.id === eventoId);

  return (
    <>
      <h2>Asignación operador ↔ supervisor</h2>

      {/* Selector de evento */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="row" style={{ alignItems: 'center', margin: 0 }}>
          <label style={{ fontWeight: 600, minWidth: 120 }}>Evento electoral</label>
          <select
            value={eventoId}
            onChange={(e) => setEventoId(e.target.value)}
            style={{
              flex: 1,
              maxWidth: 480,
              padding: '0.5rem 0.65rem',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              fontSize: '0.9rem',
            }}
          >
            <option value="">— Selecciona un evento —</option>
            {eventos?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre} ({e.estado === 'ACTIVO' ? '✓ Activo' : e.estado === 'BORRADOR' ? 'Borrador' : 'Cerrado'})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabla de asignaciones */}
      {eventoId && (
        <div className="card">
          {eventoSeleccionado && (
            <p className="muted" style={{ marginTop: 0 }}>
              Evento: <strong>{eventoSeleccionado.nombre}</strong> · Fecha:{' '}
              {eventoSeleccionado.fechaJornada}
            </p>
          )}

          {operadores.length === 0 ? (
            <div className="banner" style={{ marginBottom: 0 }}>
              No hay usuarios con rol <strong>OPERADOR_CDA</strong> en el sistema. Asigna
              ese rol a los usuarios en la sección{' '}
              <a href="/users">Usuarios</a>.
            </div>
          ) : supervisores.length === 0 ? (
            <div className="banner" style={{ marginBottom: 0 }}>
              No hay usuarios con rol <strong>TECNICO_SUPERVISOR</strong>. Asigna ese rol
              a al menos un usuario en{' '}
              <a href="/users">Usuarios</a>.
            </div>
          ) : loadingAsig ? (
            <p className="muted">Cargando asignaciones…</p>
          ) : (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                Selecciona el técnico supervisor para cada operador CDA. Los cambios se
                guardan automáticamente.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Operador CDA</th>
                    <th>Cédula</th>
                    <th>Técnico supervisor asignado</th>
                  </tr>
                </thead>
                <tbody>
                  {operadores.map((op) => {
                    const asig = asigByOperador.get(op.id);
                    return (
                      <OperadorRow
                        key={op.id}
                        operador={op}
                        supervisores={supervisores}
                        supervisorId={asig?.supervisorId ?? SIN_ASIGNAR}
                        onChange={(svId) => handleChange(op.id, svId)}
                      />
                    );
                  })}
                </tbody>
              </table>
              <p className="muted" style={{ marginTop: '0.75rem', fontSize: '0.8rem' }}>
                {asignaciones?.length ?? 0} de {operadores.length} operador(es) asignado(s)
              </p>
            </>
          )}
        </div>
      )}

      {!eventoId && eventos && eventos.length === 0 && (
        <div className="card">
          <div className="banner" style={{ marginBottom: 0 }}>
            No hay eventos electorales creados. Crea uno en la sección{' '}
            <a href="/eventos">Eventos Electorales</a>.
          </div>
        </div>
      )}
    </>
  );
}

// ─── Fila de operador con select de supervisor ────────────────────────────────

function OperadorRow({
  operador,
  supervisores,
  supervisorId,
  onChange,
}: {
  operador: User;
  supervisores: User[];
  supervisorId: string;
  onChange: (supervisorId: string) => void;
}) {
  const [saving, setSaving] = useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setSaving(true);
    try {
      await onChange(e.target.value);
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td>
        {operador.nombres} {operador.apellidos}
      </td>
      <td>{operador.cedula}</td>
      <td>
        <select
          value={supervisorId}
          onChange={handleChange}
          disabled={saving}
          style={{
            padding: '0.35rem 0.5rem',
            border: '1px solid #d1d5db',
            borderRadius: 6,
            fontSize: '0.85rem',
            minWidth: 240,
            background: supervisorId ? '#f0fdf4' : '#fff',
            color: supervisorId ? '#15803d' : '#6b7280',
          }}
        >
          <option value="">— Sin asignar —</option>
          {supervisores.map((sv) => (
            <option key={sv.id} value={sv.id}>
              {sv.nombres} {sv.apellidos} ({sv.cedula})
            </option>
          ))}
        </select>
        {saving && (
          <span className="muted" style={{ marginLeft: '0.5rem', fontSize: '0.78rem' }}>
            Guardando…
          </span>
        )}
      </td>
    </tr>
  );
}
