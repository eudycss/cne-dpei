import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TextoAnimado } from '../../components/TextoAnimado';
import { BotonConMotivo } from '../../components/BotonConMotivo';
import type { CdaEstadoDto, OperadorEnRetorno } from '@cne/shared-types';
import { getEstadoCdas, getFotoActa, getFotoMilitar, getOperadoresEnRetorno } from '../../lib/queries/monitoreo';
import { formatearFechaHora } from '../../lib/notifications';
import { MapView, Marker, FitBounds, FlyTo } from '../../components/map';
import { desplazamientosMarcadores, estaSinSenal, formatearDuracion, minutosDesde } from './monitoreo-mapa';
import { ESTADO_INFO, type ConteoEstados } from './estado-info';
import { KpiEstados } from './KpiEstados';
import { FiltroEstado, type FiltroEstadoValor } from './FiltroEstado';
import { IndicadorSync } from './IndicadorSync';

// Marcador de quien dejó de enviar ubicación: gris y sin pulso, para que no se
// confunda con una posición en vivo.
const COLOR_SIN_SENAL = '#6b7280';
const RELOJ_SIN_SENAL_MS = 30_000;
const SIN_OPERADORES: OperadorEnRetorno[] = [];

// Centro aproximado de la provincia de Imbabura (Ibarra) como vista por defecto.
const CENTRO_IMBABURA: [number, number] = [0.35, -78.12];

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
        <MapView center={pos} zoom={14} className="h-[360px] w-full">
          <Marker position={pos}>{cda.operadorNombre}</Marker>
        </MapView>
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

const TITULO_ACTA: Record<'instalacion' | 'escrutinio', string> = {
  instalacion: 'Acta de instalación',
  escrutinio: 'Acta de escrutinio',
};

