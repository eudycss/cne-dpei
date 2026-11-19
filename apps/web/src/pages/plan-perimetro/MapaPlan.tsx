import * as maplibregl from 'maplibre-gl';
import { useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import type { PlanPerimetroDetalle, VistaPerimetro } from '@cne/shared-types';
import { MapView, useMapInstance } from '../../components/map';
import { capaDibujo, capasDelPlan, puntosDelPlan } from './geometria';
import { estiloPlan, type CapaBase } from './estiloPlan';
import { ControlesVista, PITCH_3D } from './ControlesVista';
import { PuestoMarker } from './PuestoMarker';
import { MarcadorArrastrable } from './MarcadorArrastrable';
import { BuscadorLugar } from './BuscadorLugar';
import type { AccionEditor, EstadoEditor, Objetivo } from './editorPlan';

/** Delegación Provincial Electoral de Imbabura: donde abre un plan todavía vacío. */
export const CENTRO_DELEGACION: [number, number] = [0.35849, -78.11886];
const ZOOM_INICIAL = 17;
/** Grados que gira una valla con la tecla R (Shift + R: al revés). */
const GIRO_VALLA = 15;
/** Más vallas que esto no llevan una manija cada una (serían demasiados marcadores): se reparten. */
export const MAX_MANIJAS_VALLAS = 300;

export type SeccionEditor = 'perimetro' | 'puestos' | 'vallas' | 'zonas';

export interface EdicionMapa {
  estado: EstadoEditor;
  despachar: Dispatch<AccionEditor>;
  /** Qué se edita en el mapa: decide qué puntos se pueden arrastrar. */
  seccion: SeccionEditor;
  /** Zona cuyos vértices se editan (sección zonas). */
  zonaId: string | null;
}

interface MapaPlanProps {
  plan: PlanPerimetroDetalle;
  seleccionado: string | null;
  onSeleccionar: (puestoId: string) => void;
  edicion?: EdicionMapa;
  /** La vista actual (centro, zoom, giro, inclinación), para guardarla con el plan. */
  onVista?: (v: VistaPerimetro) => void;
}

export function MapaPlan({ plan, seleccionado, onSeleccionar, edicion, onVista }: MapaPlanProps) {
  const [capa, setCapa] = useState<CapaBase>('satelite-calles');
  // Abre en 3D, como Google Earth, salvo que la vista guardada sea plana.
  const [vista3d, setVista3d] = useState(plan.vista ? plan.vista.pitch > 0 : true);
  const visible = useMemo(() => (edicion ? { ...plan, ...edicion.estado.plan } : plan), [plan, edicion?.estado.plan]);
  const capas = useMemo(() => capasDelPlan(visible), [visible]);
  const dibujo = useMemo(() => capaDibujo(edicion?.estado.puntos ?? []), [edicion?.estado.puntos]);
  const estilo = useMemo(() => estiloPlan(capa, vista3d, capas, dibujo), [capa, vista3d, capas, dibujo]);
  const centro: [number, number] = plan.vista ? [plan.vista.lat, plan.vista.lng] : CENTRO_DELEGACION;
  const despachar = edicion?.despachar;

  return (
    <MapView
      center={centro}
      zoom={plan.vista?.zoom ?? ZOOM_INICIAL}
      pitch={plan.vista?.pitch ?? PITCH_3D}
      maxPitch={85}
      estilo={estilo}
      className="pp-mapa"
    >
      <EncuadreInicial plan={plan} />
      <IrAlPuesto plan={visible} puestoId={seleccionado} />
      {onVista && <InformarVista onVista={onVista} />}
      <PlanoAlEditar editando={!!edicion} vista3d={vista3d} onVista3d={setVista3d} />
      <div className="pp-superior">
        <BuscadorLugar />
        <ControlesVista capa={capa} onCapa={setCapa} vista3d={vista3d} onVista3d={setVista3d} />
      </div>
      {edicion?.estado.dibujo && <ClicsDibujo despachar={edicion.despachar} />}
      {visible.puestos.map((p) => (
        <PuestoMarker
          key={p.id}
          puesto={p}
          seleccionado={p.id === seleccionado}
          mostrarNombre={visible.ajustes.mostrarNombres}
          onSeleccionar={onSeleccionar}
          editable={edicion?.seccion === 'puestos' && !edicion.estado.dibujo}
          onMover={despachar ? (id, punto) => despachar({ tipo: 'moverPuesto', id, punto }) : undefined}
          onQuitar={despachar ? (id) => despachar({ tipo: 'quitarPuesto', id }) : undefined}
        />
      ))}
      {edicion && !edicion.estado.dibujo && <PuntosEditables edicion={edicion} />}
    </MapView>
  );
}

/** Vértices del perímetro o de la zona elegida, y vallas: según la sección que se edita. */
function PuntosEditables({ edicion }: { edicion: EdicionMapa }) {
  const { estado, despachar, seccion, zonaId } = edicion;
  const { plan } = estado;
  if (seccion === 'vallas') {
    if (plan.vallas.length > MAX_MANIJAS_VALLAS) return null;
    return (
      <>
        {plan.vallas.map((v, i) => (
          <MarcadorArrastrable
            key={v.id}
            punto={[v.lat, v.lng]}
            etiqueta={`Valla ${i + 1} (flechas para mover, R para girar, Supr para quitar)`}
            className="pp-manija pp-manija--valla"
            onMover={(punto) => despachar({ tipo: 'moverValla', id: v.id, punto })}
            onQuitar={() => despachar({ tipo: 'quitarValla', id: v.id })}
            onTecla={(e) => {
              if (e.key !== 'r' && e.key !== 'R') return false;
              despachar({ tipo: 'girarValla', id: v.id, grados: e.shiftKey ? -GIRO_VALLA : GIRO_VALLA });
              return true;
            }}
          />
        ))}
      </>
    );
  }
  const zona = seccion === 'zonas' ? plan.zonas.find((z) => z.id === zonaId) : undefined;
  const objetivo: Objetivo | null = seccion === 'perimetro' ? { que: 'perimetro' } : zona ? { que: 'zona', id: zona.id } : null;
  const vertices = seccion === 'perimetro' ? plan.perimetro : zona?.coords;
  if (!objetivo || !vertices) return null;
  const nombre = seccion === 'perimetro' ? 'del perímetro' : `de ${zona!.nombre}`;
  return (
    <>
      {vertices.map((punto, indice) => (
        <MarcadorArrastrable
          // El índice es la identidad del vértice dentro de la figura.
          key={`${seccion}-${zona?.id ?? ''}-${indice}`}
          punto={punto}
          etiqueta={`Vértice ${indice + 1} ${nombre} (flechas para mover, Supr para quitar)`}
          className="pp-manija"
          onArrastrar={(p) => despachar({ tipo: 'moverVertice', objetivo, indice, punto: p, vivo: true })}
          onMover={(p) => despachar({ tipo: 'moverVertice', objetivo, indice, punto: p })}
          onQuitar={vertices.length > 3 ? () => despachar({ tipo: 'quitarVertice', objetivo, indice }) : undefined}
        />
      ))}
    </>
  );
}

/**
 * Mientras se dibuja: cada clic agrega un punto, Enter termina y Esc cancela.
 * El doble clic deja de hacer zoom para no estorbar al marcar puntos seguidos.
 */
function ClicsDibujo({ despachar }: { despachar: Dispatch<AccionEditor> }) {
  const map = useMapInstance();
  useEffect(() => {
    const alClic = (e: maplibregl.MapMouseEvent) => despachar({ tipo: 'agregarPunto', punto: [e.lngLat.lat, e.lngLat.lng] });
    const lienzo = map.getCanvasContainer();
    const alTecla = (e: KeyboardEvent) => {
      // Solo con el foco en el mapa (o en nada): Enter sobre "Cancelar" no debe terminar el dibujo.
      const t = e.target as Node | null;
      if (t && t !== document.body && !lienzo.contains(t)) return;
      if (e.key === 'Enter') despachar({ tipo: 'terminarDibujo' });
      else if (e.key === 'Escape') despachar({ tipo: 'cancelarDibujo' });
    };
    map.on('click', alClic);
    map.doubleClickZoom.disable();
    window.addEventListener('keydown', alTecla);
    lienzo.classList.add('pp-dibujando');
    return () => {
      map.off('click', alClic);
      map.doubleClickZoom.enable();
      window.removeEventListener('keydown', alTecla);
      lienzo.classList.remove('pp-dibujando');
    };
  }, [map, despachar]);
  return null;
}

/** Al editar, el mapa pasa a vista plana (dibujar inclinado es impreciso); al salir vuelve la vista que había. */
function PlanoAlEditar({ editando, vista3d, onVista3d }: { editando: boolean; vista3d: boolean; onVista3d: (v: boolean) => void }) {
  const map = useMapInstance();
  const antes = useRef<{ vista3d: boolean; pitch: number } | null>(null);
  useEffect(() => {
    if (editando && !antes.current) {
      antes.current = { vista3d, pitch: map.getPitch() };
      onVista3d(false);
      map.easeTo({ pitch: 0, duration: 400 });
    } else if (!editando && antes.current) {
      const previo = antes.current;
      antes.current = null;
      onVista3d(previo.vista3d);
      map.easeTo({ pitch: previo.pitch, duration: 400 });
    }
    // Solo reacciona al entrar o salir de la edición.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editando, map]);
  return null;
}

function InformarVista({ onVista }: { onVista: (v: VistaPerimetro) => void }) {
  const map = useMapInstance();
  const alCambiar = useRef(onVista);
  alCambiar.current = onVista;
  useEffect(() => {
    const informar = () => {
      const c = map.getCenter();
      alCambiar.current({ lat: c.lat, lng: c.lng, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() });
    };
    informar();
    map.on('moveend', informar);
    return () => {
      map.off('moveend', informar);
    };
  }, [map]);
  return null;
}

/** Al elegir un puesto (en el mapa o en la lista) el mapa va hacia él, sin animar si se pidió menos movimiento. */
function IrAlPuesto({ plan, puestoId }: { plan: PlanPerimetroDetalle; puestoId: string | null }) {
  const map = useMapInstance();
  useEffect(() => {
    const p = plan.puestos.find((x) => x.id === puestoId);
    if (!p) return;
    const sinMovimiento = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    map.easeTo({ center: [p.lng, p.lat], duration: sinMovimiento ? 0 : 600 });
    // Solo cuando cambia el puesto elegido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, puestoId]);
  return null;
}

/** Al abrir: la vista guardada (con su giro) o, si no hay, encuadra todo lo dibujado. */
function EncuadreInicial({ plan }: { plan: PlanPerimetroDetalle }) {
  const map = useMapInstance();
  useEffect(() => {
    if (plan.vista) {
      map.jumpTo({ bearing: plan.vista.bearing });
      return;
    }
    const puntos = puntosDelPlan(plan);
    if (puntos.length === 0) return;
    const bounds = puntos.reduce(
      (b, [lat, lng]) => b.extend([lng, lat]),
      new maplibregl.LngLatBounds([puntos[0][1], puntos[0][0]], [puntos[0][1], puntos[0][0]]),
    );
    map.fitBounds(bounds, { padding: 60, maxZoom: 19, duration: 0 });
    // Solo al abrir el plan: después manda el usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, plan.id]);
  return null;
}
