import { useState } from 'react';
import { coincideBusqueda } from '@cne/shared-validation';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { AplicarParejasCdaResult, CampoParejaCda, EstadoParejaCda, ParejaCdaFila, PersonaParejaCda, RecintoParejaCda } from '@cne/shared-types';
import { useAuth } from '../../auth/AuthContext';
import { Cargando } from '../../components/Cargando';
import { Modal } from '../../components/Modal';
import { Pestanas } from '../../components/Pestanas';
import { SearchInput } from '../../components/SearchInput';
import {
  aplicarParejasCda,
  descargarPlantillaParejasCda,
  descargarQrParejasCda,
  getDisponiblesParejasCda,
  getFechasParejasCda,
  getParejasCda,
  pedirReporteParejasCda,
  quitarParejaCda,
} from '../../lib/queries/operadores-cda';
import { useDescargaPdf } from '../../lib/useDescargaPdf';
import { ParejaFormModal, cargoPareja } from './ParejaFormModal';
import { CambiarEnParejaModal } from './CambiarEnParejaModal';
import { ImportarParejasModal } from './ImportarParejasModal';
import { CopiarParejasModal } from './CopiarParejasModal';
import { AsignarKitModal } from './AsignarKitModal';
import { ReporteTecnicosModal } from './ReporteTecnicosModal';
import { DispositivoPersona } from './DispositivoPersona';
import { PasarAReservaModal, ReservaParejas } from './ReservaParejas';
import { PersonalSinRecinto } from './PersonalSinRecinto';
import { resumenApp } from './resumenParejas';
import { hoyEcuador, mensajeError } from './utils';

/** Pareja anterior a la regla Operador + Asistente: el cargo real de quien no es el de su columna. */
function CargoDistinto({ persona, columna }: { persona: PersonaParejaCda; columna: 'OPERADOR' | 'ASISTENTE' }) {
  if (persona.grupo === columna) return null;
  return (
    <>
      <br />
      <span className="ocda-estado aviso" title="Pareja anterior a la regla: cada pareja es un Operador y un Asistente CDA">
        {cargoPareja(persona)} · no cumple la regla
      </span>
    </>
  );
}

/** Fila de un CDA que aún no tiene pareja ese día; `onAsignar` solo llega si quien mira puede asignar. */
function FilaRecintoSinPareja({
  recinto,
  numero,
  conAcciones,
  onAsignar,
}: {
  recinto: RecintoParejaCda;
  numero: number;
  conAcciones: boolean;
  onAsignar: (recinto: RecintoParejaCda) => void;
}) {
  return (
    <tr className="ocda-fila-sin-pareja">
      <th scope="row" className="mono ocda-n-recinto" style={{ textAlign: 'center', verticalAlign: 'middle' }}>
        {numero}
      </th>
      <td>
        <span className="muted">Sin operador</span>
      </td>
      <td>
        <span className="muted">Sin asistente</span>
      </td>
      <td>
        <span className="mono">{recinto.codigo}</span> · {recinto.nombre}
      </td>
      <td>
        <span className="muted">—</span>
      </td>
      <td>
        <span className="ocda-estado aviso">Sin pareja</span>
      </td>
      {conAcciones && (
        <td>
          <button
            type="button"
            className="ocda-btn-texto"
            aria-label={`Asignar pareja a ${recinto.codigo} ${recinto.nombre}`}
            onClick={() => onAsignar(recinto)}
          >
            Asignar pareja
          </button>
        </td>
      )}
    </tr>
  );
}

/** Texto y color (clases de .ocda-estado) de cada estado. */
const ESTADO: Record<EstadoParejaCda, { texto: string; clase: string }> = {
  EN_APP: { texto: 'En la app', clase: 'ok' },
  SIN_KIT: { texto: 'Sin kit', clase: 'aviso' },
  PENDIENTE_EVENTO: { texto: 'Sin evento de este día', clase: 'pendiente' },
};

