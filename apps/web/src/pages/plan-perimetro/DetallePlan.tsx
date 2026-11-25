import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { PlanPerimetroDetalle, VistaPerimetro } from '@cne/shared-types';
import { LIMITES_PERIMETRO, guardarPlanPerimetroSchema } from '@cne/shared-validation';
import {
  clavePlan,
  clavePlanes,
  eliminarPlanPerimetro,
  getPlanPerimetro,
  guardarPlanPerimetro,
} from '../../lib/queries/perimetro';
import { mensajeError } from '../operadores-cda/utils';
import { CENTRO_DELEGACION, MapaPlan } from './MapaPlan';
import { FotoPersona } from './FotoPersona';
import { nombrePuesto } from './PuestoMarker';
import { ZONAS_PERIMETRO } from './geometria';
import { COLOR_PERIMETRO, COLOR_VALLA } from './estiloPlan';
import { cuerpoGuardar, describirAccion, editorReducer, estadoInicial, type AccionEditor, type EstadoEditor } from './editorPlan';
import { EditorPanel, useSeccionEditor } from './EditorPanel';
import type * as maplibregl from 'maplibre-gl';
import { FileSpreadsheetIcon, PrinterIcon, useIconoAnimado } from '../../components/iconos-animados';
import { capturarMapa, descargarExcel, ENCABEZADOS_PUESTOS, filasPuestos, resumenPlan } from './exportarPlan';

const esConflicto = (e: unknown) => (e as { response?: { status?: number } })?.response?.status === 409;
const VACIO = estadoInicial({
  nombre: '',
  perimetro: null,
  zonas: [],
  vallas: [],
  puestos: [],
  ajustes: { pctMujeres: 50, largoValla: 2.5, mostrarNombres: true, alinearVallas: true },
});

interface DetallePlanProps {
  planId: string;
  /** El usuario tiene la acción de editar y el evento admite cambios. */
  editable: boolean;
  onEditando: (editando: boolean) => void;
  onEliminado: () => void;
}

