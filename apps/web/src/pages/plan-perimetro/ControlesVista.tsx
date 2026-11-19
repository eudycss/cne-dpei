import { Compass, Mountain, RotateCcw, RotateCw } from 'lucide-react';
import { useMapInstance } from '../../components/map';
import { CAPAS_BASE, type CapaBase } from './estiloPlan';

/** Inclinación al pasar a 3D: se ve el relieve sin perder de vista el plan. */
export const PITCH_3D = 60;
const GIRO = 45;

interface ControlesVistaProps {
  capa: CapaBase;
  onCapa: (c: CapaBase) => void;
  vista3d: boolean;
  onVista3d: (v: boolean) => void;
}

/**
 * Controles accesibles del mapa: capa base, 3D y giro. Son la alternativa con
 * teclado/botón a los gestos (dos dedos, clic derecho + arrastre, Ctrl + arrastre).
 */
export function ControlesVista({ capa, onCapa, vista3d, onVista3d }: ControlesVistaProps) {
  const map = useMapInstance();
  const girar = (grados: number) => map.easeTo({ bearing: map.getBearing() + grados, duration: 400 });

  function cambiar3d() {
    const siguiente = !vista3d;
    onVista3d(siguiente);
    map.easeTo({ pitch: siguiente ? PITCH_3D : 0, duration: 600 });
  }

  return (
    <div className="pp-controles" role="group" aria-label="Vista del mapa">
      <fieldset className="pp-capas">
        <legend className="sr-only">Capa del mapa</legend>
        {CAPAS_BASE.map((c) => (
          <label key={c.id} className={capa === c.id ? 'activo' : undefined}>
            <input type="radio" name="pp-capa" value={c.id} checked={capa === c.id} onChange={() => onCapa(c.id)} />
            {c.etiqueta}
          </label>
        ))}
      </fieldset>
      <div className="pp-botones">
        <button type="button" className="pp-btn" aria-pressed={vista3d} onClick={cambiar3d}>
          <Mountain size={16} aria-hidden="true" />
          {vista3d ? 'Vista 3D' : 'Vista plana'}
        </button>
        <button type="button" className="pp-btn" aria-label="Girar a la izquierda" title="Girar a la izquierda" onClick={() => girar(-GIRO)}>
          <RotateCcw size={16} aria-hidden="true" />
        </button>
        <button type="button" className="pp-btn" aria-label="Girar a la derecha" title="Girar a la derecha" onClick={() => girar(GIRO)}>
          <RotateCw size={16} aria-hidden="true" />
        </button>
        <button type="button" className="pp-btn" onClick={() => map.easeTo({ bearing: 0, duration: 400 })}>
          <Compass size={16} aria-hidden="true" />
          Norte arriba
        </button>
      </div>
    </div>
  );
}
