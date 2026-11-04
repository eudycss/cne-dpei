import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MAX_FECHAS_HISTORIAL_PAREJAS_CDA, coincideBusqueda } from '@cne/shared-validation';
import type { DispositivoCda, PersonaHistorialCda, RecintoHistorialCda } from '@cne/shared-types';
import { Cargando } from '../../components/Cargando';
import { SearchInput } from '../../components/SearchInput';
import { getFechasParejasCda, getHistorialParejasCda, pedirReporteHistorialParejasCda } from '../../lib/queries/operadores-cda';
import { useDescargaPdf } from '../../lib/useDescargaPdf';
import { Kpi } from './Kpi';
import { PropuestaParejasModal } from './PropuestaParejasModal';
import { useAuth } from '../../auth/AuthContext';
import { useCargosCda } from './grupo';
import { mensajeError } from './utils';

type Vista = 'personal' | 'recintos';
type Estado = '' | 'SI' | 'NO';
type FiltroDispositivo = '' | DispositivoCda | 'SIN';

const CARGO: Record<string, string> = { OPERADOR: 'Operador CDA', ASISTENTE: 'Asistente CDA' };
const DISPOSITIVO: Record<DispositivoCda, string> = { ANDROID: 'Android', IPHONE: 'iPhone' };

const pasaEstado = (estado: Estado, fue: boolean) => !estado || (estado === 'SI') === fue;

/**
 * Historial de parejas: en las fechas elegidas, quién fue (estuvo en una
 * pareja) y quién no, y qué recintos CDA se visitaron, con la pareja y el kit
 * de cada visita. Sirve para armar la siguiente prueba técnica. Solo lectura.
 */
