import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { EnlaceRecinto } from '@cne/shared-types';
import {
  addCorreoEnlace,
  getConfigEnlaces,
  getEnlaces,
  reenviarListaTelegram,
  removeCorreoEnlace,
} from '../../lib/queries/enlaces';
import { formatearFechaHora } from '../../lib/notifications';

const ESTADO_COLOR: Record<EnlaceRecinto['estado'], string> = {
  ACTIVO: '#16a34a',
  FALLO: '#ef4444',
};

type FiltroEstado = 'TODOS' | EnlaceRecinto['estado'];

const FILTROS: { valor: FiltroEstado; etiqueta: string }[] = [
  { valor: 'TODOS', etiqueta: 'Todos' },
  { valor: 'ACTIVO', etiqueta: 'Activos' },
  { valor: 'FALLO', etiqueta: 'Fallidos' },
];

export function EnlacesPage() {
  const qc = useQueryClient();
  const [nuevoCorreo, setNuevoCorreo] = useState('');
  const [filtro, setFiltro] = useState<FiltroEstado>('TODOS');
  const [busqueda, setBusqueda] = useState('');
  const [cantonFiltro, setCantonFiltro] = useState('');

  const { data: enlaces = [], isLoading } = useQuery({
    queryKey: ['enlaces'],
    queryFn: getEnlaces,
    refetchInterval: 30_000,
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

  const reenviarTelegram = useMutation({
    mutationFn: reenviarListaTelegram,
    onSuccess: ({ enviados }) => {
      sileo.success({
        title: enviados > 0 ? `Lista reenviada a Telegram (${enviados} caídos)` : 'Reenviado: no hay enlaces caídos',
      });
    },
    onError: (e: any) => {
      sileo.error({ title: e?.response?.data?.message ?? 'No se pudo reenviar la lista a Telegram' });
    },
  });

  const cantones = useMemo(() => {
    const set = new Set(enlaces.map((e) => e.canton).filter((c): c is string => !!c));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [enlaces]);

  const busquedaNormalizada = busqueda.trim().toLowerCase();

  const enlacesFiltrados = enlaces
    .filter((e) => filtro === 'TODOS' || e.estado === filtro)
    .filter((e) => !cantonFiltro || e.canton === cantonFiltro)
    .filter(
      (e) =>
        !busquedaNormalizada ||
        e.codigoRecinto.toLowerCase().includes(busquedaNormalizada) ||
        e.nombreRecinto.toLowerCase().includes(busquedaNormalizada),
    );

  const conteos: Record<FiltroEstado, number> = {
    TODOS: enlaces.length,
    ACTIVO: enlaces.filter((e) => e.estado === 'ACTIVO').length,
    FALLO: enlaces.filter((e) => e.estado === 'FALLO').length,
  };

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
                aria-label={`Quitar ${correo}`}
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
        <div style={{ marginTop: '0.75rem' }}>
          <button
            className="btn secondary"
            disabled={reenviarTelegram.isPending}
            onClick={() => reenviarTelegram.mutate()}
          >
            Reenviar lista a Telegram
          </button>
          <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.35rem' }}>
            Manda al grupo de Telegram configurado el estado actual completo — útil después de agregar gente nueva al grupo.
          </p>
        </div>
      </div>

      {enlaces.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <label style={{ display: 'none' }} htmlFor="buscar-enlace">Buscar por nombre o código</label>
            <input
              id="buscar-enlace"
              aria-label="Buscar por nombre o código"
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre o código…"
              style={{ padding: '0.5rem 0.65rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.9rem', flex: 1, minWidth: 200 }}
            />
            <label style={{ display: 'none' }} htmlFor="filtro-canton">Filtrar por cantón</label>
            <select
              id="filtro-canton"
              aria-label="Filtrar por cantón"
              value={cantonFiltro}
              onChange={(e) => setCantonFiltro(e.target.value)}
              style={{ padding: '0.5rem 0.65rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.9rem' }}
            >
              <option value="">Todos los cantones</option>
              {cantones.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div role="group" aria-label="Filtrar por estado" style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
            {FILTROS.map((f) => (
              <button
                key={f.valor}
                type="button"
                className={filtro === f.valor ? 'btn' : 'btn secondary'}
                aria-pressed={filtro === f.valor}
                onClick={() => setFiltro(f.valor)}
              >
                {f.etiqueta} ({conteos[f.valor]})
              </button>
            ))}
          </div>

          <p
            aria-live="polite"
            style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}
          >
            Mostrando {enlacesFiltrados.length} de {enlaces.length} enlaces.
          </p>
        </>
      )}

      {isLoading ? (
        <p className="muted">Cargando enlaces…</p>
      ) : enlaces.length === 0 ? (
        <p className="muted" style={{ textAlign: 'center', padding: '2rem 0' }}>
          No hay enlaces registrados todavía. Se completan en la primera revisión automática.
        </p>
      ) : enlacesFiltrados.length === 0 ? (
        <p className="muted" role="status" aria-live="polite" style={{ textAlign: 'center', padding: '2rem 0' }}>
          No hay enlaces que coincidan con los filtros.
        </p>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Recinto</th>
                <th>Cantón</th>
                <th>Estado</th>
                <th>Actualizado</th>
              </tr>
            </thead>
            <tbody>
              {enlacesFiltrados.map((e) => (
                <tr key={e.codigoRecinto}>
                  <td style={{ whiteSpace: 'nowrap' }}>{e.codigoRecinto}</td>
                  <td>{e.nombreRecinto}</td>
                  <td>{e.canton || '—'}</td>
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
