import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { EnlaceRecinto } from '@cne/shared-types';
import { getConfigEnlaces, getEnlaces } from '../../lib/queries/enlaces';
import { formatearFechaHora } from '../../lib/notifications';
import { CorreosAvisoModal } from './CorreosAvisoModal';

const ESTADO_COLOR: Record<EnlaceRecinto['estado'], string> = {
  ACTIVO: '#16a34a',
  FALLO: '#ef4444',
};

/** El cron del API revisa la hoja cada 5 min; 15 min sin escribir (3 ciclos perdidos)
 * indica que el servicio está dormido o el cron está fallando. */
const UMBRAL_DESACTUALIZADO_MS = 15 * 60 * 1000;
const INTERVALO_RELOJ_MS = 60_000;

/** Devuelve la última actualización si, respecto a `referencia`, ya pasó el umbral, o null
 * si los datos están al día. Fechas inválidas se ignoran; si ninguna es válida no se puede
 * afirmar que estén vencidos. */
export function ultimaActualizacionVencida(enlaces: EnlaceRecinto[], referencia: number): string | null {
  let ultima: string | null = null;
  let ultimaMs = -Infinity;
  for (const e of enlaces) {
    const ms = Date.parse(e.actualizadoEn);
    if (!Number.isNaN(ms) && ms > ultimaMs) {
      ultimaMs = ms;
      ultima = e.actualizadoEn;
    }
  }
  if (ultima === null) return null;
  return referencia - ultimaMs > UMBRAL_DESACTUALIZADO_MS ? ultima : null;
}

type FiltroEstado = 'TODOS' | EnlaceRecinto['estado'];

const FILTROS: { valor: FiltroEstado; etiqueta: string }[] = [
  { valor: 'TODOS', etiqueta: 'Todos' },
  { valor: 'ACTIVO', etiqueta: 'Activos' },
  { valor: 'FALLO', etiqueta: 'Fallidos' },
];

export function EnlacesPage() {
  const [filtro, setFiltro] = useState<FiltroEstado>('TODOS');
  const [busqueda, setBusqueda] = useState('');
  const [cantonFiltro, setCantonFiltro] = useState('');
  const [mostrarCorreos, setMostrarCorreos] = useState(false);

  const { data: enlaces = [], isLoading, isError, dataUpdatedAt } = useQuery({
    queryKey: ['enlaces'],
    queryFn: getEnlaces,
    refetchInterval: 30_000,
  });

  const { data: config } = useQuery({
    queryKey: ['enlaces-config'],
    queryFn: getConfigEnlaces,
  });

  const cantones = useMemo(() => {
    const set = new Set(enlaces.map((e) => e.canton).filter((c): c is string => !!c));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [enlaces]);

  // La antigüedad se mide contra el momento en que el servidor respondió (dataUpdatedAt), no
  // contra la hora actual: con la pestaña en segundo plano React Query deja de consultar, y al
  // volver los datos viejos en memoria disparaban un falso aviso mientras llegaba el refetch.
  // Si la API no responde, no hay respuesta reciente con la que comparar y se usa el reloj,
  // que avanza aunque los datos no cambien (sin él el aviso no aparecería sin recargar).
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), INTERVALO_RELOJ_MS);
    return () => clearInterval(id);
  }, []);
  const ultimaActualizacion = ultimaActualizacionVencida(enlaces, isError ? ahora : dataUpdatedAt);

  const busquedaNormalizada = busqueda.trim().toLowerCase();

  // Los conteos de cada botón de estado reflejan el cantón y la búsqueda activos,
  // por eso se calculan sobre esta lista y no sobre `enlaces`.
  const enlacesSinFiltroEstado = enlaces
    .filter((e) => !cantonFiltro || e.canton === cantonFiltro)
    .filter(
      (e) =>
        !busquedaNormalizada ||
        e.codigoRecinto.toLowerCase().includes(busquedaNormalizada) ||
        e.nombreRecinto.toLowerCase().includes(busquedaNormalizada),
    );

  const enlacesFiltrados = enlacesSinFiltroEstado.filter((e) => filtro === 'TODOS' || e.estado === filtro);

  const conteos: Record<FiltroEstado, number> = {
    TODOS: enlacesSinFiltroEstado.length,
    ACTIVO: enlacesSinFiltroEstado.filter((e) => e.estado === 'ACTIVO').length,
    FALLO: enlacesSinFiltroEstado.filter((e) => e.estado === 'FALLO').length,
  };

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>Enlaces (CDAs Imbabura)</h2>
        <button className="btn secondary" onClick={() => setMostrarCorreos(true)}>
          Correos de aviso ({(config?.correos ?? []).length})
        </button>
      </div>

      {mostrarCorreos && <CorreosAvisoModal onClose={() => setMostrarCorreos(false)} />}

      {ultimaActualizacion && (
        <div className="banner" role="status">
          <span aria-hidden="true">⚠️ </span>
          Datos sin actualizar desde {formatearFechaHora(ultimaActualizacion)}. La revisión automática de la hoja
          parece detenida: los estados pueden estar desfasados y los avisos por Telegram/correo podrían no estar
          enviándose.
        </div>
      )}

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