export function HistorialParejasPanel() {
  const { user } = useAuth();
  const isAdmin = user?.roles.includes('ADMINISTRADOR') ?? false;
  const [proponiendo, setProponiendo] = useState(false);
  const { data: conLista } = useQuery({ queryKey: ['parejas-cda', 'fechas'], queryFn: getFechasParejasCda });
  // null = todavía no se tocó: las fechas con lista más recientes (hasta el máximo).
  const [elegidas, setElegidas] = useState<string[] | null>(null);
  const todas = [...(conLista ?? [])].sort();
  const fechas = elegidas ?? todas.slice(-MAX_FECHAS_HISTORIAL_PAREJAS_CDA);
  const [vista, setVista] = useState<Vista>('personal');
  const [busqueda, setBusqueda] = useState('');
  const [cargo, setCargo] = useState('');
  const [dispositivo, setDispositivo] = useState<FiltroDispositivo>('');
  const [canton, setCanton] = useState('');
  const [estado, setEstado] = useState<Estado>('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['parejas-cda', 'historial', fechas],
    queryFn: () => getHistorialParejasCda(fechas),
    enabled: fechas.length > 0,
  });
  const reporte = useDescargaPdf('No se pudo generar el reporte del historial');
  const descargar = (formato: 'pdf' | 'xlsx') =>
    void reporte.descargar(
      formato,
      () => pedirReporteHistorialParejasCda(fechas, formato),
      `historial_parejas_cda_${fechas[0]}_${fechas.at(-1)}.${formato}`,
    );

  const alternarFecha = (f: string) =>
    setElegidas(fechas.includes(f) ? fechas.filter((x) => x !== f) : [...fechas, f].sort());
  const cambiarVista = (v: Vista) => {
    setVista(v);
    setEstado('');
  };

  const personas = data?.personas ?? [];
  const recintos = data?.recintos ?? [];
  const fueron = personas.filter((p) => p.fechas.length > 0).length;
  const visitados = recintos.filter((r) => r.visitas.length > 0).length;
  const cantones = [...new Set(recintos.map((r) => r.canton).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const q = busqueda.trim();

  const personasVisibles = personas.filter(
    (p) =>
      pasaEstado(estado, p.fechas.length > 0) &&
      (!cargo || p.grupo === cargo) &&
      (!dispositivo || (dispositivo === 'SIN' ? !p.dispositivo : p.dispositivo === dispositivo)) &&
      (!q || coincideBusqueda([p.apellidosNombres, p.cedula, ...p.recintos], q)),
  );
  const recintosVisibles = recintos.filter(
    (r) =>
      pasaEstado(estado, r.visitas.length > 0) &&
      (!canton || r.canton === canton) &&
      (!q || coincideBusqueda([r.codigo, r.nombre, ...r.visitas.flatMap((v) => [v.operador, v.asistente, v.kitCodigo])], q)),
  );
  const visibles = vista === 'personal' ? personasVisibles.length : recintosVisibles.length;
  const total = vista === 'personal' ? personas.length : recintos.length;

  return (
    <section aria-labelledby="historial-titulo">
      <h3 id="historial-titulo" className="sr-only">
        Historial de parejas
      </h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Elija las fechas de las pruebas: “fue” es haber estado en una pareja en alguna de ellas.
      </p>
      {conLista && conLista.length === 0 && <p className="muted">Aún no hay listas de parejas.</p>}
      {todas.length > 0 && (
        <div className="ocda-dias" role="group" aria-label="Fechas del historial">
          {todas.map((f) => {
            const activa = fechas.includes(f);
            return (
              <button
                key={f}
                type="button"
                className="ocda-chip"
                aria-pressed={activa}
                disabled={!activa && fechas.length >= MAX_FECHAS_HISTORIAL_PAREJAS_CDA}
                onClick={() => alternarFecha(f)}
              >
                {activa && <span aria-hidden="true">✓ </span>}
                {f}
              </button>
            );
          })}
        </div>
      )}
      {fechas.length >= MAX_FECHAS_HISTORIAL_PAREJAS_CDA && todas.length > fechas.length && (
        <p className="muted">Máximo {MAX_FECHAS_HISTORIAL_PAREJAS_CDA} fechas: quite una para elegir otra.</p>
      )}
      {todas.length > 0 && fechas.length === 0 && (
        <p className="banner error" role="alert">
          Elija al menos una fecha.
        </p>
      )}

      {isLoading && <Cargando />}
      {error && (
        <p className="banner error" role="alert">
          {mensajeError(error, 'No se pudo cargar el historial')}
        </p>
      )}

      {data && fechas.length > 0 && (
        <>
          <div className="ocda-kpis" role="group" aria-label="Resumen del historial">
            <Kpi
              etiqueta="Personal que fue"
              valor={`${fueron} / ${personas.length}`}
              parte={fueron}
              total={personas.length}
              detalle={`${personas.length - fueron} no fue(ron)`}
            />
            <Kpi
              etiqueta="Recintos visitados"
              valor={`${visitados} / ${recintos.length}`}
              parte={visitados}
              total={recintos.length}
              detalle={`${recintos.length - visitados} sin visitar`}
            />
          </div>

          <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', margin: '0.75rem 0' }}>
            <button
              type="button"
              className="btn secondary"
              onClick={() => descargar('pdf')}
              disabled={!!reporte.descargando}
              aria-busy={reporte.descargando === 'pdf'}
            >
              {reporte.descargando === 'pdf' ? 'Generando…' : 'Reporte PDF'}
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => descargar('xlsx')}
              disabled={!!reporte.descargando}
              aria-busy={reporte.descargando === 'xlsx'}
            >
              {reporte.descargando === 'xlsx' ? 'Generando…' : 'Reporte Excel'}
            </button>
            {isAdmin && (
              <button type="button" className="btn" onClick={() => setProponiendo(true)}>
                Propuesta para nueva prueba
              </button>
            )}
          </div>

          <div className="ocda-filtros">
            <div className="ocda-filtros" role="group" aria-label="Ver" style={{ margin: 0 }}>
              {(['personal', 'recintos'] as const).map((v) => (
                <button key={v} type="button" className="ocda-chip" aria-pressed={vista === v} onClick={() => cambiarVista(v)}>
                  {vista === v && <span aria-hidden="true">✓ </span>}
                  {v === 'personal' ? 'Personal' : 'Recintos'}
                </button>
              ))}
            </div>
            <span className="ocda-campo" style={{ flex: '1 1 260px', maxWidth: 360 }}>
              <SearchInput
                value={busqueda}
                onChange={setBusqueda}
                placeholder={vista === 'personal' ? 'Buscar por nombre, cédula o recinto…' : 'Buscar por recinto, código, persona o kit…'}
                ariaLabel={vista === 'personal' ? 'Buscar personal por nombre, cédula o recinto' : 'Buscar recinto por código, nombre, persona o kit'}
              />
            </span>
            <label className="ocda-fecha">
              <span>{vista === 'personal' ? '¿Fue?' : '¿Visitado?'}</span>
              <select value={estado} onChange={(e) => setEstado(e.target.value as Estado)}>
                <option value="">Todos</option>
                <option value="SI">{vista === 'personal' ? 'Fue' : 'Visitado'}</option>
                <option value="NO">{vista === 'personal' ? 'No fue' : 'No visitado'}</option>
              </select>
            </label>
            {vista === 'personal' ? (
              <>
                <label className="ocda-fecha">
                  <span>Cargo</span>
                  <select value={cargo} onChange={(e) => setCargo(e.target.value)}>
                    <option value="">Todos</option>
                    <option value="OPERADOR">Operador CDA</option>
                    <option value="ASISTENTE">Asistente CDA</option>
                  </select>
                </label>
                <label className="ocda-fecha">
                  <span>Dispositivo</span>
                  <select value={dispositivo} onChange={(e) => setDispositivo(e.target.value as FiltroDispositivo)}>
                    <option value="">Todos</option>
                    <option value="ANDROID">Android</option>
                    <option value="IPHONE">iPhone</option>
                    <option value="SIN">Sin registrar</option>
                  </select>
                </label>
              </>
            ) : (
              <label className="ocda-fecha">
                <span>Cantón</span>
                <select value={canton} onChange={(e) => setCanton(e.target.value)}>
                  <option value="">Todos</option>
                  {cantones.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <p className="muted" role="status">
            {visibles === total ? `${total} ${vista === 'personal' ? 'persona(s)' : 'recinto(s)'}` : `${visibles} de ${total}`}
            {visibles === 0 && total > 0 && ' · ninguno coincide con los filtros'}
          </p>

          {vista === 'personal' ? <TablaPersonal personas={personasVisibles} /> : <TablaRecintos recintos={recintosVisibles} />}
          {proponiendo && <PropuestaParejasModal referencia={fechas} recintos={recintos} onClose={() => setProponiendo(false)} />}
        </>
      )}
    </section>
  );
}

function EstadoFue({ si, textoSi, textoNo }: { si: boolean; textoSi: string; textoNo: string }) {
  return <span className={`ocda-estado ${si ? 'ok' : 'aviso'}`}>{si ? textoSi : textoNo}</span>;
}

function TablaPersonal({ personas }: { personas: PersonaHistorialCda[] }) {
  // Quien fue y hoy tiene otro cargo se ve con el nombre de ese cargo.
  const { textos } = useCargosCda();
  if (personas.length === 0) return null;
  return (
    <div className="ocda-tabla" tabIndex={0} role="region" aria-label="Personal del historial">
      <table>
        <caption className="sr-only">Operadores y Asistentes CDA: si fueron en las fechas elegidas, cuándo y a qué recintos</caption>
        <thead>
          <tr>
            <th scope="col">N°</th>
            <th scope="col">Persona</th>
            <th scope="col">Cargo</th>
            <th scope="col">Dispositivo</th>
            <th scope="col">¿Fue?</th>
            <th scope="col">Fechas</th>
            <th scope="col">Recintos</th>
          </tr>
        </thead>
        <tbody>
          {personas.map((p, i) => (
            <tr key={p.id}>
              <td className="mono">{i + 1}</td>
              <th scope="row" style={{ fontWeight: 'normal', textAlign: 'left' }}>
                {p.apellidosNombres}
                <br />
                <span className="muted mono">{p.cedula}</span>
                {!p.activo && (
                  <span className="ocda-estado vacio" style={{ marginLeft: 6 }}>
                    Oculto
                  </span>
                )}
              </th>
              <td>{CARGO[p.grupo] ?? textos(p.grupo).titulo}</td>
              <td>{p.dispositivo ? DISPOSITIVO[p.dispositivo] : <span className="muted">Sin registrar</span>}</td>
              <td>
                <EstadoFue si={p.fechas.length > 0} textoSi="Fue" textoNo="No fue" />
              </td>
              <td className="mono">{p.fechas.join(', ') || '—'}</td>
              <td>{p.recintos.join('; ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TablaRecintos({ recintos }: { recintos: RecintoHistorialCda[] }) {
  if (recintos.length === 0) return null;
  return (
    <div className="ocda-tabla" tabIndex={0} role="region" aria-label="Recintos del historial">
      <table>
        <caption className="sr-only">Recintos CDA: si se visitaron en las fechas elegidas, con la pareja y el kit de cada visita</caption>
        <thead>
          <tr>
            <th scope="col">N°</th>
            <th scope="col">Recinto</th>
            <th scope="col">Cantón</th>
            <th scope="col">¿Visitado?</th>
            <th scope="col">Visitas (pareja y kit)</th>
          </tr>
        </thead>
        <tbody>
          {recintos.map((r, i) => (
            <tr key={r.id}>
              <td className="mono">{i + 1}</td>
              <th scope="row" style={{ fontWeight: 'normal', textAlign: 'left' }}>
                <span className="mono">{r.codigo}</span> · {r.nombre}
              </th>
              <td>{r.canton || '—'}</td>
              <td>
                <EstadoFue si={r.visitas.length > 0} textoSi="Visitado" textoNo="No visitado" />
              </td>
              <td>
                {r.visitas.length === 0 ? (
                  '—'
                ) : (
                  <ul style={{ margin: 0, paddingLeft: '1rem' }}>
                    {r.visitas.map((v, j) => (
                      <li key={`${v.fecha}-${j}`}>
                        <span className="mono">{v.fecha}</span>: {v.operador}
                        {v.asistente ? ` + ${v.asistente}` : ' (sin asistente)'}
                        <span className="muted">
                          {' · '}
                          {v.kitCodigo ? `Kit ${v.kitCodigo}${v.llevaKit ? `, lo lleva ${v.llevaKit}` : ''}` : 'Sin kit'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
