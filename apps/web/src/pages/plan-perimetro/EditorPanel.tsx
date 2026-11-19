import { useState, type Dispatch } from 'react';
import { useSearchParams } from 'react-router';
import { Trash2 } from 'lucide-react';
import type { TipoZonaPerimetro } from '@cne/shared-types';
import { LIMITES_PERIMETRO } from '@cne/shared-validation';
import { Pestanas } from '../../components/Pestanas';
import { areaAnillo, longitudAnillo, ZONAS_PERIMETRO } from './geometria';
import { puestosConPersona, type AccionEditor, type Dibujo, type EstadoEditor } from './editorPlan';
import { MAX_MANIJAS_VALLAS, type SeccionEditor } from './MapaPlan';
import { nombrePuesto } from './PuestoMarker';

const PARAMETRO = 'editar';
const SECCIONES: { id: SeccionEditor; etiqueta: string }[] = [
  { id: 'perimetro', etiqueta: 'Perímetro' },
  { id: 'puestos', etiqueta: 'Puestos' },
  { id: 'vallas', etiqueta: 'Vallas' },
  { id: 'zonas', etiqueta: 'Zonas' },
];

/** Número entero escrito en el campo; vacío o con letras no vale (Number('') sería 0). */
const entero = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s) : Number.NaN);

const metros = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
const metros2 = (m: number) => (m >= 10000 ? `${(m / 10000).toFixed(2)} ha` : `${Math.round(m)} m²`);

/** Sección abierta del editor: la guarda Pestanas en la URL (?editar=). */
export function useSeccionEditor(): SeccionEditor {
  const [params] = useSearchParams();
  const pedida = params.get(PARAMETRO);
  return SECCIONES.find((s) => s.id === pedida)?.id ?? 'perimetro';
}

interface EditorPanelProps {
  estado: EstadoEditor;
  despachar: Dispatch<AccionEditor>;
  zonaId: string | null;
  onZona: (id: string | null) => void;
  /** Centro actual del mapa: alternativa al clic para quien usa teclado. */
  centro: () => [number, number];
}

export function EditorPanel({ estado, despachar, zonaId, onZona, centro }: EditorPanelProps) {
  return (
    <Pestanas pestanas={SECCIONES} porDefecto="perimetro" etiqueta="Qué editar" parametro={PARAMETRO}>
      {(seccion) => (
        <div className="pp-editor-seccion">
          {seccion === 'perimetro' && <Perimetro estado={estado} despachar={despachar} centro={centro} />}
          {seccion === 'puestos' && <Puestos estado={estado} despachar={despachar} centro={centro} />}
          {seccion === 'vallas' && <Vallas estado={estado} despachar={despachar} />}
          {seccion === 'zonas' && <Zonas estado={estado} despachar={despachar} centro={centro} zonaId={zonaId} onZona={onZona} />}
        </div>
      )}
    </Pestanas>
  );
}

type PropsSeccion = { estado: EstadoEditor; despachar: Dispatch<AccionEditor> };

