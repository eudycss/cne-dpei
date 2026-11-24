import { useMemo, useState } from 'react';
import type { ReporteNoCdaDetalle, ReporteNoCdaItem } from '@cne/shared-types';
import { type Avance, coincideBusqueda, porcentajeAvance, resumenLlegadaNoCda } from '@cne/shared-validation';
import { DonaAnillo } from '../../components/DonaAnillo';
import { NumeroAnimado } from '../../components/NumeroAnimado';
import { AvanceEtapas } from '../operadores/AvanceEtapas';
import { AccionLlegadaDelegacion } from './AccionLlegadaDelegacion';
import type { GrupoAvance } from '../operadores/estadisticas';

type Agrupacion = 'cda' | 'canton';

const AGRUPACIONES: { valor: Agrupacion; etiqueta: string }[] = [
  { valor: 'cda', etiqueta: 'Por CDA' },
  { valor: 'canton', etiqueta: 'Por cantón' },
];

export function horaLlegada(iso: string): string {
  return new Date(iso).toLocaleString('es-EC', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'America/Guayaquil',
  });
}

/** Barras por juntas, del que menos avanzó al que más (los que faltan, arriba). */
export function gruposPorJuntas(datos: ReporteNoCdaItem[], agrupacion: Agrupacion): GrupoAvance[] {
  // Sin juntas en el distributivo (0), se mide por recintos: si no, un CDA con pendientes parecería completo.
  const medir = (juntas: Avance, recintos: Avance): Avance => (juntas.total > 0 ? juntas : recintos);
  const grupos: GrupoAvance[] =
    agrupacion === 'cda'
      ? datos
          .filter((c) => c.totalNoCdas > 0)
          .map((c) => ({
            nombre: `${c.cdaCodigo} · ${c.cdaNombre}`,
            ...medir({ hechos: c.juntasLlegadas, total: c.juntasNoCdas }, { hechos: c.totalLlegados, total: c.totalNoCdas }),
          }))
      : resumenLlegadaNoCda(datos).porCanton.map((c) => ({ nombre: c.canton, ...medir(c.juntas, c.recintos) }));
  const avance = (g: GrupoAvance) => (g.total > 0 ? g.hechos / g.total : 1);
  return grupos.sort((a, b) => avance(a) - avance(b) || b.total - b.hechos - (a.total - a.hechos) || a.nombre.localeCompare(b.nombre, 'es'));
}

/** Pendientes primero; los que llegaron, en el orden en que llegaron. */
export function ordenarNoCdas(noCdas: ReporteNoCdaDetalle[]): ReporteNoCdaDetalle[] {
  // Llegados sin hora (no debería pasar) van al final de los llegados: orden total y estable.
  const clave = (n: ReporteNoCdaDetalle) => (n.llegado ? n.llegadaEn ?? '￿' : '');
  return [...noCdas].sort((a, b) => {
    if (a.llegado !== b.llegado) return a.llegado ? 1 : -1;
    return clave(a).localeCompare(clave(b)) || a.nombre.localeCompare(b.nombre, 'es');
  });
}

/** Hoja "Detalle NO CDA" del Excel: una fila por NO CDA, pendientes primero dentro de cada CDA. */
export function filasDetalleNoCda(datos: ReporteNoCdaItem[]): (string | number)[][] {
  const filas: (string | number)[][] = [
    ['CDA', 'Código NO CDA', 'NO CDA', 'Cantón', 'JF', 'JM', 'Juntas', 'Electores', 'Estado', 'Hora de llegada', 'Marcó'],
  ];
  for (const cda of datos) {
    for (const nc of ordenarNoCdas(cda.noCdas)) {
      filas.push([
        `${cda.cdaCodigo} — ${cda.cdaNombre}`,
        nc.codigoRecinto,
        nc.nombre,
        nc.cantonNombre,
        nc.juntasFemeninas,
        nc.juntasMasculinas,
        nc.juntas,
        nc.electores,
        nc.llegado ? 'Llegó' : 'Pendiente',
        nc.llegadaEn ? horaLlegada(nc.llegadaEn) : '',
        nc.registradoPor ?? '',
      ]);
    }
  }
  return filas;
}

function Kpi({ etiqueta, valor, detalle }: { etiqueta: string; valor: number; detalle: string }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{etiqueta}</div>
      <div className="kpi-num">
        <span className="sr-only">{valor}</span>
        <span aria-hidden="true">
          <NumeroAnimado valor={valor} />
        </span>
      </div>
      <div className="kpi-detalle">{detalle}</div>
    </div>
  );
}

/**
 * Llegada de los NO CDA a su CDA: el operador del CDA marca cada NO CDA cuando
 * llega. Avance medido en juntas (y en recintos), gráficos y la tabla por CDA.
 */
