import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { EnlaceRecinto } from '@cne/shared-types';
import { addCorreoEnlace, getConfigEnlaces, getEnlaces, removeCorreoEnlace } from '../../lib/queries/enlaces';
import { formatearFechaHora } from '../../lib/notifications';

const ESTADO_COLOR: Record<EnlaceRecinto['estado'], string> = {
  ACTIVO: '#16a34a',
  FALLO: '#ef4444',
};

export function EnlacesPage() {
  const qc = useQueryClient();
  const [nuevoCorreo, setNuevoCorreo] = useState('');

  const { data: enlaces = [], isLoading } = useQuery({
    queryKey: ['enlaces'],
    queryFn: getEnlaces,
  });

  const { data: config } = useQuery({
    queryKey: ['enlaces-config'],
    queryFn: getConfigEnlaces,
  });

  const agregar = useMutation({
    mutationFn: (correo: string) => addCorreoEnlace(correo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['enlaces-config'] });
      setNuevoCorreo('');
      sileo.success({ title: 'Correo agregado' });
    },
    onError: (e: any) => {
      sileo.error({ title: e?.response?.data?.message ?? 'No se pudo agregar el correo' });
    },
  });

  const quitar = useMutation({
    mutationFn: (correo: string) => removeCorreoEnlace(correo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['enlaces-config'] });
      sileo.success({ title: 'Correo eliminado' });
    },
    onError: (e: any) => {
      sileo.error({ title: e?.response?.data?.message ?? 'No se pudo eliminar el correo' });
    },
  });

  return (
    <>
      <h2>Enlaces (CDAs Imbabura)</h2>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>Correos que reciben el aviso de enlace caído</h3>
        <ul style={{ paddingLeft: '1.1rem' }}>
          {(config?.correos ?? []).map((correo) => (
            <li key={correo} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              {correo}
              <button
                className="btn secondary"
                disabled={quitar.isPending}
                onClick={() => quitar.mutate(correo)}
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <label style={{ display: 'none' }} htmlFor="nuevo-correo-enlace">Nuevo correo</label>
          <input
            id="nuevo-correo-enlace"
            aria-label="Nuevo correo"
            type="email"
            value={nuevoCorreo}
            onChange={(e) => setNuevoCorreo(e.target.value)}
            placeholder="correo@cne.gob.ec"
            style={{ padding: '0.5rem 0.65rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.9rem', flex: 1 }}
          />
          <button
            className="btn"
            disabled={!nuevoCorreo || agregar.isPending}
            onClick={() => agregar.mutate(nuevoCorreo)}
          >
            Agregar
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="muted">Cargando enlaces…</p>
      ) : enlaces.length === 0 ? (
        <p className="muted" style={{ textAlign: 'center', padding: '2rem 0' }}>
          No hay enlaces registrados todavía. Se completan en la primera revisión automática.
        </p>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Recinto</th>
                <th>Estado</th>
                <th>Actualizado</th>
              </tr>
            </thead>
            <tbody>
              {enlaces.map((e) => (
                <tr key={e.codigoRecinto}>
                  <td style={{ whiteSpace: 'nowrap' }}>{e.codigoRecinto}</td>
                  <td>{e.nombreRecinto}</td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: ESTADO_COLOR[e.estado], display: 'inline-block' }} />
                      {e.estado}
                    </span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>{formatearFechaHora(e.actualizadoEn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
