import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import { coincideBusqueda } from '@cne/shared-validation';
import type { ImportParejasCdaResult, PersonaPropuestaCda, PropuestaParejasCda, RecintoHistorialCda } from '@cne/shared-types';
import { Modal } from '../../components/Modal';
import { SearchInput } from '../../components/SearchInput';
import { cargarPropuestaParejasCda, proponerParejasCda } from '../../lib/queries/operadores-cda';
import { resumenApp } from './resumenParejas';
import { VistaPreviaParejas } from './VistaPreviaParejas';
import { mensajeError } from './utils';

type Fila = {
  clave: number;
  recinto: { codigo: string; nombre: string };
  extra: boolean;
  operadorId: string;
  asistenteId: string;
};

const CELULAR = { ANDROID: 'Android', IPHONE: 'iPhone' } as const;

function etiqueta(p: PersonaPropuestaCda): string {
  const cel = p.dispositivo ? CELULAR[p.dispositivo] : 'sin celular registrado';
  return `${p.apellidosNombres} — ${cel}${p.yaFue ? ' · ya fue' : ''}`;
}

let siguienteClave = 1;
const aFilas = (p: PropuestaParejasCda): Fila[] =>
  p.filas.map((f) => ({
    clave: siguienteClave++,
    recinto: { codigo: f.recinto.codigo, nombre: f.recinto.nombre },
    extra: f.extra,
    operadorId: f.operador?.id ?? '',
    asistenteId: f.asistente?.id ?? '',
  }));

/**
 * Propuesta automática para la siguiente prueba técnica, en tres pasos:
 * 1) fecha nueva y recintos que llevan una pareja más; 2) la propuesta
 * (personal que no fue a los recintos no visitados), que se puede cambiar;
 * 3) vista previa con las reglas de la plantilla y guardar.
 */
