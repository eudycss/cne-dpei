import { useId, useMemo, useState } from 'react';
import type { EstadisticasJornadaDto } from '@cne/shared-types';
import { formatearFechaHora } from '../../lib/notifications';
import { ETAPAS, opcionesFiltro, ordenNoCda, ordenPorEtapa, type EtapaClave, type FilaOrden, type OrdenLlegada } from './estadisticas';

const NO_CDA = 'noCda';
type Vista = EtapaClave | typeof NO_CDA;

const OPCIONES_VISTA: { valor: Vista; etiqueta: string }[] = [
  ...ETAPAS.map((e) => ({ valor: e.clave as Vista, etiqueta: e.etiqueta })),
  { valor: NO_CDA, etiqueta: 'Llegada a NO CDA' },
];

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

function TablaOrden({ titulo, orden, conCda, vacio }: { titulo: string; orden: OrdenLlegada; conCda: boolean; vacio: string }) {
  return (
    <div className="table-scroll table-scroll-alta" role="region" aria-label={titulo} tabIndex={0}>
      <table>
        <thead>
          <tr>
            <th scope="col">N.º</th>
            <th scope="col">Código</th>
            <th scope="col">Recinto</th>
            {conCda && <th scope="col">CDA de origen</th>}
            <th scope="col">Cantón</th>
            <th scope="col">Técnico</th>
            {!conCda && <th scope="col">Operador</th>}
            {!conCda && <th scope="col">Asistente</th>}
            <th scope="col">Hora</th>
          </tr>
        </thead>
        <tbody>
          {orden.filas.map((f: FilaOrden) => (
            <tr key={`${f.codigoRecinto}-${f.orden}`}>
              <td>{f.orden}</td>
              <td>{f.codigoRecinto}</td>
              <td>{f.nombreRecinto}</td>
              {conCda && <td>{f.cda}</td>}
              <td>{f.cantonNombre}</td>
              <td>{f.tecnicoNombre}</td>
              {!conCda && <td>{f.operadorNombre ?? 'Sin dato'}</td>}
              {!conCda && <td>{f.asistenteNombre ?? 'Sin dato'}</td>}
              <td>{formatearFechaHora(f.hora)}</td>
            </tr>
          ))}
          {orden.filas.length === 0 && (
            <tr>
              <td colSpan={conCda ? 7 : 8} className="muted" style={{ textAlign: 'center', padding: '1.5rem' }}>
                {vacio}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Orden en que cada pareja (o cada NO CDA) completó una etapa, de la hora más
 * temprana a la más tardía. Es solo una lista numerada: no destaca a nadie.
 */
export function OrdenLlegadaPanel({ datos }: { datos: EstadisticasJornadaDto }) {
  const [vista, setVista] = useState<Vista>('llegadaRecintoEn');
  const [canton, setCanton] = useState('');
  const [tecnico, setTecnico] = useState('');
  const idCanton = useId();
  const idTecnico = useId();

  const cantones = useMemo(() => opcionesFiltro(datos, 'canton'), [datos]);
  const tecnicos = useMemo(() => opcionesFiltro(datos, 'tecnico'), [datos]);
  // Si el dato refrescado ya no trae el cantón o técnico elegido, se muestran todos.
  const filtro = useMemo(
    () => ({ canton: cantones.includes(canton) ? canton : '', tecnico: tecnicos.includes(tecnico) ? tecnico : '' }),
    [cantones, tecnicos, canton, tecnico],
  );
  const orden = useMemo(
    () => (vista === NO_CDA ? ordenNoCda(datos, filtro) : ordenPorEtapa(datos, vista, filtro)),
    [datos, vista, filtro],
  );
  const esNoCda = vista === NO_CDA;
  const titulo = esNoCda ? 'Orden de llegada: NO CDA' : `Orden de llegada: ${ETAPAS.find((e) => e.clave === vista)!.etiqueta}`;
  const pendientes = esNoCda
    ? `${plural(orden.pendientes, 'NO CDA', 'NO CDA')} aún sin visita.`
    : `${plural(orden.pendientes, 'pareja', 'parejas')} aún sin registrar esta etapa.`;

  return (
    <div style={{ marginTop: '1rem' }}>
      <div className="row" style={{ gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <label htmlFor={idCanton}>
          Cantón{' '}
          <select id={idCanton} value={filtro.canton} onChange={(e) => setCanton(e.target.value)}>
            <option value="">Todos los cantones</option>
            {cantones.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={idTecnico}>
          Técnico{' '}
          <select id={idTecnico} value={filtro.tecnico} onChange={(e) => setTecnico(e.target.value)}>
            <option value="">Todos los técnicos</option>
            {tecnicos.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="ocda-filtros" role="group" aria-label="Etapa del orden de llegada" style={{ margin: '0 0 0.75rem' }}>
        {OPCIONES_VISTA.map((o) => (
          <button key={o.valor} type="button" className="ocda-chip" aria-pressed={vista === o.valor} onClick={() => setVista(o.valor)}>
            {vista === o.valor && <span aria-hidden="true">✓ </span>}
            {o.etiqueta}
          </button>
        ))}
      </div>

      <div className="card">
        <h3 style={{ margin: '0 0 0.25rem', fontSize: '1rem' }}>{titulo}</h3>
        <p className="muted" style={{ margin: '0 0 0.75rem' }} aria-live="polite">
          {plural(orden.filas.length, 'registro', 'registros')}. {pendientes}
        </p>
        <TablaOrden
          titulo={titulo}
          orden={orden}
          conCda={esNoCda}
          vacio={esNoCda ? 'Aún no se registra ninguna llegada a un NO CDA.' : 'Aún ninguna pareja registra esta etapa.'}
        />
      </div>
    </div>
  );
}