function FotoActaModal({
  cda,
  tipo,
  onClose,
}: {
  cda: CdaEstadoDto;
  tipo: 'instalacion' | 'escrutinio';
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['foto-acta', cda.recintoId, tipo],
    queryFn: () => getFotoActa(cda.recintoId, tipo),
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
          <h2 style={{ margin: 0 }}>{TITULO_ACTA[tipo]}</h2>
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
            <img src={url} alt={TITULO_ACTA[tipo]} style={{ maxWidth: '100%', maxHeight: 480, borderRadius: 4 }} />
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

  const operadores = data ?? SIN_OPERADORES;
  // Reloj propio: si nadie envía posiciones nuevas, React Query devuelve los
  // mismos datos y no hay re-render, así que "sin señal" nunca aparecería.
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), RELOJ_SIN_SENAL_MS);
    return () => clearInterval(id);
  }, []);
  const desplazamientos = useMemo(() => desplazamientosMarcadores(operadores), [operadores]);

  // Encuadrar solo cuando cambia QUIÉN está en ruta, no en cada refresco de
  // posiciones: si no, el mapa deshace el zoom del usuario cada 10 s.
  const idsEnRuta = operadores.map((o) => o.operadorId).sort().join(',');
  const puntosEncuadre = useMemo<[number, number][]>(
    () => operadores.map((o) => [o.latitud, o.longitud]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [idsEnRuta],
  );

  const [enfoque, setEnfoque] = useState<{ target: [number, number]; nonce: number } | null>(null);
  const enfocar = (lat: number, lng: number) =>
    setEnfoque((prev) => ({ target: [lat, lng], nonce: (prev?.nonce ?? 0) + 1 }));

  const {
    data: cdaData,
    isLoading: cdaLoading,
    isError: cdaError,
    isFetching: cdaActualizando,
    dataUpdatedAt: cdaActualizadoEn,
  } = useQuery({
    queryKey: ['estado-cdas'],
    queryFn: getEstadoCdas,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  const cdas = cdaData ?? [];
  const [cantonFiltro, setCantonFiltro] = useState('');
  const [estadoFiltro, setEstadoFiltro] = useState<FiltroEstadoValor>('TODOS');
  const [verUbicacion, setVerUbicacion] = useState<CdaEstadoDto | null>(null);
  const [verFoto, setVerFoto] = useState<CdaEstadoDto | null>(null);
  const [verActa, setVerActa] = useState<{ cda: CdaEstadoDto; tipo: 'instalacion' | 'escrutinio' } | null>(
    null,
  );

  const cantones = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of cdas) {
      if (c.cantonNombre) map.set(c.cantonId, c.cantonNombre);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [cdas]);

  // Los totales (tarjetas y filtro por estado) respetan el cantón elegido; la
  // tabla además respeta el estado elegido.
  const cdasDelCanton = cantonFiltro
    ? cdas.filter((c) => String(c.cantonId) === cantonFiltro)
    : cdas;
  const cdasFiltrados =
    estadoFiltro === 'TODOS' ? cdasDelCanton : cdasDelCanton.filter((c) => c.estado === estadoFiltro);

  const conteoPorEstado = useMemo(() => {
    const acc: ConteoEstados = {};
    for (const c of cdasDelCanton) acc[c.estado] = (acc[c.estado] ?? 0) + 1;
    return acc;
  }, [cdasDelCanton]);

  return (
    <div>
      <h2>Monitoreo de operadores en ruta</h2>
      <p style={{ opacity: 0.7, marginTop: '-0.5rem' }}>
        Ubicación en tiempo real de tus operadores de CDA, tanto en su trayecto hacia el recinto
        como en su regreso al DPI. Se actualiza automáticamente cada 10 segundos.
      </p>

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'stretch', flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '2 1 520px', minHeight: 480, padding: 0, overflow: 'hidden' }}>
          <MapView center={CENTRO_IMBABURA} zoom={11} pitch={30} className="h-[480px] w-full">
            <FitBounds points={puntosEncuadre} />
            <FlyTo target={enfoque?.target ?? null} nonce={enfoque?.nonce ?? 0} />
            {operadores.map((o) => {
              const sinSenal = estaSinSenal(o.capturadoEn, ahora);
              return (
              <Marker
                key={o.operadorId}
                position={[o.latitud, o.longitud]}
                color={sinSenal ? COLOR_SIN_SENAL : ESTADO_INFO[o.estado].color}
                pulse={!sinSenal}
                offset={desplazamientos.get(o.operadorId)}
              >
                <strong>{o.operadorNombre}</strong>
                <br />
                <span style={{ fontSize: 12, opacity: 0.7 }}>
                  {ESTADO_INFO[o.estado].label} · Última posición: {formatearFechaHora(o.capturadoEn)}
                </span>
                {sinSenal ? (
                  <>
                    <br />
                    <strong style={{ fontSize: 12, color: 'var(--error-text)' }}>
                      Sin señal hace {formatearDuracion(minutosDesde(o.capturadoEn, ahora))}
                    </strong>
                  </>
                ) : null}
                <br />
                <span style={{ fontSize: 12 }}>Kits asignados ({o.kits.length}):</span>
                <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.1rem', fontSize: 12 }}>
                  {o.kits.map((k) => (
                    <li key={k.id}>
                      {k.codigoUnico} — {k.nombre}
                    </li>
                  ))}
                </ul>
              </Marker>
              );
            })}
          </MapView>
        </div>

        <div className="card" style={{ flex: '1 1 280px', minWidth: 260 }}>
          <h3 style={{ marginTop: 0 }}>
            En ruta (<TextoAnimado text={String(operadores.length)} />)
          </h3>
          {operadores.length > 0 ? (
            <p id="monitoreo-ayuda-centrar" style={{ fontSize: 12, opacity: 0.7, margin: '-0.5rem 0 0.25rem' }}>
              Seleccione un operador para centrarlo en el mapa.
            </p>
          ) : null}
          {isLoading ? (
            <p style={{ opacity: 0.7 }}>Cargando…</p>
          ) : isError ? (
            <p style={{ color: '#dc2626' }}>No se pudo cargar el monitoreo.</p>
          ) : operadores.length === 0 ? (
            <p style={{ opacity: 0.7 }}>No hay operadores en tránsito ni en retorno en este momento.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {operadores.map((o) => {
                const sinSenal = estaSinSenal(o.capturadoEn, ahora);
                return (
                <li
                  key={o.operadorId}
                  style={{ padding: '0.6rem 0', borderBottom: '1px solid #e5e7eb' }}
                >
                  <button
                    type="button"
                    onClick={() => enfocar(o.latitud, o.longitud)}
                    aria-describedby="monitoreo-ayuda-centrar"
                    className="monitoreo-operador-btn"
                  >
                  <strong>{o.operadorNombre}</strong>
                  <div style={{ fontSize: 13, opacity: 0.8, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: sinSenal ? COLOR_SIN_SENAL : ESTADO_INFO[o.estado].color,
                        display: 'inline-block',
                      }}
                    />
                    {ESTADO_INFO[o.estado].label} · {o.kits.length} kit{o.kits.length === 1 ? '' : 's'} ·{' '}
                    {formatearFechaHora(o.capturadoEn)}
                  </div>
                  {sinSenal ? (
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--error-text)', marginTop: 2 }}>
                      Sin señal hace {formatearDuracion(minutosDesde(o.capturadoEn, ahora))}
                    </div>
                  ) : null}
                  </button>
                </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="seccion-titulo" style={{ marginTop: '2rem' }}>
        <h2 style={{ margin: 0 }}>Estado de CDAs</h2>
        <IndicadorSync
          actualizadoEn={cdaActualizadoEn}
          actualizando={cdaActualizando}
          error={cdaError}
        />
      </div>
      <p style={{ opacity: 0.7, margin: '0.25rem 0 1rem' }}>
        Estado actual de cada CDA del evento activo. Se actualiza automáticamente cada 10 segundos.
      </p>

      <KpiEstados conteo={conteoPorEstado} total={cdasDelCanton.length} />

      <div className="card">
        <div className="row" style={{ gap: '0.75rem' }}>
          <select
            value={cantonFiltro}
            onChange={(e) => setCantonFiltro(e.target.value)}
            aria-label="Filtrar CDAs por cantón"
          >
            <option value="">Todos los cantones</option>
            {cantones.map(([id, nombre]) => (
              <option key={id} value={id}>{nombre}</option>
            ))}
          </select>
          <FiltroEstado
            valor={estadoFiltro}
            onChange={setEstadoFiltro}
            conteo={conteoPorEstado}
            total={cdasDelCanton.length}
          />
        </div>

        {cdaLoading ? (
          <p className="muted">Cargando…</p>
        ) : cdaError ? (
          <p style={{ color: '#dc2626' }}>No se pudo cargar el estado de los CDAs.</p>
        ) : (
          // Enfocable para poder desplazarla horizontalmente con el teclado.
          <div className="table-scroll" role="region" aria-label="Tabla de estado de CDAs" tabIndex={0}>
          <table className="table-sticky-first">
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
                <th>Acta instalación</th>
                <th>Acta escrutinio</th>
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
                        <TextoAnimado text={info.label} />
                      </span>
                    </td>
                    <td>{c.ubicacion ? formatearFechaHora(c.ubicacion.capturadoEn) : '—'}</td>
                    <td>
                      <BotonConMotivo
                        onClick={() => setVerUbicacion(c)}
                        motivo={c.ubicacion ? null : 'Aún no hay ubicación registrada'}
                      >
                        Ver ubicación
                      </BotonConMotivo>
                    </td>
                    <td>
                      <BotonConMotivo
                        onClick={() => setVerFoto(c)}
                        motivo={c.tieneFotoMilitar ? null : 'El operador aún no subió la foto del militar'}
                      >
                        Ver foto
                      </BotonConMotivo>
                    </td>
                    <td>
                      <BotonConMotivo
                        onClick={() => setVerActa({ cda: c, tipo: 'instalacion' })}
                        motivo={c.tieneActaInstalacion ? null : 'Aún no se subió el acta de instalación'}
                        ariaLabel={`Ver acta de instalación — ${c.nombreRecinto}`}
                      >
                        Ver acta
                      </BotonConMotivo>
                    </td>
                    <td>
                      <BotonConMotivo
                        onClick={() => setVerActa({ cda: c, tipo: 'escrutinio' })}
                        motivo={c.tieneActaEscrutinio ? null : 'Aún no se subió el acta de escrutinio'}
                        ariaLabel={`Ver acta de escrutinio — ${c.nombreRecinto}`}
                      >
                        Ver acta
                      </BotonConMotivo>
                    </td>
                  </tr>
                );
              })}
              {cdasFiltrados.length === 0 && (
                <tr>
                  <td colSpan={10} className="muted" style={{ textAlign: 'center', padding: '1.5rem' }}>
                    {cdas.length === 0
                      ? 'No hay CDAs con operador asignado en el evento activo'
                      : 'Ningún CDA coincide con los filtros elegidos'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {verUbicacion && <UbicacionModal cda={verUbicacion} onClose={() => setVerUbicacion(null)} />}
      {verFoto && <FotoMilitarModal cda={verFoto} onClose={() => setVerFoto(null)} />}
      {verActa && (
        <FotoActaModal cda={verActa.cda} tipo={verActa.tipo} onClose={() => setVerActa(null)} />
      )}
    </div>
  );
}