const fechaLarga = (dia: string) =>
  new Date(`${dia}T12:00:00Z`).toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * Parejas Operador CDA + Asistente CDA que van a cada recinto, una lista por
 * día (?dia= en la URL; sin él, el más reciente con lista). La lista pasa a la app solo si el evento ACTIVO es
 * de ese día: el kit del recinto se asigna al operador. Si la jornada ya
 * inició, cada cambio que llega a la app pide justificación (HU12).
 */
export function ParejasPanel() {
  const { user } = useAuth();
  const isAdmin = user?.roles.includes('ADMINISTRADOR') ?? false;
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const diaUrl = /^\d{4}-\d{2}-\d{2}$/.test(params.get('dia') ?? '') ? (params.get('dia') as string) : null;
  const { data: fechas, isFetched: fechasCargadas } = useQuery({ queryKey: ['parejas-cda', 'fechas'], queryFn: getFechasParejasCda });
  // Sin día en la dirección: el más reciente con lista (si no hay ninguna, hoy).
  const dia = diaUrl ?? (fechas?.length ? [...fechas].sort().at(-1)! : hoyEcuador());
  const [agregando, setAgregando] = useState(false);
  const [asignandoRecinto, setAsignandoRecinto] = useState<RecintoParejaCda | null>(null);
  const [soloSinPareja, setSoloSinPareja] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [cambiando, setCambiando] = useState<{ pareja: ParejaCdaFila; campo: CampoParejaCda } | null>(null);
  const [importando, setImportando] = useState(false);
  const [reporteTecnicos, setReporteTecnicos] = useState(false);
  const [copiando, setCopiando] = useState(false);
  const [asignandoKit, setAsignandoKit] = useState<ParejaCdaFila | null>(null);
  const [quitarA, setQuitarA] = useState<ParejaCdaFila | null>(null);
  const [aReserva, setAReserva] = useState<ParejaCdaFila | null>(null);
  const [justificacion, setJustificacion] = useState('');
  // El último paso a la app queda a la vista (los avisos emergentes desaparecen).
  const [resultado, setResultado] = useState<AplicarParejasCdaResult | null>(null);

  const elegirDia = (valor: string) => {
    setResultado(null);
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (valor) p.set('dia', valor);
        else p.delete('dia');
        return p;
      },
      { replace: true },
    );
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ['parejas-cda', dia],
    queryFn: () => getParejasCda(dia),
    enabled: !!diaUrl || fechasCargadas,
  });
  // Personal libre ese día (la misma consulta del formulario); el servidor solo la permite al administrador.
  const { data: disponibles } = useQuery({
    queryKey: ['parejas-cda', 'disponibles', dia, true],
    queryFn: () => getDisponiblesParejasCda(dia, true),
    enabled: isAdmin && !!data,
  });
  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['parejas-cda'] });
    // Quien va en Parejas está convocado: cambian la convocatoria y la asistencia de ese día.
    qc.invalidateQueries({ queryKey: ['convocatoria-cda'] });
    qc.invalidateQueries({ queryKey: ['asistencia-cda'] });
  };
  const congelado = !!data?.congelado;
  const motivo = justificacion.trim() || undefined;

  const mostrarResultado = (r: AplicarParejasCdaResult | null) => {
    setResultado(r);
    if (r) (r.errores.length ? sileo.warning : sileo.success)(resumenApp(r));
  };

  const aplicar = useMutation({
    mutationFn: () => aplicarParejasCda(dia, motivo),
    onSuccess: (r) => {
      refrescar();
      mostrarResultado(r);
    },
    onError: (e) => sileo.error({ title: mensajeError(e, 'No se pudo pasar la lista a la app') }),
  });
  const quitar = useMutation({
    mutationFn: (p: ParejaCdaFila) => quitarParejaCda(p.id, motivo),
    onSuccess: (_, p) => {
      setQuitarA(null);
      refrescar();
      sileo.success({ title: 'Pareja quitada', description: `${p.operador.apellidosNombres} · ${p.recinto.nombre}` });
    },
  });
  const qr = useMutation({
    mutationFn: () => descargarQrParejasCda(dia),
    onError: (e) => sileo.error({ title: mensajeError(e, 'No se pudo descargar el PDF de QR') }),
  });
  const reporte = useDescargaPdf('No se pudo generar el reporte de parejas');
  const descargarReporte = (formato: 'pdf' | 'xlsx') =>
    void reporte.descargar(formato, () => pedirReporteParejasCda(dia, formato), `parejas_cda_${dia}.${formato}`);
  const plantilla = useMutation({
    mutationFn: descargarPlantillaParejasCda,
    onError: (e) => sileo.error({ title: mensajeError(e, 'No se pudo descargar la plantilla') }),
  });

  const parejas = data?.parejas ?? [];
  const reserva = data?.reserva ?? [];
  const sinPareja = data?.recintosSinPareja ?? [];
  // El día tiene lista aunque solo tenga parejas de reserva (salen en el reporte).
  const hayLista = parejas.length + reserva.length > 0;

  /** Botón "Cambiar" de una celda (solo administrador). */
  const botonCambiar = (p: ParejaCdaFila, campo: CampoParejaCda, nombre: string) => {
    if (!isAdmin) return null;
    // Cadena de custodia: quien lleva el kit que ya salió, y el recinto de ese kit, se quedan.
    if (p.kitSalio && (campo === 'RECINTO' || p.quienLleva === campo)) {
      return <div className="muted">{campo === 'RECINTO' ? 'El kit ya salió: no se cambia' : 'Lleva el kit que ya salió: no se cambia'}</div>;
    }
    return (
      <div>
        <button
          type="button"
          className="ocda-btn-texto"
          aria-label={`Cambiar ${nombre} de ${p.operador.apellidosNombres}`}
          title={`Cambiar ${nombre} (si ya lo tiene otra pareja, se intercambian)`}
          onClick={() => setCambiando({ pareja: p, campo })}
        >
          Cambiar
        </button>
      </div>
    );
  };
  const recintos = new Set(parejas.map((p) => p.recinto.id)).size;
  // Buscador: persona (operador o asistente, nombre o cédula), código o nombre del recinto;
  // sin tildes y por palabras en cualquier orden.
  const q = busqueda.trim();
  const visibles = q
    ? parejas.filter((p) =>
        coincideBusqueda(
          [p.operador.apellidosNombres, p.operador.cedula, p.asistente?.apellidosNombres, p.asistente?.cedula, p.recinto.codigo, p.recinto.nombre],
          q,
        ),
      )
    : parejas;
  const sinParejaVisibles = q ? sinPareja.filter((r) => coincideBusqueda([r.codigo, r.nombre], q)) : sinPareja;
  // Si se completó el último vacío, el filtro deja de aplicar (ya no se muestra su casilla).
  const soloVacios = soloSinPareja && sinPareja.length > 0;
  const conKit = parejas.some((p) => p.kitCodigo);
  // N° por recinto, como el Excel: las parejas del mismo recinto forman un bloque.
  const numeroRecinto = new Map<string, number>();
  for (const p of parejas) if (!numeroRecinto.has(p.recinto.id)) numeroRecinto.set(p.recinto.id, numeroRecinto.size + 1);
  // Orden estable por bloque: aunque dos recintos se llamen igual, sus parejas no se mezclan.
  const filas = soloVacios ? [] : [...visibles].sort((a, b) => (numeroRecinto.get(a.recinto.id) ?? 0) - (numeroRecinto.get(b.recinto.id) ?? 0));
  const inicioBloque = (i: number) => i === 0 || filas[i - 1].recinto.id !== filas[i].recinto.id;
  const filasDelBloque = (i: number) => {
    let n = 1;
    while (filas[i + n]?.recinto.id === filas[i].recinto.id) n++;
    return n;
  };
  const resumenTabla = () => {
    if (soloVacios) {
      if (!q) return `${sinPareja.length} recinto(s) sin pareja`;
      return sinParejaVisibles.length
        ? `${sinParejaVisibles.length} de ${sinPareja.length} recinto(s) sin pareja`
        : `Ningún recinto sin pareja coincide con "${q}".`;
    }
    if (q) {
      if (!visibles.length && !sinParejaVisibles.length) return `Ninguna pareja coincide con "${q}".`;
      return `${visibles.length} de ${parejas.length} pareja(s)${sinParejaVisibles.length ? ` · ${sinParejaVisibles.length} sin pareja` : ''}`;
    }
    if (!sinPareja.length) return `${parejas.length} pareja(s) en ${recintos} recinto(s)`;
    return `${parejas.length} pareja(s) en ${recintos} de ${recintos + sinPareja.length} recinto(s) · ${sinPareja.length} sin pareja`;
  };

  return (
    <section aria-labelledby="parejas-titulo">
      <h3 id="parejas-titulo" className="sr-only">
        Parejas por recinto
      </h3>
      <div className="ocda-filtros">
        <label className="ocda-fecha">
          <span>Día</span>
          <input type="date" value={dia} onChange={(e) => elegirDia(e.target.value)} />
        </label>
        {fechas && fechas.length > 0 && (
          <div className="ocda-dias" role="group" aria-label="Días con lista">
            {fechas.map((f) => (
              <button key={f} type="button" className="ocda-chip" aria-pressed={f === dia} onClick={() => elegirDia(f)}>
                {f}
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="ocda-subtitulo" style={{ marginTop: 0 }}>
        Lista del <strong>{fechaLarga(dia)}</strong>
      </p>
      {data && (
        <p className={`banner ${data.evento ? 'info' : 'aviso'}`}>
          {data.evento
            ? `Evento activo de este día: ${data.evento.nombre}. Cada pareja pasa a la app con el kit de su recinto (lo ve el operador).`
            : 'No hay un evento ACTIVO con jornada este día: la lista queda registrada y pasa a la app cuando ese evento esté activo.'}
        </p>
      )}
      {congelado && isAdmin && (
        <div className="banner aviso">
          <p style={{ margin: '0 0 0.5rem' }}>
            <strong>La jornada ya inició: las asignaciones están congeladas.</strong> Para que un cambio llegue a la app escriba
            el motivo; queda en la bitácora.
          </p>
          <ul style={{ margin: '0 0 0.5rem', paddingLeft: '1.1rem' }}>
            <li>Se puede cambiar operador, asistente o recinto con justificación, y dar kit propio a otra pareja del recinto.</li>
            <li>No se puede cambiar a quien lleva un kit que ya salió de la Delegación, ni el recinto de ese kit (cadena de custodia).</li>
          </ul>
          <label className="field" style={{ margin: 0 }}>
            <span>Justificación</span>
            <input value={justificacion} onChange={(e) => setJustificacion(e.target.value)} maxLength={500} autoComplete="off" />
          </label>
        </div>
      )}

      <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', margin: '0.75rem 0 1rem' }}>
        {isAdmin && (
          <>
            <button type="button" className="btn" onClick={() => setAgregando(true)}>
              Agregar pareja
            </button>
            <button type="button" className="btn secondary" onClick={() => setImportando(true)}>
              Cargar plantilla
            </button>
            <button type="button" className="btn secondary" onClick={() => plantilla.mutate()} disabled={plantilla.isPending}>
              Descargar plantilla
            </button>
            {hayLista && (
              <button type="button" className="btn secondary" onClick={() => setCopiando(true)}>
                Copiar a otro día
              </button>
            )}
            <button
              type="button"
              className="btn secondary"
              onClick={() => aplicar.mutate()}
              disabled={!data?.evento || parejas.length === 0 || (congelado && !motivo) || aplicar.isPending}
            >
              {aplicar.isPending ? 'Pasando a la app…' : 'Aplicar a la app'}
            </button>
          </>
        )}
        <button type="button" className="btn secondary" onClick={() => qr.mutate()} disabled={!conKit || qr.isPending}>
          Descargar QR de esta lista
        </button>
        <button
          type="button"
          className="btn secondary"
          onClick={() => descargarReporte('pdf')}
          disabled={!hayLista || !!reporte.descargando}
          aria-busy={reporte.descargando === 'pdf'}
        >
          {reporte.descargando === 'pdf' ? 'Generando…' : 'Reporte PDF'}
        </button>
        <button
          type="button"
          className="btn secondary"
          onClick={() => descargarReporte('xlsx')}
          disabled={!hayLista || !!reporte.descargando}
          aria-busy={reporte.descargando === 'xlsx'}
        >
          {reporte.descargando === 'xlsx' ? 'Generando…' : 'Reporte Excel'}
        </button>
        <button type="button" className="btn secondary" onClick={() => setReporteTecnicos(true)} disabled={parejas.length === 0}>
          Reporte por técnico
        </button>
      </div>
      {reporteTecnicos && <ReporteTecnicosModal dia={dia} onClose={() => setReporteTecnicos(false)} />}

      {resultado && (
        <div className={`banner ${resultado.errores.length ? 'error' : 'success'}`} role={resultado.errores.length ? 'alert' : 'status'}>
          <p style={{ margin: 0 }}>
            <strong>Paso a la app:</strong> {resumenApp(resultado).title}
          </p>
          {resultado.errores.length > 0 && (
            <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem' }}>
              {resultado.errores.map((e) => (
                <li key={e.pareja}>
                  <strong>{e.pareja}:</strong> {e.error}
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="ocda-btn-texto" onClick={() => setResultado(null)}>
            Cerrar resumen
          </button>
        </div>
      )}

      {isLoading && <Cargando />}
      {error && (
        <p className="banner error" role="alert">
          {mensajeError(error, 'No se pudo cargar la lista')}
        </p>
      )}
      {data && !hayLista && sinPareja.length === 0 && (
        <p className="muted">Aún no hay parejas este día.{isAdmin && ' Agréguelas una por una o cargue la plantilla.'}</p>
      )}
      {data && (hayLista || sinPareja.length > 0) && (
        <Pestanas
          pestanas={[
            { id: 'en-recintos', etiqueta: `En recintos (${parejas.length})` },
            { id: 'reserva', etiqueta: `Reserva (${reserva.length})` },
          ]}
          porDefecto="en-recintos"
          etiqueta="Parejas del día"
          parametro="vista"
        >
          {(vista) =>
            vista === 'reserva' ? (
              <>
                <ReservaParejas
                  dia={dia}
                  reserva={reserva}
                  parejas={parejas}
                  isAdmin={isAdmin}
                  congelado={congelado}
                  justificacionInicial={justificacion}
                  onResultado={mostrarResultado}
                />
                {isAdmin && <PersonalSinRecinto dia={dia} />}
              </>
            ) : parejas.length === 0 && sinPareja.length === 0 ? (
              <p className="muted">Ninguna pareja tiene recinto este día. Asígneselo a una de la pestaña Reserva.</p>
            ) : (
              <>
                <div className="ocda-filtros">
                  <span className="ocda-campo" style={{ flex: '1 1 260px', maxWidth: 420 }}>
                    <SearchInput
                      value={busqueda}
                      onChange={setBusqueda}
                      placeholder="Buscar por persona, código o recinto…"
                      ariaLabel="Buscar por persona, código o nombre de recinto"
                    />
                  </span>
                  {sinPareja.length > 0 && (
                    <label className="ocda-check-linea" style={{ margin: 0 }}>
                      <input type="checkbox" checked={soloSinPareja} onChange={(e) => setSoloSinPareja(e.target.checked)} />
                      Solo sin pareja
                    </label>
                  )}
                </div>
                <p className="muted" role="status">
                  {resumenTabla()}
                </p>
                {isAdmin && disponibles && (
                  <p className="muted">
                    Disponibles este día: {disponibles.operadores.length} operador(es) · {disponibles.asistentes.length} asistente(s)
                  </p>
                )}
                <div className="ocda-tabla" tabIndex={0} role="region" aria-label={`Parejas del ${dia}`}>
                  <table>
                    <caption className="sr-only">
                      Parejas del {dia} agrupadas por recinto: operador, asistente, recinto, dispositivo y estado en la app. Los recintos sin
                      pareja van al final.
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">N°</th>
                        <th scope="col">Operador CDA</th>
                        <th scope="col">Asistente CDA</th>
                        <th scope="col">Recinto</th>
                        <th scope="col">Dispositivo</th>
                        <th scope="col">App</th>
                        {isAdmin && <th scope="col">Acciones</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {filas.map((p, i) => (
                        <tr key={p.id} className={inicioBloque(i) ? undefined : 'ocda-fila-bloque'}>
                          {inicioBloque(i) && (
                            <th
                              scope="row"
                              rowSpan={filasDelBloque(i)}
                              className="mono ocda-n-recinto"
                              style={{ textAlign: 'center', verticalAlign: 'middle' }}
                            >
                              {numeroRecinto.get(p.recinto.id)}
                            </th>
                          )}
                          <td>
                            {p.operador.apellidosNombres}
                            <br />
                            <span className="muted mono">{p.operador.cedula}</span>
                            <CargoDistinto persona={p.operador} columna="OPERADOR" />
                            {botonCambiar(p, 'OPERADOR', 'operador')}
                          </td>
                          <td>
                            {p.asistente ? (
                              <>
                                {p.asistente.apellidosNombres}
                                <br />
                                <span className="muted mono">{p.asistente.cedula}</span>
                                <CargoDistinto persona={p.asistente} columna="ASISTENTE" />
                              </>
                            ) : (
                              <span className="muted">Sin asistente</span>
                            )}
                            {botonCambiar(p, 'ASISTENTE', 'asistente')}
                          </td>
                          <td>
                            <span className="mono">{p.recinto.codigo}</span> · {p.recinto.nombre}
                            {p.parejasEnRecinto > 1 && (
                              <span className="ocda-estado aviso" style={{ marginLeft: 6 }} title="Cada pareja lleva su propio kit">
                                {p.parejasEnRecinto} parejas<span className="sr-only">: cada pareja lleva su propio kit</span>
                              </span>
                            )}
                            {botonCambiar(p, 'RECINTO', 'recinto')}
                          </td>
                          <td>
                            <DispositivoPersona rol="Operador" persona={p.operador} editable={isAdmin} />
                            <DispositivoPersona rol="Asistente" persona={p.asistente} editable={isAdmin} />
                            {/* Lleva el kit el de Android de la pareja; si nadie lo tiene, el operador (iPhone). */}
                            {p.portador?.dispositivo === 'IPHONE' && (
                              <span className="ocda-estado aviso">iPhone: la APK no se instala (sin rastreo)</span>
                            )}
                          </td>
                          <td>
                            <span className={`ocda-estado ${ESTADO[p.estado].clase}`}>{ESTADO[p.estado].texto}</span>
                            {p.portador &&
                              (p.estado === 'SIN_KIT' ? (
                                <div className="muted">Nadie lleva el kit · se asignará a {p.portador.apellidosNombres}</div>
                              ) : (
                                <div className="muted">Lleva el kit: {p.portador.apellidosNombres}</div>
                              ))}
                            {p.kitCodigo && <div className="muted mono">{p.kitCodigo}</div>}
                            {isAdmin && p.estado === 'SIN_KIT' && (
                              <div>
                                <button
                                  type="button"
                                  className="ocda-btn-texto"
                                  aria-label={`Asignar kit a ${p.operador.apellidosNombres}`}
                                  onClick={() => setAsignandoKit(p)}
                                >
                                  Asignar kit
                                </button>
                              </div>
                            )}
                          </td>
                          {isAdmin && (
                            <td>
                              <div className="ocda-acciones-fila">
                                {/* Cadena de custodia: el kit que ya salió sigue con su pareja y su recinto. */}
                                {!p.kitSalio && (
                                  <button
                                    type="button"
                                    className="ocda-btn-texto"
                                    aria-label={`Pasar a reserva la pareja de ${p.operador.apellidosNombres}`}
                                    title="Deja el recinto y queda de reserva este día"
                                    onClick={() => setAReserva(p)}
                                  >
                                    Pasar a reserva
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="ocda-btn-texto peligro"
                                  aria-label={`Quitar la pareja de ${p.operador.apellidosNombres}`}
                                  onClick={() => {
                                    quitar.reset();
                                    setQuitarA(p);
                                  }}
                                >
                                  Quitar
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                      {sinParejaVisibles.map((r) => (
                        <FilaRecintoSinPareja
                          key={r.id}
                          recinto={r}
                          numero={numeroRecinto.size + sinPareja.indexOf(r) + 1}
                          conAcciones={isAdmin}
                          onAsignar={setAsignandoRecinto}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
          }
        </Pestanas>
      )}

      {quitarA && (
        <Modal labelledBy="quitar-pareja-titulo" onClose={() => setQuitarA(null)} maxWidth={480}>
          <div className="login-card" style={{ width: '100%', maxWidth: 'none' }} aria-describedby="quitar-pareja-texto">
            <h1 id="quitar-pareja-titulo">Quitar pareja</h1>
            <p id="quitar-pareja-texto">
              ¿Quitar la pareja de {quitarA.operador.apellidosNombres} ({quitarA.recinto.nombre})? Si tenía el kit en la app, el kit
              sigue en su recinto pero sin operador.
              {quitarA.kitSalio && ' Su kit ya salió de la Delegación: no se puede quitar (cadena de custodia).'}
            </p>
            {quitar.isError && (
              <p className="banner error" role="alert">
                {mensajeError(quitar.error, 'No se pudo quitar la pareja')}
              </p>
            )}
            <div className="row" style={{ justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className="btn secondary" onClick={() => setQuitarA(null)} disabled={quitar.isPending}>
                Cancelar
              </button>
              <button type="button" className="btn" onClick={() => quitar.mutate(quitarA)} disabled={quitar.isPending}>
                {quitar.isPending ? 'Quitando…' : 'Sí, quitar'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {aReserva && (
        <PasarAReservaModal pareja={aReserva} congelado={congelado} justificacionInicial={justificacion} onClose={() => setAReserva(null)} />
      )}
      {agregando && (
        <ParejaFormModal dia={dia} pareja={null} congelado={congelado} onResultado={mostrarResultado} onClose={() => setAgregando(false)} />
      )}
      {asignandoRecinto && (
        <ParejaFormModal
          dia={dia}
          pareja={null}
          recintoInicial={asignandoRecinto}
          congelado={congelado}
          onResultado={mostrarResultado}
          onClose={() => setAsignandoRecinto(null)}
        />
      )}
      {cambiando && (
        <CambiarEnParejaModal
          dia={dia}
          pareja={cambiando.pareja}
          campo={cambiando.campo}
          parejas={parejas}
          congelado={congelado}
          justificacionInicial={justificacion}
          onResultado={mostrarResultado}
          onClose={() => setCambiando(null)}
        />
      )}
      {asignandoKit && (
        <AsignarKitModal
          pareja={asignandoKit}
          congelado={congelado}
          justificacionInicial={justificacion}
          onResultado={mostrarResultado}
          onClose={() => setAsignandoKit(null)}
        />
      )}
      {copiando && (
        <CopiarParejasModal
          desde={dia}
          total={parejas.length + reserva.length}
          onVerDia={(d) => {
            setCopiando(false);
            elegirDia(d);
          }}
          onClose={() => setCopiando(false)}
        />
      )}
      {importando && (
        <ImportarParejasModal dia={dia} congelado={congelado} onResultado={mostrarResultado} onClose={() => setImportando(false)} />
      )}
    </section>
  );
}
