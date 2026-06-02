import 'leaflet/dist/leaflet.css';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { OperadorEnRetorno } from '@cne/shared-types';
import { getOperadoresEnRetorno } from '../../lib/queries/monitoreo';
import { formatearFechaHora } from '../../lib/notifications';

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

export function MonitoreoPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['operadores-en-retorno'],
    queryFn: getOperadoresEnRetorno,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  const operadores = data ?? [];

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
    </div>
  );
}
