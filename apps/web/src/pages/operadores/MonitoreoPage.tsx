import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { CdaEstadoDto, EstadoOperadorCda, OperadorEnRetorno } from '@cne/shared-types';
import { getEstadoCdas, getFotoMilitar, getOperadoresEnRetorno } from '../../lib/queries/monitoreo';
import { formatearFechaHora } from '../../lib/notifications';

const ESTADO_INFO: Record<EstadoOperadorCda, { label: string; color: string }> = {
  EN_DPI: { label: 'En DPI', color: '#9ca3af' },
  EN_TRANSITO: { label: 'En tránsito', color: '#2563eb' },
  EN_RECINTO: { label: 'En el recinto', color: '#f59e0b' },
  EN_RETORNO: { label: 'En retorno', color: '#2563eb' },
  RETORNADO: { label: 'Retornado', color: '#16a34a' },
};

// Centro aproximado de la provincia de Imbabura (Ibarra) como vista por defecto.
const CENTRO_IMBABURA: [number, number] = [0.35, -78.12];

// Icono propio para evitar el problema de rutas de assets del icono por defecto
// de Leaflet bajo bundlers como Vite.
function iconoOperador(): L.DivIcon {
  return L.divIcon({
    className: 'operador-marker',
    html: '<div style="background:#2563eb;width:18px;height:18px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 1px #2563eb"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function AjustarEncuadre({ operadores }: { operadores: OperadorEnRetorno[] }) {
  const map = useMap();
  useEffect(() => {
    if (operadores.length === 0) return;
    const bounds = L.latLngBounds(operadores.map((o) => [o.latitud, o.longitud] as [number, number]));
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
  }, [operadores, map]);
  return null;
}

function UbicacionModal({ cda, onClose }: { cda: CdaEstadoDto; onClose: () => void }) {
  if (!cda.ubicacion) return null;
  const pos: [number, number] = [cda.ubicacion.latitud, cda.ubicacion.longitud];
  const info = ESTADO_INFO[cda.estado];

  return (
    <div
      className="center"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1100, padding: '2rem 0' }}
    >
      <div className="login-card" style={{ maxWidth: 640, width: '100%', padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #e5e7eb' }}>
          <h2 style={{ margin: 0 }}>{cda.nombreRecinto}</h2>
          <p className="muted" style={{ margin: '0.25rem 0 0' }}>
            {cda.operadorNombre} ·{' '}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <span
                style={{ width: 9, height: 9, borderRadius: '50%', background: info.color, display: 'inline-block' }}
              />
              {info.label}
            </span>{' '}
            · {formatearFechaHora(cda.ubicacion.capturadoEn)}
          </p>
        </div>
        <MapContainer center={pos} zoom={14} style={{ height: 360, width: '100%' }} scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Marker position={pos} icon={iconoOperador()}>
            <Popup>{cda.operadorNombre}</Popup>
          </Marker>
        </MapContainer>
        <div className="row" style={{ justifyContent: 'flex-end', padding: '1rem' }}>
          <button className="btn secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

function FotoMilitarModal({ cda, onClose }: { cda: CdaEstadoDto; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['foto-militar', cda.recintoId],
    queryFn: () => getFotoMilitar(cda.recintoId),
  });

  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!data) return;
    const objectUrl = URL.createObjectURL(data);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [data]);

  return (
    <div
      className="center"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1100, padding: '2rem 0' }}
    >
      <div className="login-card" style={{ maxWidth: 480, width: '100%', padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #e5e7eb' }}>
          <h2 style={{ margin: 0 }}>Foto del militar</h2>
          <p className="muted" style={{ margin: '0.25rem 0 0' }}>
            {cda.nombreRecinto} · {cda.operadorNombre}
          </p>
        </div>
        <div
          style={{ padding: '1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 240 }}
        >
          {isLoading ? (
            <p className="muted">Cargando…</p>
          ) : isError ? (
            <p style={{ color: '#dc2626' }}>No se pudo cargar la foto.</p>
          ) : url ? (
            <img src={url} alt="Foto del militar" style={{ maxWidth: '100%', maxHeight: 480, borderRadius: 4 }} />
          ) : null}
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', padding: '1rem' }}>
          <button className="btn secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

export function MonitoreoPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['operadores-en-retorno'],
    queryFn: getOperadoresEnRetorno,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  const operadores = data ?? [];

  const { data: cdaData, isLoading: cdaLoading, isError: cdaError } = useQuery({
    queryKey: ['estado-cdas'],
    queryFn: getEstadoCdas,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  const cdas = cdaData ?? [];
  const [cantonFiltro, setCantonFiltro] = useState('');
  const [verUbicacion, setVerUbicacion] = useState<CdaEstadoDto | null>(null);
  const [verFoto, setVerFoto] = useState<CdaEstadoDto | null>(null);

  const cantones = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of cdas) {
      if (c.cantonNombre) map.set(c.cantonId, c.cantonNombre);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [cdas]);

  const cdasFiltrados = cantonFiltro
    ? cdas.filter((c) => String(c.cantonId) === cantonFiltro)
    : cdas;

  return (
    <div>
      <h2>Monitoreo de operadores en retorno</h2>
      <p style={{ opacity: 0.7, marginTop: '-0.5rem' }}>
        Ubicación en tiempo real de tus operadores de CDA en su trayecto de regreso al DPI.
        Se actualiza automáticamente cada 10 segundos.
      </p>

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'stretch', flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '2 1 520px', minHeight: 480, padding: 0, overflow: 'hidden' }}>
          <MapContainer
            center={CENTRO_IMBABURA}
            zoom={11}
            style={{ height: 480, width: '100%' }}
            scrollWheelZoom
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <AjustarEncuadre operadores={operadores} />
            {operadores.map((o) => (
              <Marker key={o.operadorId} position={[o.latitud, o.longitud]} icon={iconoOperador()}>
                <Popup>
                  <strong>{o.operadorNombre}</strong>
                  <br />
                  <span style={{ fontSize: 12, opacity: 0.7 }}>
                    Última posición: {formatearFechaHora(o.capturadoEn)}
                  </span>
                  <br />
                  <span style={{ fontSize: 12 }}>
                    Kits asignados ({o.kits.length}):
                  </span>
                  <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.1rem', fontSize: 12 }}>
                    {o.kits.map((k) => (
                      <li key={k.id}>
                        {k.codigoUnico} — {k.nombre}
                      </li>
                    ))}
                  </ul>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>

        <div className="card" style={{ flex: '1 1 280px', minWidth: 260 }}>
          <h3 style={{ marginTop: 0 }}>
            En retorno ({operadores.length})
          </h3>
          {isLoading ? (
            <p style={{ opacity: 0.7 }}>Cargando…</p>
          ) : isError ? (
            <p style={{ color: '#dc2626' }}>No se pudo cargar el monitoreo.</p>
          ) : operadores.length === 0 ? (
            <p style={{ opacity: 0.7 }}>No hay operadores en retorno en este momento.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {operadores.map((o) => (
                <li
                  key={o.operadorId}
                  style={{ padding: '0.6rem 0', borderBottom: '1px solid #e5e7eb' }}
                >
                  <strong>{o.operadorNombre}</strong>
                  <div style={{ fontSize: 13, opacity: 0.8 }}>
                    {o.kits.length} kit{o.kits.length === 1 ? '' : 's'} · {formatearFechaHora(o.capturadoEn)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <h2 style={{ marginTop: '2rem' }}>Estado de CDAs</h2>
      <p style={{ opacity: 0.7, marginTop: '-0.5rem' }}>
        Estado actual de cada CDA del evento activo. Se actualiza automáticamente cada 10 segundos.
      </p>
      <div className="card">
        <div className="row">
          <select value={cantonFiltro} onChange={(e) => setCantonFiltro(e.target.value)}>
            <option value="">Todos los cantones</option>
            {cantones.map(([id, nombre]) => (
              <option key={id} value={id}>{nombre}</option>
            ))}
          </select>
        </div>

        {cdaLoading ? (
          <p className="muted">Cargando…</p>
        ) : cdaError ? (
          <p style={{ color: '#dc2626' }}>No se pudo cargar el estado de los CDAs.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Recinto (CDA)</th>
                <th>Cantón</th>
                <th>Operador</th>
                <th>Estado</th>
                <th>Última actualización</th>
                <th>Ubicación</th>
                <th>Foto militar</th>
              </tr>
            </thead>
            <tbody>
              {cdasFiltrados.map((c) => {
                const info = ESTADO_INFO[c.estado];
                return (
                  <tr key={c.recintoId}>
                    <td>{c.codigoRecinto}</td>
                    <td>{c.nombreRecinto}</td>
                    <td>{c.cantonNombre ?? '—'}</td>
                    <td>{c.operadorNombre}</td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            background: info.color,
                            display: 'inline-block',
                          }}
                        />
                        {info.label}
                      </span>
                    </td>
                    <td>{c.ubicacion ? formatearFechaHora(c.ubicacion.capturadoEn) : '—'}</td>
                    <td>
                      <button
                        className="btn secondary"
                        style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                        disabled={!c.ubicacion}
                        onClick={() => setVerUbicacion(c)}
                      >
                        Ver ubicación
                      </button>
                    </td>
                    <td>
                      <button
                        className="btn secondary"
                        style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                        disabled={!c.tieneFotoMilitar}
                        onClick={() => setVerFoto(c)}
                      >
                        Ver foto
                      </button>
                    </td>
                  </tr>
                );
              })}
              {cdasFiltrados.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted" style={{ textAlign: 'center', padding: '1.5rem' }}>
                    No hay CDAs con operador asignado en el evento activo
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {verUbicacion && <UbicacionModal cda={verUbicacion} onClose={() => setVerUbicacion(null)} />}
      {verFoto && <FotoMilitarModal cda={verFoto} onClose={() => setVerFoto(null)} />}
    </div>
  );
}