/** Barra mientras se dibuja un polígono: puntos, deshacer, terminar, cancelar. */
function BarraDibujo({ estado, despachar, centro, que }: PropsSeccion & { centro: () => [number, number]; que: string }) {
  const n = estado.puntos.length;
  return (
    <div className="pp-dibujo" role="status">
      <p>
        Dibujando {que}: haga clic en el mapa para marcar cada esquina. <strong>{n}</strong> {n === 1 ? 'punto' : 'puntos'}.
        Enter termina, Esc cancela.
      </p>
      <div className="pp-fila-botones">
        <button type="button" className="btn secondary ocda-btn-chico" onClick={() => despachar({ tipo: 'agregarPunto', punto: centro() })}>
          Punto en el centro del mapa
        </button>
        <button type="button" className="btn secondary ocda-btn-chico" disabled={n === 0} onClick={() => despachar({ tipo: 'deshacerPunto' })}>
          Deshacer punto
        </button>
        <button type="button" className="btn ocda-btn-chico" disabled={n < 3} onClick={() => despachar({ tipo: 'terminarDibujo' })}>
          Terminar
        </button>
        <button type="button" className="btn secondary ocda-btn-chico" onClick={() => despachar({ tipo: 'cancelarDibujo' })}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

const dibujando = (estado: EstadoEditor, d: Dibujo['que']) => estado.dibujo?.que === d;

function Perimetro({ estado, despachar, centro }: PropsSeccion & { centro: () => [number, number] }) {
  const { perimetro } = estado.plan;
  if (dibujando(estado, 'perimetro')) return <BarraDibujo estado={estado} despachar={despachar} centro={centro} que="el perímetro" />;
  const empezar = () => despachar({ tipo: 'empezarDibujo', dibujo: { que: 'perimetro' } });
  if (!perimetro) {
    return (
      <>
        <p className="pp-ayuda">Marque el contorno del lugar: cada clic en el mapa es una esquina.</p>
        <button type="button" className="btn" onClick={empezar} disabled={!!estado.dibujo}>
          Dibujar perímetro
        </button>
      </>
    );
  }
  return (
    <>
      <p className="pp-dato">
        Largo <strong>{metros(longitudAnillo(perimetro))}</strong> · Área <strong>{metros2(areaAnillo(perimetro))}</strong> ·{' '}
        {perimetro.length} esquinas
      </p>
      <p className="pp-ayuda">Arrastre las esquinas, o enfóquelas con Tab y muévalas con las flechas (Shift: 5 m). Supr quita una esquina.</p>
      <div className="pp-fila-botones">
        <button type="button" className="btn secondary ocda-btn-chico" onClick={empezar} disabled={!!estado.dibujo}>
          Volver a dibujar
        </button>
        <button type="button" className="btn secondary ocda-btn-chico" onClick={() => despachar({ tipo: 'borrarPerimetro' })}>
          Borrar perímetro
        </button>
      </div>
    </>
  );
}

function Puestos({ estado, despachar, centro }: PropsSeccion & { centro: () => [number, number] }) {
  const { plan } = estado;
  const [total, setTotal] = useState(String(plan.puestos.length || 10));
  const minimo = puestosConPersona(plan);
  const n = entero(total);
  const valido = Number.isInteger(n) && n >= Math.max(1, minimo) && n <= LIMITES_PERIMETRO.maxPuestos;
  const colocando = dibujando(estado, 'puesto');
  return (
    <>
      <div className="pp-fila-campos">
        <label className="ocda-cargo">
          Total de puestos
          <input type="number" min={minimo} max={LIMITES_PERIMETRO.maxPuestos} value={total} onChange={(e) => setTotal(e.target.value)} />
        </label>
        <button
          type="button"
          className="btn ocda-btn-chico"
          disabled={!plan.perimetro || !valido || !!estado.dibujo}
          onClick={() => despachar({ tipo: 'repartirPuestos', total: n })}
        >
          Repartir en el perímetro
        </button>
      </div>
      {!plan.perimetro && <p className="pp-ayuda">Para repartir, primero dibuje el perímetro.</p>}
      {minimo > 0 && <p className="pp-ayuda">{minimo} puestos tienen persona: no se quitan al repartir.</p>}
      <div className="pp-fila-botones">
        <button
          type="button"
          className="btn secondary ocda-btn-chico"
          aria-pressed={colocando}
          disabled={!!estado.dibujo && !colocando}
          onClick={() => despachar(colocando ? { tipo: 'cancelarDibujo' } : { tipo: 'empezarDibujo', dibujo: { que: 'puesto' } })}
        >
          {colocando ? 'Listo, dejar de colocar' : 'Colocar con clics en el mapa'}
        </button>
        <button
          type="button"
          className="btn secondary ocda-btn-chico"
          disabled={!!estado.dibujo && !colocando}
          onClick={() => despachar({ tipo: 'agregarPuesto', punto: centro() })}
        >
          Puesto en el centro del mapa
        </button>
      </div>
      <label className="pp-check">
        <input
          type="checkbox"
          checked={plan.ajustes.mostrarNombres}
          onChange={(e) => despachar({ tipo: 'ajustes', ajustes: { mostrarNombres: e.target.checked } })}
        />
        Mostrar nombres en el mapa
      </label>
      <p className="pp-ayuda">Arrastre los puestos, o enfóquelos con Tab y muévalos con las flechas. Supr quita un puesto.</p>
      {plan.puestos.length > 0 && (
        <ol className="pp-lista pp-lista--edicion">
          {plan.puestos.map((p) => (
            <li key={p.id}>
              <span className="pp-puesto-numero">{p.orden}</span>
              {p.persona ? (
                <span className="pp-lista-nombre">{nombrePuesto(p)}</span>
              ) : (
                <input
                  aria-label={`Nombre libre del puesto ${p.orden}`}
                  placeholder="Sin asignar"
                  maxLength={LIMITES_PERIMETRO.maxNombre}
                  value={p.etiqueta ?? ''}
                  onChange={(e) => despachar({ tipo: 'etiquetaPuesto', id: p.id, etiqueta: e.target.value })}
                />
              )}
              <button type="button" className="pp-btn" aria-label={`Quitar el puesto ${p.orden}`} onClick={() => despachar({ tipo: 'quitarPuesto', id: p.id })}>
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

function Vallas({ estado, despachar }: PropsSeccion) {
  const { plan } = estado;
  const [total, setTotal] = useState(String(plan.vallas.length || 20));
  const n = entero(total);
  const valido = Number.isInteger(n) && n >= 1 && n <= LIMITES_PERIMETRO.maxVallas;
  return (
    <>
      <div className="pp-fila-campos">
        <label className="ocda-cargo">
          Total de vallas
          <input type="number" min={0} max={LIMITES_PERIMETRO.maxVallas} value={total} onChange={(e) => setTotal(e.target.value)} />
        </label>
        <label className="ocda-cargo">
          Largo de cada una (m)
          <input
            type="number"
            min={LIMITES_PERIMETRO.minLargoValla}
            max={LIMITES_PERIMETRO.maxLargoValla}
            step={0.5}
            value={plan.ajustes.largoValla}
            onChange={(e) => {
              const largo = Number(e.target.value);
              if (largo >= LIMITES_PERIMETRO.minLargoValla && largo <= LIMITES_PERIMETRO.maxLargoValla) {
                despachar({ tipo: 'ajustes', ajustes: { largoValla: largo } });
              }
            }}
          />
        </label>
      </div>
      <label className="pp-check">
        <input
          type="checkbox"
          checked={plan.ajustes.alinearVallas}
          onChange={(e) => despachar({ tipo: 'ajustes', ajustes: { alinearVallas: e.target.checked } })}
        />
        Alinear las vallas con el perímetro
      </label>
      <button
        type="button"
        className="btn ocda-btn-chico"
        disabled={!plan.perimetro || !valido || !!estado.dibujo}
        onClick={() => despachar({ tipo: 'repartirVallas', total: n })}
      >
        Repartir en el perímetro
      </button>
      {!plan.perimetro && <p className="pp-ayuda">Para repartir, primero dibuje el perímetro.</p>}
      <p className="pp-dato">
        {plan.vallas.length} vallas · {metros(plan.vallas.length * plan.ajustes.largoValla)} en total
      </p>
      {plan.vallas.length > MAX_MANIJAS_VALLAS ? (
        <p className="pp-ayuda">
          Con más de {MAX_MANIJAS_VALLAS} vallas no se mueven una por una: cambie el total o el perímetro y vuelva a repartir.
        </p>
      ) : (
        <p className="pp-ayuda">Arrastre cada valla, o enfóquela con Tab: flechas para mover, R para girar 15°, Supr para quitarla.</p>
      )}
      <p className="pp-ayuda">Ctrl+Z deshace el último cambio.</p>
    </>
  );
}

function Zonas({ estado, despachar, centro, zonaId, onZona }: PropsSeccion & { centro: () => [number, number]; zonaId: string | null; onZona: (id: string | null) => void }) {
  const { plan, dibujo } = estado;
  if (dibujo?.que === 'zona') {
    return <BarraDibujo estado={estado} despachar={despachar} centro={centro} que={`una zona de ${ZONAS_PERIMETRO[dibujo.tipo].etiqueta}`} />;
  }
  return (
    <>
      <p className="pp-ayuda">Dibuje una zona nueva:</p>
      <div className="pp-fila-botones">
        {(Object.keys(ZONAS_PERIMETRO) as TipoZonaPerimetro[]).map((tipo) => (
          <button
            key={tipo}
            type="button"
            className="btn secondary ocda-btn-chico pp-btn-zona"
            style={{ borderColor: ZONAS_PERIMETRO[tipo].color }}
            disabled={!!dibujo || plan.zonas.length >= LIMITES_PERIMETRO.maxZonas}
            onClick={() => despachar({ tipo: 'empezarDibujo', dibujo: { que: 'zona', tipo } })}
          >
            {ZONAS_PERIMETRO[tipo].etiqueta}
          </button>
        ))}
      </div>
      {plan.zonas.length > 0 && (
        <ul className="pp-zonas">
          {plan.zonas.map((z) => (
            <li key={z.id} className={z.id === zonaId ? 'activo' : undefined}>
              <i style={{ background: ZONAS_PERIMETRO[z.tipo].color }} aria-hidden="true" />
              <input
                aria-label={`Nombre de la zona ${z.nombre}`}
                maxLength={LIMITES_PERIMETRO.maxNombre}
                value={z.nombre}
                onChange={(e) => despachar({ tipo: 'editarZona', id: z.id, nombre: e.target.value })}
              />
              <select
                aria-label={`Tipo de la zona ${z.nombre}`}
                value={z.tipo}
                onChange={(e) => despachar({ tipo: 'editarZona', id: z.id, tipoZona: e.target.value as TipoZonaPerimetro })}
              >
                {(Object.keys(ZONAS_PERIMETRO) as TipoZonaPerimetro[]).map((t) => (
                  <option key={t} value={t}>
                    {ZONAS_PERIMETRO[t].etiqueta}
                  </option>
                ))}
              </select>
              <button type="button" className="btn secondary ocda-btn-chico" aria-pressed={z.id === zonaId} onClick={() => onZona(z.id === zonaId ? null : z.id)}>
                {z.id === zonaId ? 'Listo' : 'Mover esquinas'}
              </button>
              <button
                type="button"
                className="pp-btn"
                aria-label={`Quitar la zona ${z.nombre}`}
                onClick={() => {
                  if (z.id === zonaId) onZona(null);
                  despachar({ tipo: 'quitarZona', id: z.id });
                }}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
