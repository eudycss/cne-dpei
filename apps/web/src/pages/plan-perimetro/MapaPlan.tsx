import * as maplibregl from 'maplibre-gl';
import { useEffect, useMemo, useState } from 'react';
import type { PlanPerimetroDetalle } from '@cne/shared-types';
import { MapView, useMapInstance } from '../../components/map';
import { capasDelPlan, puntosDelPlan } from './geometria';
import { estiloPlan, type CapaBase } from './estiloPlan';
import { ControlesVista, PITCH_3D } from './ControlesVista';
import { PuestoMarker } from './PuestoMarker';

/** Delegación Provincial Electoral de Imbabura: donde abre un plan todavía vacío. */
export const CENTRO_DELEGACION: [number, number] = [0.35849, -78.11886];
const ZOOM_INICIAL = 17;

interface MapaPlanProps {
  plan: PlanPerimetroDetalle;
  seleccionado: string | null;
  onSeleccionar: (puestoId: string) => void;
}

export function MapaPlan({ plan, seleccionado, onSeleccionar }: MapaPlanProps) {
  const [capa, setCapa] = useState<CapaBase>('satelite-calles');
  // Abre en 3D, como Google Earth, salvo que la vista guardada sea plana.
  const [vista3d, setVista3d] = useState(plan.vista ? plan.vista.pitch > 0 : true);
  const capas = useMemo(() => capasDelPlan(plan), [plan]);
  const estilo = useMemo(() => estiloPlan(capa, vista3d, capas), [capa, vista3d, capas]);
  const centro: [number, number] = plan.vista ? [plan.vista.lat, plan.vista.lng] : CENTRO_DELEGACION;

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
      <IrAlPuesto plan={plan} puestoId={seleccionado} />
      <ControlesVista capa={capa} onCapa={setCapa} vista3d={vista3d} onVista3d={setVista3d} />
      {plan.puestos.map((p) => (
        <PuestoMarker
          key={p.id}
          puesto={p}
          seleccionado={p.id === seleccionado}
          mostrarNombre={plan.ajustes.mostrarNombres}
          onSeleccionar={onSeleccionar}
        />
      ))}
    </MapView>
  );
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
