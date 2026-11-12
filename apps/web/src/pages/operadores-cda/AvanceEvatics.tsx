import { useState } from 'react';
import type { ConteoEvatics, GrupoConteoEvatics } from '@cne/shared-types';

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
  const grupos = ordenarGrupos(vista === 'canton' ? porCanton : porTecnico);
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
            <span className={`evx-muestra ${t.clase}`} aria-hidden="true" />
            {t.etiqueta}
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
        <ul className="evx-barras">
          {grupos.map((g) => {
            const elegido = actual === g.nombre;
            return (
              <li key={g.nombre}>
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
                        <span key={t.clave} className={`evx-tramo ${t.clase}`} style={{ flexGrow: g[t.clave] }} />
                      ) : null,
                    )}
                  </span>
                  <span className="evx-cifra" aria-hidden="true">
                    {g.aprobados}/{g.total} · {pct(g.aprobados, g.total)} %
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