export function LlegadaNoCdaPanel({
  datos,
  permisos = { marcar: false, deshacer: false },
}: {
  datos: ReporteNoCdaItem[];
  /** Fila de la Delegación: quién puede marcar la llegada y quién deshacerla (el API lo revisa igual). */
  permisos?: { marcar: boolean; deshacer: boolean };
}) {
  const [agrupacion, setAgrupacion] = useState<Agrupacion>('cda');
  const [busqueda, setBusqueda] = useState('');
  const [soloPendientes, setSoloPendientes] = useState(false);

  const resumen = useMemo(() => resumenLlegadaNoCda(datos), [datos]);
  const grupos = useMemo(() => gruposPorJuntas(datos, agrupacion), [datos, agrupacion]);

  const filas = useMemo(
    () =>
      datos.filter(
        (c) =>
          (!soloPendientes || c.totalLlegados < c.totalNoCdas) &&
          coincideBusqueda(
            [c.cdaCodigo, c.cdaNombre, c.cantonNombre, c.operadorNombre, ...c.noCdas.flatMap((n) => [n.codigoRecinto, n.nombre])],
            busqueda,
          ),
      ),
    [datos, busqueda, soloPendientes],
  );

  const { juntas, recintos, cdas } = resumen;

  return (
    <>
      <div className="kpi-grid">
        <Kpi
          etiqueta="Juntas que llegaron"
          valor={juntas.hechos}
          detalle={`de ${juntas.total} juntas · ${porcentajeAvance(juntas)} %`}
        />
        <Kpi
          etiqueta="NO CDA que llegaron"
          valor={recintos.hechos}
          detalle={`de ${recintos.total} recintos · ${porcentajeAvance(recintos)} %`}
        />
        <Kpi etiqueta="CDA completos" valor={cdas.completos} detalle={`de ${cdas.total} CDA con NO CDA`} />
        <Kpi etiqueta="CDA sin ninguna llegada" valor={cdas.sinLlegadas} detalle={`de ${cdas.total} CDA con NO CDA`} />
      </div>

      <div className="evx-etapas-grid ncda-graficos">
        <div className="card estad-seccion">
          <DonaAnillo
            titulo="Juntas de los NO CDA"
            unidad="juntas"
            tramos={[
              { clave: 'llegaron', etiqueta: 'Llegaron', cantidad: juntas.hechos, color: 'var(--estado-llego)' },
              { clave: 'pendientes', etiqueta: 'Pendientes', cantidad: juntas.total - juntas.hechos, color: 'var(--estado-dpi)' },
            ]}
          />
        </div>
        <div className="card estad-seccion">
          <div className="ocda-filtros no-print" role="group" aria-label="Agrupar el avance" style={{ marginBottom: '0.5rem' }}>
            {AGRUPACIONES.map((a) => (
              <button
                key={a.valor}
                type="button"
                className="ocda-chip"
                aria-pressed={agrupacion === a.valor}
                onClick={() => setAgrupacion(a.valor)}
              >
                {agrupacion === a.valor && <span aria-hidden="true">✓ </span>}
                {a.etiqueta}
              </button>
            ))}
          </div>
          {/* 40+ CDA: área con desplazamiento propio (también con teclado) para no empujar la tabla. */}
          <div
            className="ncda-barras-scroll"
            role="region"
            aria-label="Avance de juntas (desplazable)"
            tabIndex={0}
          >
            <AvanceEtapas
              titulo={`Juntas que llegaron, ${agrupacion === 'cda' ? 'por CDA' : 'por cantón'} (los que faltan, arriba)`}
              grupos={grupos}
              vacio="No hay CDA con recintos NO CDA en el evento activo."
              etiquetaHecho="juntas llegaron"
            />
          </div>
        </div>
      </div>

      <div className="row no-print" style={{ gap: '0.75rem', margin: '0.5rem 0 0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <label className="row" style={{ gap: '0.35rem', alignItems: 'center' }}>
          Buscar
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="CDA, NO CDA, cantón u operador"
          />
        </label>
        <label className="row" style={{ gap: '0.35rem', alignItems: 'center' }}>
          <input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} />
          Solo CDA con NO CDA pendientes
        </label>
        <span className="muted" role="status">
          {filas.length} de {datos.length} CDA
        </span>
      </div>

      <div className="table-scroll">
        <table className="table-report ncda-tabla" aria-label="Llegada de los NO CDA por CDA">
          <thead>
            <tr>
              {/* Cédula y kits quedan en el Excel y en "Flujo de CDAs": aquí manda el detalle. */}
              {['CDA', 'Cantón', 'Operador', 'NO CDA', 'Juntas', 'Detalle (pendientes primero)'].map((t) => (
                <th key={t} scope="col">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((item) => (
              <tr key={item.cdaId}>
                <td>{item.cdaCodigo} — {item.cdaNombre}</td>
                <td>{item.cantonNombre}</td>
                <td>{item.esDelegacion ? <span className="muted">Quien recibe en la Delegación</span> : item.operadorNombre}</td>
                <td>
                  <strong style={{ color: 'var(--success-text)' }}>{item.totalLlegados}</strong> / {item.totalNoCdas}
                </td>
                <td>
                  <strong style={{ color: 'var(--success-text)' }}>{item.juntasLlegadas}</strong> / {item.juntasNoCdas}
                </td>
                <td>
                  {item.noCdas.length === 0 ? (
                    <span className="muted">—</span>
                  ) : (
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                      {ordenarNoCdas(item.noCdas).map((nc) => (
                        <li key={nc.id} style={{ color: nc.llegado ? 'var(--success-text)' : 'var(--error)' }}>
                          {nc.llegado && nc.llegadaEn ? (
                            <>
                              <span aria-hidden="true">✓ </span>Llegó {horaLlegada(nc.llegadaEn)}
                            </>
                          ) : (
                            <>
                              <span aria-hidden="true">✗ </span>Pendiente
                            </>
                          )}
                          {' · '}
                          {nc.codigoRecinto} — {nc.nombre} · {nc.juntas} {nc.juntas === 1 ? 'junta' : 'juntas'}
                          {nc.registradoPor && <span className="muted"> · marcó {nc.registradoPor}</span>}
                          {item.esDelegacion && !nc.llegado && permisos.marcar && (
                            <AccionLlegadaDelegacion noCda={nc} accion="marcar" />
                          )}
                          {item.esDelegacion && nc.llegado && permisos.deshacer && (
                            <AccionLlegadaDelegacion noCda={nc} accion="deshacer" />
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
            {filas.length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: '1.5rem' }}>
                  Ningún CDA coincide con los filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