export function DetallePlan({ planId, editable, onEditando, onEliminado }: DetallePlanProps) {
  const qc = useQueryClient();
  const { data: plan, isLoading, isError, refetch } = useQuery({ queryKey: clavePlan(planId), queryFn: () => getPlanPerimetro(planId) });
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  // Reducer a mano (estado + ref): así cada acción se puede anunciar comparando antes y después.
  const [estado, setEstado] = useState<EstadoEditor>(VACIO);
  const estadoRef = useRef(estado);
  const [anuncio, setAnuncio] = useState('');
  const despachar = useCallback((a: AccionEditor) => {
    const antes = estadoRef.current;
    const despues = editorReducer(antes, a);
    estadoRef.current = despues;
    setEstado(despues);
    const texto = describirAccion(a, antes, despues);
    if (texto) setAnuncio(texto);
  }, []);
  const seccion = useSeccionEditor();
  const [zonaId, setZonaId] = useState<string | null>(null);
  const [conflicto, setConflicto] = useState(false);
  const [confirmar, setConfirmar] = useState<'borrar' | 'descartar' | null>(null);
  const vista = useRef<VistaPerimetro | null>(null);
  const mapa = useRef<maplibregl.Map | null>(null);
  /** Imagen del mapa mientras se imprime (undefined = no se está imprimiendo; null = sin imagen). */
  const [impresion, setImpresion] = useState<string | null | undefined>(undefined);
  // Versión e inclinación del plan al entrar a editar: el guardado usa estas, no las de un refetch.
  const base = useRef<{ version: number; pitch: number }>({ version: 0, pitch: 0 });

  // Cambiar de pestaña a mitad de un dibujo lo cancela (sus botones quedarían en otra pestaña).
  useEffect(() => {
    if (estadoRef.current.dibujo) despachar({ tipo: 'cancelarDibujo' });
  }, [seccion, despachar]);

  const pendiente = editando && estado.cambios;

  // Al imprimir solo se ve la hoja del plan (clase en <body>); al terminar se vuelve a la pantalla.
  const [hojaLista, setHojaLista] = useState(false);
  const iconoExcel = useIconoAnimado();
  const iconoImprimir = useIconoAnimado();
  useEffect(() => {
    if (impresion === undefined || !hojaLista) return;
    document.body.classList.add('pp-imprimiendo');
    const terminar = () => {
      setImpresion(undefined);
      setHojaLista(false);
    };
    window.addEventListener('afterprint', terminar);
    window.print();
    // Respaldo: algunos navegadores (móviles) no avisan con afterprint.
    const respaldo = setTimeout(terminar, 1000);
    return () => {
      clearTimeout(respaldo);
      window.removeEventListener('afterprint', terminar);
      document.body.classList.remove('pp-imprimiendo');
    };
  }, [impresion, hojaLista]);

  async function imprimir() {
    const imagen = mapa.current ? await capturarMapa(mapa.current) : null;
    if (!imagen) sileo.error({ title: 'No se pudo incluir el mapa; se imprime solo la lista' });
    setImpresion(imagen);
  }
  // Avisar antes de cerrar o recargar la pestaña con cambios sin guardar.
  useEffect(() => {
    if (!pendiente) return;
    const avisar = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ''; // navegadores viejos
    };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [pendiente]);

  // Ctrl+Z / Cmd+Z deshace mientras se edita (no dentro de un campo de texto: ahí deshace el texto).
  useEffect(() => {
    if (!editando) return;
    const alTecla = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        despachar({ tipo: 'deshacer' });
      }
    };
    window.addEventListener('keydown', alTecla);
    return () => window.removeEventListener('keydown', alTecla);
  }, [editando, despachar]);

  function entrar(p: PlanPerimetroDetalle) {
    despachar({ tipo: 'reiniciar', plan: p });
    base.current = { version: p.version, pitch: vista.current?.pitch ?? p.vista?.pitch ?? 0 };
    setAnuncio('Editando el plan');
    setConflicto(false);
    setEditando(true);
    onEditando(true);
  }
  function salir() {
    setEditando(false);
    setZonaId(null);
    setConfirmar(null);
    onEditando(false);
  }

  const guardar = useMutation({
    mutationFn: async () => {
      // Se guarda la vista actual pero con la inclinación de antes de editar (editar pone el mapa plano).
      const v = vista.current ? { ...vista.current, pitch: base.current.pitch } : null;
      const cuerpo = guardarPlanPerimetroSchema.safeParse(cuerpoGuardar({ ...estadoRef.current.plan, lugar: plan!.lugar }, v, base.current.version));
      if (!cuerpo.success) throw new Error(cuerpo.error.issues[0]?.message ?? 'Revise los datos del plan');
      return guardarPlanPerimetro(planId, cuerpo.data);
    },
    onSuccess: (guardado) => {
      qc.setQueryData(clavePlan(planId), guardado);
      void qc.invalidateQueries({ queryKey: clavePlanes(guardado.eventoId) });
      salir();
      sileo.success({ title: 'Plan guardado' });
    },
    onError: (e) => {
      if (esConflicto(e)) setConflicto(true);
      else if (e instanceof Error && !('response' in e) && !('isAxiosError' in e)) sileo.error({ title: e.message });
      else sileo.error({ title: mensajeError(e, 'No se pudo guardar el plan. Revise su conexión e intente de nuevo.') });
    },
  });

  const borrar = useMutation({
    mutationFn: () => eliminarPlanPerimetro(planId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: clavePlanes(plan!.eventoId) });
      qc.removeQueries({ queryKey: clavePlan(planId) });
      salir();
      onEliminado();
      sileo.success({ title: 'Plan borrado' });
    },
    onError: (e) => sileo.error({ title: mensajeError(e, 'No se pudo borrar el plan') }),
  });

  async function recargar() {
    const { data } = await refetch();
    setConflicto(false);
    if (data) {
      despachar({ tipo: 'reiniciar', plan: data });
      base.current = { ...base.current, version: data.version };
    }
  }

  if (isLoading) return <p className="ocda-subtitulo">Cargando el plan…</p>;
  if (isError || !plan) return <div className="banner error">No se pudo cargar el plan.</div>;

  const centro = (): [number, number] => (vista.current ? [vista.current.lat, vista.current.lng] : plan.vista ? [plan.vista.lat, plan.vista.lng] : CENTRO_DELEGACION);
  const puesto = !editando ? (plan.puestos.find((p) => p.id === seleccionado) ?? null) : null;

  return (
    <>
      {plan.avisos.length > 0 && (
        <div className="banner" role="status">
          <ul className="pp-avisos">
            {plan.avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      {conflicto && (
        <div className="banner error" role="alert">
          Otra persona guardó este plan mientras usted lo editaba. Al recargar verá sus cambios y se perderán los suyos.{' '}
          <button type="button" className="btn secondary ocda-btn-chico" onClick={() => void recargar()}>
            Recargar el plan
          </button>
        </div>
      )}
      {!editando && (
        <div className="pp-barra-edicion">
          {editable && (
            <button type="button" className="btn" onClick={() => entrar(plan)}>
              Editar plan
            </button>
          )}
          <button type="button" className="btn secondary" disabled={plan.puestos.length === 0} onClick={() => descargarExcel(plan)} {...iconoExcel.disparadores}>
            <FileSpreadsheetIcon ref={iconoExcel.ref} size={16} aria-hidden="true" /> Descargar Excel
          </button>
          <button type="button" className="btn secondary" onClick={() => void imprimir()} {...iconoImprimir.disparadores}>
            <PrinterIcon ref={iconoImprimir.ref} size={16} aria-hidden="true" /> Imprimir
          </button>
        </div>
      )}
      {editando && (
        <div className="pp-barra-edicion" role="region" aria-label="Edición del plan">
          <label className="ocda-campo pp-nombre-plan">
            <span className="sr-only">Nombre del plan</span>
            <input
              value={estado.plan.nombre}
              maxLength={LIMITES_PERIMETRO.maxNombrePlan}
              onChange={(e) => despachar({ tipo: 'nombre', nombre: e.target.value })}
            />
          </label>
          <span className="pp-estado-cambios" aria-live="polite">
            {estado.cambios ? 'Cambios sin guardar' : 'Sin cambios'}
          </span>
          <button
            type="button"
            className="btn"
            disabled={!estado.cambios || guardar.isPending || conflicto || !!estado.dibujo || !estado.plan.nombre.trim()}
            onClick={() => guardar.mutate()}
          >
            {guardar.isPending ? 'Guardando…' : 'Guardar'}
          </button>
          <button
            type="button"
            className="btn secondary"
            disabled={estado.historial.length === 0}
            aria-keyshortcuts="Control+Z"
            onClick={() => despachar({ tipo: 'deshacer' })}
          >
            Deshacer
          </button>
          {confirmar === 'descartar' ? (
            <span className="pp-confirmar" role="alert">
              ¿Descartar los cambios sin guardar?
              <button type="button" className="btn pp-btn-peligro ocda-btn-chico" onClick={salir}>
                Sí, descartar
              </button>
              <button type="button" className="btn secondary ocda-btn-chico" autoFocus onClick={() => setConfirmar(null)}>
                No
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="btn secondary"
              disabled={guardar.isPending}
              onClick={() => (estado.cambios ? setConfirmar('descartar') : salir())}
            >
              {estado.cambios ? 'Descartar cambios' : 'Salir de la edición'}
            </button>
          )}
          {confirmar === 'borrar' ? (
            <span className="pp-confirmar" role="alert">
              ¿Borrar el plan y sus {plan.puestos.length} puestos?
              <button type="button" className="btn pp-btn-peligro ocda-btn-chico" disabled={borrar.isPending} onClick={() => borrar.mutate()}>
                Sí, borrar
              </button>
              <button type="button" className="btn secondary ocda-btn-chico" autoFocus onClick={() => setConfirmar(null)}>
                No
              </button>
            </span>
          ) : (
            <button type="button" className="btn secondary pp-btn-peligro-borde" onClick={() => setConfirmar('borrar')}>
              Borrar plan
            </button>
          )}
          <p className="sr-only" role="status" aria-live="polite">
            {anuncio}
          </p>
        </div>
      )}
      <div className="pp-cuerpo">
        <section className="pp-mapa-marco" aria-label={`Mapa del plan ${plan.nombre}`}>
          <MapaPlan
            plan={plan}
            seleccionado={seleccionado}
            onSeleccionar={setSeleccionado}
            onVista={(v) => (vista.current = v)}
            onMapa={(m) => (mapa.current = m)}
            edicion={editando ? { estado, despachar, seccion, zonaId } : undefined}
          />
          <Leyenda />
        </section>
        <aside className="pp-panel" aria-label={editando ? 'Editor del plan' : 'Puestos del plan'}>
          {editando ? (
            <EditorPanel planId={plan.id} estado={estado} despachar={despachar} zonaId={zonaId} onZona={setZonaId} centro={centro} />
          ) : (
            <>
              {puesto && <TarjetaPuesto plan={plan} puestoId={puesto.id} onCerrar={() => setSeleccionado(null)} />}
              <h3 className="pp-panel-titulo">
                Puestos <span className="pp-contador">{plan.puestos.length}</span>
              </h3>
              {plan.puestos.length === 0 ? (
                <p className="ocda-subtitulo">Aún no hay puestos en este plan.</p>
              ) : (
                <ol className="pp-lista">
                  {plan.puestos.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className={p.id === seleccionado ? 'activo' : undefined}
                        aria-pressed={p.id === seleccionado}
                        onClick={() => setSeleccionado(p.id)}
                      >
                        <span className="pp-puesto-numero">{p.orden}</span>
                        <span className={p.persona ? undefined : 'pp-sin-persona'}>{nombrePuesto(p)}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </aside>
      </div>
      {/* En <body>: así ningún contenedor de la página la corre o la recorta al imprimir. */}
      {impresion !== undefined && createPortal(<HojaImpresion plan={plan} imagen={impresion} onLista={() => setHojaLista(true)} />, document.body)}
    </>
  );
}

/** Hoja para imprimir: nombre, resumen, imagen del mapa y la lista de puestos (sin datos personales de más). */
function HojaImpresion({ plan, imagen, onLista }: { plan: PlanPerimetroDetalle; imagen: string | null; onLista: () => void }) {
  // Se imprime cuando la imagen del mapa ya está cargada (o enseguida si no hay).
  useEffect(() => {
    if (!imagen) onLista();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <section className="pp-impresion" aria-hidden="true">
      <h1>{plan.nombre}</h1>
      {plan.lugar && <p>{plan.lugar}</p>}
      <p>{resumenPlan(plan)}</p>
      {imagen && <img src={imagen} alt="" onLoad={onLista} onError={onLista} />}
      <table>
        <thead>
          <tr>
            {ENCABEZADOS_PUESTOS.slice(0, 4).map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filasPuestos(plan, { seguro: false }).map((f) => (
            <tr key={String(f[0])}>
              {f.slice(0, 4).map((c, i) => (
                <td key={i}>{String(c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pp-impresion-pie">Impreso el {new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })}</p>
    </section>
  );
}

function TarjetaPuesto({ plan, puestoId, onCerrar }: { plan: PlanPerimetroDetalle; puestoId: string; onCerrar: () => void }) {
  const p = plan.puestos.find((x) => x.id === puestoId)!;
  const nombre = nombrePuesto(p);
  return (
    <div className="pp-tarjeta" role="region" aria-label={`Puesto ${p.orden}`}>
      {p.persona?.tieneFoto ? <FotoPersona key={p.persona.id} planId={plan.id} operadorId={p.persona.id} nombre={nombre} /> : null}
      <div>
        <p className="pp-tarjeta-puesto">Puesto {p.orden}</p>
        <p className="pp-tarjeta-nombre">{nombre}</p>
      </div>
      <button type="button" className="btn secondary ocda-btn-chico" onClick={onCerrar}>
        Cerrar
      </button>
    </div>
  );
}

function Leyenda() {
  return (
    <ul className="pp-leyenda" aria-label="Leyenda">
      <li>
        <i style={{ borderColor: COLOR_PERIMETRO }} className="pp-leyenda-borde" aria-hidden="true" />
        Perímetro
      </li>
      <li>
        <i style={{ background: COLOR_VALLA }} aria-hidden="true" />
        Valla
      </li>
      {Object.entries(ZONAS_PERIMETRO).map(([id, z]) => (
        <li key={id}>
          <i style={{ background: z.color }} aria-hidden="true" />
          {z.etiqueta}
        </li>
      ))}
    </ul>
  );
}