export function PropuestaParejasModal({
  referencia,
  recintos,
  onClose,
}: {
  referencia: string[];
  recintos: RecintoHistorialCda[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [paso, setPaso] = useState<'datos' | 'editar' | 'revisar'>('datos');
  const [fecha, setFecha] = useState('');
  const [extras, setExtras] = useState<string[]>([]);
  const [buscaRecinto, setBuscaRecinto] = useState('');
  const [propuesta, setPropuesta] = useState<PropuestaParejasCda | null>(null);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [vista, setVista] = useState<ImportParejasCdaResult | null>(null);
  const [pasarAApp, setPasarAApp] = useState(true);
  const [justificacion, setJustificacion] = useState('');
  /** Se guardó con filas que fallaron: queda abierto mostrando cuáles (no se vuelve a guardar). */
  const [guardado, setGuardado] = useState<ImportParejasCdaResult | null>(null);
  // Al cambiar de paso (o quitar una fila) el botón enfocado desaparece: el foco va al título del paso.
  const tituloPaso = useRef<HTMLHeadingElement>(null);
  const montado = useRef(false);
  useEffect(() => {
    if (montado.current) tituloPaso.current?.focus();
    montado.current = true;
  }, [paso]);

  const fechaInvalida = !!fecha && referencia.includes(fecha);
  const personas = propuesta?.personas ?? [];
  const porId = new Map(personas.map((p) => [p.id, p]));
  const cuerpo = () => ({
    filas: filas.map((f) => ({
      cedulaOperador: porId.get(f.operadorId)?.cedula ?? '',
      cedulaAsistente: porId.get(f.asistenteId)?.cedula ?? null,
      codigoRecinto: f.recinto.codigo,
    })),
    justificacion: justificacion.trim() || undefined,
  });

  const generar = useMutation({
    mutationFn: () => proponerParejasCda({ fecha, referencia, extras }),
    onSuccess: (p) => {
      setPropuesta(p);
      setFilas(aFilas(p));
      setPaso('editar');
    },
  });
  const revisar = useMutation({
    mutationFn: () => cargarPropuestaParejasCda(fecha, false, cuerpo()),
    onSuccess: (r) => {
      setVista(r);
      setPaso('revisar');
    },
  });
  const guardar = useMutation({
    mutationFn: () => cargarPropuestaParejasCda(fecha, true, cuerpo(), { app: pasarAApp }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['parejas-cda'] });
      const sinGuardar = r.filas.filter((f) => f.errores.length > 0).length;
      sileo[sinGuardar ? 'warning' : 'success']({
        title: `${r.guardadas} pareja(s) guardada(s) para el ${fecha}${sinGuardar ? `; ${sinGuardar} con error no se guardaron` : ''}`,
        description: r.app ? resumenApp(r.app).title : pasarAApp ? 'Sin evento activo de ese día: quedan registradas.' : 'Quedan registradas sin pasar a la app.',
      });
      if (sinGuardar) {
        setGuardado(r);
        setVista(r);
      } else onClose();
    },
    onError: (e) => sileo.error({ title: mensajeError(e, 'No se pudo guardar la propuesta') }),
  });

  const cambiar = (clave: number, campo: 'operadorId' | 'asistenteId', valor: string) =>
    setFilas((xs) => xs.map((f) => (f.clave === clave ? { ...f, [campo]: valor } : f)));
  const quitar = (clave: number) => {
    setFilas((xs) => xs.filter((f) => f.clave !== clave));
    tituloPaso.current?.focus();
  };
  const otraPareja = (f: Fila) =>
    setFilas((xs) => {
      const i = xs.findIndex((x) => x.clave === f.clave);
      const nueva: Fila = { clave: siguienteClave++, recinto: f.recinto, extra: true, operadorId: '', asistenteId: '' };
      return [...xs.slice(0, i + 1), nueva, ...xs.slice(i + 1)];
    });

  const elegidos = new Set(filas.flatMap((f) => [f.operadorId, f.asistenteId]).filter(Boolean));
  const opciones = (grupo: string, actual: string) =>
    personas.filter((p) => p.grupo === grupo && (p.id === actual || !elegidos.has(p.id)));
  const sinAndroid = (f: Fila) =>
    !!f.operadorId && porId.get(f.operadorId)?.dispositivo !== 'ANDROID' && porId.get(f.asistenteId)?.dispositivo !== 'ANDROID';
  const sinOperador = filas.filter((f) => !f.operadorId).length;
  const conSinAndroid = filas.filter(sinAndroid).length;
  const libres = personas.filter((p) => !p.yaFue && !elegidos.has(p.id));

  const recintosVisibles = buscaRecinto.trim()
    ? recintos.filter((r) => coincideBusqueda([r.codigo, r.nombre, r.canton], buscaRecinto))
    : recintos;
  const conError = vista?.filas.filter((f) => f.errores.length > 0).length ?? 0;
  const validas = (vista?.filas.length ?? 0) - conError;
  const ocupado = generar.isPending || revisar.isPending || guardar.isPending;

  return (
    <Modal labelledBy="propuesta-titulo" onClose={onClose} maxWidth={1080}>
      <div className="login-card" style={{ width: '100%', maxWidth: 'none' }} aria-busy={ocupado}>
        <h1 id="propuesta-titulo">Propuesta para una nueva prueba</h1>
        <p className="muted">
          Referencia: {referencia.join(', ')}. Se propone al personal que no fue en esas fechas, a los recintos que no se
          visitaron: un Operador con un Asistente CDA y, si se puede, al menos uno con Android. Nada se guarda hasta el último paso.
        </p>

        <h2 ref={tituloPaso} tabIndex={-1} style={{ fontSize: '1rem', margin: '0.5rem 0' }}>
          {paso === 'datos' ? 'Paso 1 de 3: fecha y recintos' : paso === 'editar' ? 'Paso 2 de 3: revise y cambie la propuesta' : 'Paso 3 de 3: vista previa y guardar'}
        </h2>

        {paso === 'datos' && (
          <>
            <div className="field">
              <label htmlFor="propuesta-fecha">Fecha de la nueva prueba</label>
              <input
                id="propuesta-fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                aria-invalid={fechaInvalida || undefined}
                aria-describedby={fechaInvalida ? 'propuesta-fecha-error' : 'propuesta-fecha-ayuda'}
              />
              {!fechaInvalida && (
                <p id="propuesta-fecha-ayuda" className="muted" style={{ margin: '0.25rem 0 0' }}>
                  Obligatoria para armar la propuesta.
                </p>
              )}
              {fechaInvalida && (
                <p id="propuesta-fecha-error" className="banner error" role="alert">
                  Elija una fecha distinta de las de referencia.
                </p>
              )}
            </div>
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend>Recintos que llevan una pareja más ({extras.length} marcado(s))</legend>
              <SearchInput
                value={buscaRecinto}
                onChange={setBuscaRecinto}
                placeholder="Buscar recinto por código, nombre o cantón…"
                ariaLabel="Buscar recinto para marcar"
              />
              <div style={{ maxHeight: 220, overflow: 'auto', marginTop: 8 }} tabIndex={0} role="region" aria-label="Recintos para marcar">
                {recintosVisibles.map((r) => (
                  <label key={r.id} className="ocda-check-linea" style={{ margin: '0.25rem 0' }}>
                    <input
                      type="checkbox"
                      checked={extras.includes(r.id)}
                      onChange={(e) => setExtras((xs) => (e.target.checked ? [...xs, r.id] : xs.filter((x) => x !== r.id)))}
                    />
                    <span className="mono">{r.codigo}</span> · {r.nombre}
                    <span className="muted">{r.visitas.length ? ' · visitado' : ' · no visitado'}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {generar.isError && (
              <p className="banner error" role="alert">
                {mensajeError(generar.error, 'No se pudo armar la propuesta')}
              </p>
            )}
          </>
        )}

        {paso === 'editar' && propuesta && (
          <>
            <p role="status">
              <strong>{filas.length}</strong> pareja(s) propuesta(s) para el {fecha}
              {sinOperador > 0 && <> · <strong>{sinOperador}</strong> sin operador (elija a mano)</>}
              {conSinAndroid > 0 && <> · <strong>{conSinAndroid}</strong> sin Android</>} · {libres.length} persona(s) que no
              fueron quedan libres
            </p>
            {filas.length === 0 && <p className="muted">No quedan recintos sin visitar: marque recintos para una pareja más.</p>}
            {filas.length > 0 && (
              <div className="ocda-tabla" style={{ maxHeight: 420, overflow: 'auto' }} tabIndex={0} role="region" aria-label="Propuesta editable">
                <table>
                  <caption className="sr-only">Propuesta de parejas: cambie el operador o el asistente de cada recinto</caption>
                  <thead>
                    <tr>
                      <th scope="col">N°</th>
                      <th scope="col">Recinto</th>
                      <th scope="col">Operador CDA</th>
                      <th scope="col">Asistente CDA</th>
                      <th scope="col">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((f, i) => {
                      const recinto = `${f.recinto.codigo} · ${f.recinto.nombre}`;
                      return (
                        <tr key={f.clave}>
                          <td className="mono">{i + 1}</td>
                          <th scope="row" style={{ fontWeight: 'normal', textAlign: 'left' }}>
                            {recinto}
                            {f.extra && (
                              <span className="ocda-estado pendiente" style={{ marginLeft: 6 }}>
                                Pareja extra
                              </span>
                            )}
                            {sinAndroid(f) && (
                              <span className="ocda-estado error" role="note" style={{ display: 'block', width: 'fit-content', marginTop: 4 }}>
                                Ninguno tiene Android: la APK no se instala
                              </span>
                            )}
                          </th>
                          <td>
                            <select
                              aria-label={`Operador de ${recinto} (fila ${i + 1})`}
                              value={f.operadorId}
                              aria-invalid={!f.operadorId || undefined}
                              aria-describedby={f.operadorId ? undefined : `propuesta-falta-${f.clave}`}
                              onChange={(e) => cambiar(f.clave, 'operadorId', e.target.value)}
                            >
                              <option value="">— Elija un operador —</option>
                              {opciones('OPERADOR', f.operadorId).map((p) => (
                                <option key={p.id} value={p.id}>
                                  {etiqueta(p)}
                                </option>
                              ))}
                            </select>
                            {!f.operadorId && (
                              <span id={`propuesta-falta-${f.clave}`} className="ocda-obs error" style={{ display: 'block' }}>
                                Falta el operador
                              </span>
                            )}
                          </td>
                          <td>
                            <select
                              aria-label={`Asistente de ${recinto} (fila ${i + 1})`}
                              value={f.asistenteId}
                              onChange={(e) => cambiar(f.clave, 'asistenteId', e.target.value)}
                            >
                              <option value="">Sin asistente</option>
                              {opciones('ASISTENTE', f.asistenteId).map((p) => (
                                <option key={p.id} value={p.id}>
                                  {etiqueta(p)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="ocda-fila-acciones">
                            <button type="button" className="ocda-btn-texto" onClick={() => otraPareja(f)} aria-label={`Otra pareja para ${recinto}`}>
                              + Otra pareja
                            </button>
                            <button
                              type="button"
                              className="ocda-btn-texto peligro"
                              onClick={() => quitar(f.clave)}
                              aria-label={`Quitar la fila ${i + 1} (${recinto})`}
                            >
                              Quitar
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {revisar.isError && (
              <p className="banner error" role="alert">
                {mensajeError(revisar.error, 'No se pudo revisar la propuesta')}
              </p>
            )}
          </>
        )}

        {paso === 'revisar' && vista && (
          <>
            {guardado && (
              <p className="banner aviso" role="alert">
                Se guardaron {guardado.guardadas} pareja(s). Las filas con error de abajo no se guardaron: agréguelas desde la pestaña Parejas.
              </p>
            )}
            <VistaPreviaParejas vista={vista} primeraColumna="N°" />
            <label className="ocda-check-linea">
              <input type="checkbox" checked={pasarAApp} onChange={(e) => setPasarAApp(e.target.checked)} />
              Pasar a la app al guardar (si hay evento activo de esa fecha)
            </label>
            {pasarAApp && (
              <div className="field">
                <label htmlFor="propuesta-justificacion">Justificación (solo si la jornada de esa fecha ya inició)</label>
                <input
                  id="propuesta-justificacion"
                  value={justificacion}
                  onChange={(e) => setJustificacion(e.target.value)}
                  maxLength={500}
                  autoComplete="off"
                />
              </div>
            )}
          </>
        )}

        <div className="row" style={{ justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn secondary" onClick={onClose} disabled={guardar.isPending}>
            {guardado ? 'Cerrar' : 'Cancelar'}
          </button>
          {paso !== 'datos' && !guardado && (
            <button
              type="button"
              className="btn secondary"
              onClick={() => setPaso(paso === 'revisar' ? 'editar' : 'datos')}
              disabled={ocupado}
            >
              Volver
            </button>
          )}
          {paso === 'datos' && (
            <button type="button" className="btn" onClick={() => generar.mutate()} disabled={!fecha || fechaInvalida || ocupado}>
              {generar.isPending ? 'Armando…' : 'Armar propuesta'}
            </button>
          )}
          {paso === 'editar' && (
            <button type="button" className="btn" onClick={() => revisar.mutate()} disabled={filas.length === 0 || ocupado}>
              {revisar.isPending ? 'Revisando…' : 'Revisar antes de guardar'}
            </button>
          )}
          {paso === 'revisar' && (
            <button type="button" className="btn" onClick={() => guardar.mutate()} disabled={validas === 0 || ocupado || !!guardado}>
              {guardar.isPending ? 'Guardando…' : `Guardar ${validas} pareja(s)`}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
