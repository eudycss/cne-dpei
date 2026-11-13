import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { ConteoEvatics, GrupoConteoEvatics } from '@cne/shared-types';
import { NumeroAnimado } from '../../components/NumeroAnimado';

/**
 * Orden fijo de los tramos (de "hecho" a "falta"). Son colores de estado del
 * tema, nunca colores de serie; verde y rojo no quedan juntos (validado con
 * daltonismo: ΔE ≥ 10). El color nunca va solo: leyenda, cifras y tabla.
 */
export const TRAMOS = [
  { clave: 'aprobados', etiqueta: 'Aprobados', clase: 'aprobado' },
  { clave: 'pendientes', etiqueta: 'En revisión', clase: 'pendiente' },
  { clave: 'rechazados', etiqueta: 'Rechazados', clase: 'rechazado' },
  { clave: 'sinSubir', etiqueta: 'Sin subir', clase: 'sin-subir' },
] as const satisfies readonly { clave: keyof ConteoEvatics; etiqueta: string; clase: string }[];

type Vista = 'canton' | 'tecnico';

export const pct = (parte: number, total: number) => (total > 0 ? Math.round((parte / total) * 100) : 0);

/**
 * Del mayor al menor porcentaje de aprobados (el que más avanzó, primero). Se
 * compara la fracción exacta, no la redondeada; a igual porcentaje, el grupo
 * con más personas y, si sigue el empate, por nombre.
 */
export function ordenarGrupos(grupos: GrupoConteoEvatics[]): GrupoConteoEvatics[] {
  return [...grupos].sort(
    (a, b) =>
      b.aprobados * a.total - a.aprobados * b.total || // a.total o b.total en 0 compara 0 con 0
      b.total - a.total ||
      a.nombre.localeCompare(b.nombre, 'es'),
  );
}

export function describirGrupo(g: GrupoConteoEvatics): string {
  return `${g.nombre}: ${g.aprobados} de ${g.total} aprobados (${pct(g.aprobados, g.total)} %), ${g.pendientes} en revisión, ${g.rechazados} rechazados, ${g.sinSubir} sin subir`;
}

const DURACION_REORDEN_MS = 450;

/**
 * Cuando una fila cambia de lugar (porque otro grupo avanzó más) se desliza a
 * su nueva posición en vez de saltar. Respeta "reducir movimiento". Cada <li>
 * lleva data-clave con su nombre.
 */
function useAnimarReorden(lista: RefObject<HTMLUListElement | null>) {
  const antes = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const ul = lista.current;
    if (!ul) {
      antes.current = new Map();
      return;
    }
    const sinMovimiento = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const ahora = new Map<string, number>();
    for (const li of Array.from(ul.children) as HTMLElement[]) {
      const clave = li.dataset.clave;
      if (!clave) continue;
      ahora.set(clave, li.offsetTop);
      const previo = antes.current.get(clave);
      if (previo !== undefined && previo !== li.offsetTop && !sinMovimiento && typeof li.animate === 'function') {
        li.animate([{ transform: `translateY(${previo - li.offsetTop}px)` }, { transform: 'none' }], {
          duration: DURACION_REORDEN_MS,
          easing: 'ease-in-out',
        });
      }
    }
    antes.current = ahora;
  });
}

/**
 * Tramo de la barra: nace en 0 y crece hasta su valor (y sigue la transición
 * de CSS cuando el valor cambia). Si hay un tramo resaltado, los demás se atenúan.
 */
function Tramo({ valor, clase, atenuado }: { valor: number; clase: string; atenuado: boolean }) {
  const [grow, setGrow] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrow(valor));
    return () => cancelAnimationFrame(id);
  }, [valor]);
  return <span className={`evx-tramo ${clase}${atenuado ? ' atenuado' : ''}`} style={{ flexGrow: grow }} />;
}

/**
 * Avance por cantón o por Asistente Transversal: una barra apilada por grupo
 * (100 % = su personal). Cada fila es un botón que filtra la tabla. Con
 * "Ver como tabla" se leen las mismas cifras sin gráfico.
 */
export function AvanceEvatics({
  porCanton,
  porTecnico,
  seleccionado,
  onElegir,
}: {
  porCanton: GrupoConteoEvatics[];
  porTecnico: GrupoConteoEvatics[];
  /** Cantón o asistente elegido como filtro ('' = ninguno). */
  seleccionado: { canton: string; tecnico: string };
  onElegir: (vista: Vista, nombre: string) => void;
}) {
  const [vista, setVista] = useState<Vista>('canton');
  const [comoTabla, setComoTabla] = useState(false);
  // Tramo que se resalta (al pasar el cursor o enfocar la leyenda, o fijado con clic): los demás se atenúan.
  const [fijado, setFijado] = useState<keyof ConteoEvatics | null>(null);
  const [sobre, setSobre] = useState<keyof ConteoEvatics | null>(null);
  const resaltado = sobre ?? fijado;
  const grupos = ordenarGrupos(vista === 'canton' ? porCanton : porTecnico);
  const lista = useRef<HTMLUListElement>(null);
  useAnimarReorden(lista);
  const actual = vista === 'canton' ? seleccionado.canton : seleccionado.tecnico;
  const titulo = vista === 'canton' ? 'Avance por cantón' : 'Avance por Asistente Transversal';

  return (
    <section className="evx-avance" aria-labelledby="evx-avance-titulo">
      <div className="evx-avance-cabecera">
        <h3 id="evx-avance-titulo">{titulo}</h3>
        <div className="ocda-filtros" role="group" aria-label="Agrupar el avance" style={{ margin: 0 }}>
          {(['canton', 'tecnico'] as const).map((v) => (
            <button key={v} type="button" className="ocda-chip" aria-pressed={vista === v} onClick={() => setVista(v)}>
              {vista === v && <span aria-hidden="true">✓ </span>}
              {v === 'canton' ? 'Por cantón' : 'Por asistente'}
            </button>
          ))}
          <button type="button" className="ocda-chip" aria-pressed={comoTabla} onClick={() => setComoTabla((t) => !t)}>
            {comoTabla && <span aria-hidden="true">✓ </span>}
            Ver como tabla
          </button>
        </div>
      </div>

      <ul className="evx-leyenda" aria-label="Leyenda">
        {TRAMOS.map((t) => (
          <li key={t.clave}>
            <button
              type="button"
              className="evx-leyenda-boton"
              aria-pressed={fijado === t.clave}
              title="Resaltar este tramo en todas las barras"
              onClick={() => setFijado((f) => (f === t.clave ? null : t.clave))}
              onMouseEnter={() => setSobre(t.clave)}
              onMouseLeave={() => setSobre(null)}
              onFocus={() => setSobre(t.clave)}
              onBlur={() => setSobre(null)}
            >
              <span className={`evx-muestra ${t.clase}`} aria-hidden="true" />
              {t.etiqueta}
            </button>
          </li>
        ))}
      </ul>

      {grupos.length === 0 ? (
        <p className="muted">Aún no hay personal que deba subir el certificado.</p>
      ) : comoTabla ? (
        <div className="ocda-tabla" tabIndex={0} role="region" aria-label={`${titulo} (tabla)`}>
          <table>
            <thead>
              <tr>
                <th scope="col">{vista === 'canton' ? 'Cantón' : 'Asistente'}</th>
                {TRAMOS.map((t) => (
                  <th key={t.clave} scope="col">
                    {t.etiqueta}
                  </th>
                ))}
                <th scope="col">Total</th>
                <th scope="col">% aprobado</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => (
                <tr key={g.nombre}>
                  <th scope="row">{g.nombre}</th>
                  {TRAMOS.map((t) => (
                    <td key={t.clave}>{g[t.clave]}</td>
                  ))}
                  <td>{g.total}</td>
                  <td>{pct(g.aprobados, g.total)} %</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="evx-barras" ref={lista}>
          {grupos.map((g) => {
            const elegido = actual === g.nombre;
            return (
              <li key={g.nombre} data-clave={g.nombre}>
                <button
                  type="button"
                  className="evx-fila"
                  aria-pressed={elegido}
                  aria-label={`${describirGrupo(g)}. ${elegido ? 'Quitar el filtro' : 'Filtrar el listado'}`}
                  onClick={() => onElegir(vista, elegido ? '' : g.nombre)}
                >
                  <span className="evx-nombre">{g.nombre}</span>
                  <span className="evx-barra" aria-hidden="true">
                    {TRAMOS.map((t) =>
                      g[t.clave] > 0 ? (
                        <Tramo key={t.clave} valor={g[t.clave]} clase={t.clase} atenuado={resaltado !== null && resaltado !== t.clave} />
                      ) : null,
                    )}
                  </span>
                  <span className="evx-cifra" aria-hidden="true">
                    <NumeroAnimado valor={g.aprobados} />/{g.total} · <NumeroAnimado valor={pct(g.aprobados, g.total)} /> %
                  </span>
                  <span className="evx-tip" aria-hidden="true">
                    {TRAMOS.map((t) => (
                      <span key={t.clave}>
                        <span className={`evx-muestra ${t.clase}`} />
                        {t.etiqueta}: <strong>{g[t.clave]}</strong>
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="ocda-pie">Toque una barra para ver solo a esas personas en el listado.</p>
    </section>
  );
}
