import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { DistribucionDiasDetalle, PersonaDistribucionDias } from '@cne/shared-types';
import { Cargando } from '../../components/Cargando';
import {
  eliminarDistribucion,
  getDistribucion,
  getDistribuciones,
  pedirReporteDistribucion,
  quitarPersonaDistribucion,
  regenerarDistribucion,
} from '../../lib/queries/distribucion-dias';
import { useDescargaPdf } from '../../lib/useDescargaPdf';
import { useModulos } from '../../lib/useModulos';
import { AgregarPersonaDistribucionModal } from './AgregarPersonaDistribucionModal';
import { EditarPersonaDistribucionModal } from './EditarPersonaDistribucionModal';
import { NuevaDistribucionModal } from './NuevaDistribucionModal';
import { SEXO_TEXTO, desbalance, diaCorto, filtrarPersonas, valoresUnicos } from './distribucionDias';
import { fechaLarga, mensajeError } from './utils';

const CLAVE = ['distribuciones-dias'] as const;

/**
 * Distribución del personal por días: cada persona va un solo día, con la
 * misma cantidad de hombres y mujeres por día. Se puede mover a alguien de
 * día, cambiar su cantón o encargado, agregar (personal de cualquier cargo o
 * externos) y quitar. Se exporta a Excel y PDF con los filtros de la tabla.
 * Independiente de Parejas, kits y asistencia.
 */
export function DistribucionDiasPanel() {
  const { puede } = useModulos();
  const editable = puede('cda.distribucion.gestionar');
  const qc = useQueryClient();
  const lista = useQuery({ queryKey: CLAVE, queryFn: getDistribuciones });
  const [elegida, setElegida] = useState<string | null>(null);
  const id = elegida ?? lista.data?.[0]?.id ?? null;
  const detalle = useQuery({ queryKey: [...CLAVE, id], queryFn: () => getDistribucion(id as string), enabled: !!id });
  const [creando, setCreando] = useState(false);

  const alCrear = (d: DistribucionDiasDetalle) => {
    qc.setQueryData([...CLAVE, d.id], d);
    setElegida(d.id);
    setCreando(false);
  };

  return (
    <section aria-labelledby="distribucion-titulo">
      <h3 id="distribucion-titulo" className="sr-only">
        Distribución por días
      </h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Reparte al personal entre varios días (por ejemplo viernes, sábado y domingo): cada persona va un solo día y cada día recibe la
        misma cantidad de hombres y de mujeres. No cambia Parejas, kits ni asistencia.
      </p>

      <div className="ocda-filtros">
        {lista.data && lista.data.length > 0 && (
          <label className="ocda-campo" style={{ flex: '1 1 260px', maxWidth: 420 }}>
            <span>Distribución</span>
            <select value={id ?? ''} onChange={(e) => setElegida(e.target.value)}>
              {lista.data.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nombre} ({d.fechas.map(diaCorto).join(', ')}) · {d.total} personas
                </option>
              ))}
            </select>
          </label>
        )}
        {editable && (
          <button type="button" className="btn" onClick={() => setCreando(true)}>
            Nueva distribución
          </button>
        )}
      </div>

      {lista.isLoading && <Cargando />}
      {lista.error && (
        <p className="banner error" role="alert">
          {mensajeError(lista.error, 'No se pudieron cargar las distribuciones')}
        </p>
      )}
      {lista.data?.length === 0 && (
        <p className="banner">{editable ? 'Todavía no hay distribuciones. Cree la primera con «Nueva distribución».' : 'Todavía no hay distribuciones.'}</p>
      )}

      {detalle.isLoading && <Cargando />}
      {detalle.error && (
        <p className="banner error" role="alert">
          {mensajeError(detalle.error, 'No se pudo cargar la distribución')}
        </p>
      )}
      {detalle.data && <Detalle key={detalle.data.id} d={detalle.data} editable={editable} onBorrada={() => setElegida(null)} />}

      {creando && (
        <NuevaDistribucionModal
          anterior={detalle.data ? { excluirCargos: detalle.data.excluirCargos, cantonCpe: detalle.data.cantonCpe, encargadoCpe: detalle.data.encargadoCpe } : null}
          onClose={() => setCreando(false)}
          onCreada={alCrear}
        />
      )}
    </section>
  );
}

function Detalle({ d, editable, onBorrada }: { d: DistribucionDiasDetalle; editable: boolean; onBorrada: () => void }) {
  const qc = useQueryClient();
  const [fecha, setFecha] = useState('');
  const [encargado, setEncargado] = useState('');
  const [buscar, setBuscar] = useState('');
  const [agregando, setAgregando] = useState(false);
  const [editando, setEditando] = useState<PersonaDistribucionDias | null>(null);
  const descarga = useDescargaPdf('No se pudo generar el archivo');

  const encargados = useMemo(() => valoresUnicos(d.personas.map((p) => p.encargado)), [d.personas]);
  const sugerencias = useMemo(() => ({ cantones: valoresUnicos(d.personas.map((p) => p.canton)), encargados }), [d.personas, encargados]);
  const filas = useMemo(() => filtrarPersonas(d.personas, { fecha, encargado, buscar }), [d.personas, fecha, encargado, buscar]);
  const desbal = desbalance(d.totales);
  const sinEncargado = d.personas.filter((p) => !p.encargado).length;

  const refrescar = () => qc.invalidateQueries({ queryKey: CLAVE });
  const regenerar = useMutation({
    mutationFn: () => regenerarDistribucion(d.id),
    onSuccess: (nuevo) => {
      qc.setQueryData([...CLAVE, d.id], nuevo);
      void refrescar();
      sileo.success({ title: 'Distribución rehecha', description: `${nuevo.total} personas repartidas` });
    },
    onError: (e) => sileo.error({ title: mensajeError(e, 'No se pudo rehacer la distribución') }),
  });
  const borrar = useMutation({
    mutationFn: () => eliminarDistribucion(d.id),
    onSuccess: () => {
      qc.removeQueries({ queryKey: [...CLAVE, d.id] });
      void refrescar();
      onBorrada();
      sileo.success({ title: 'Distribución borrada' });
    },
    onError: (e) => sileo.error({ title: mensajeError(e, 'No se pudo borrar la distribución') }),
  });
  const quitar = useMutation({
    mutationFn: (p: PersonaDistribucionDias) => quitarPersonaDistribucion(d.id, p.id),
    onSuccess: (_r, p) => {
      void refrescar();
      sileo.success({ title: 'Quitado de la distribución', description: p.nombres });
    },
    onError: (e) => sileo.error({ title: mensajeError(e, 'No se pudo quitar a la persona') }),
  });

  const exportar = (formato: 'xlsx' | 'pdf') =>
    void descarga.descargar(
      formato,
      () => pedirReporteDistribucion(d.id, formato, { fecha: fecha || undefined, encargado: encargado || undefined }),
      `distribucion_personal_${fecha || `${d.fechas[0]}_${d.fechas[d.fechas.length - 1]}`}.${formato}`,
    );

  return (
    <div style={{ marginTop: '1rem' }}>
      <ul className="row" style={{ gap: '0.75rem', flexWrap: 'wrap', listStyle: 'none', padding: 0, margin: '0 0 1rem' }} aria-label="Totales por día">
        {d.totales.map((t) => (
          <li key={t.fecha} className="ocda-tabla" style={{ padding: '0.75rem 1rem', minWidth: 180 }}>
            <strong style={{ textTransform: 'capitalize' }}>{fechaLarga(t.fecha)}</strong>
            <div>
              {t.hombres} hombres · {t.mujeres} mujeres{t.sinSexo ? ` · ${t.sinSexo} sin dato` : ''}
            </div>
            <div className="muted">Total: {t.total}</div>
          </li>
        ))}
      </ul>

      {d.avisos.map((a) => (
        <p key={a} className="banner aviso" role="status">
          {a}
        </p>
      ))}
      {(desbal.hombres || desbal.mujeres) && (
        <p className="banner aviso" role="status">
          Ya no está equitativa: entre días hay más de una persona de diferencia en {desbal.hombres && desbal.mujeres ? 'hombres y mujeres' : desbal.hombres ? 'hombres' : 'mujeres'}.
        </p>
      )}
      {sinEncargado > 0 && (
        <p className="banner" role="status">
          {sinEncargado} persona(s) sin encargado (sin pareja registrada o recinto fuera del distributivo). Puede ponerlo con «Editar».
        </p>
      )}
      {!editable && <p className="banner">Solo consulta: su rol no puede cambiar la distribución.</p>}

      <div className="ocda-filtros">
        <label className="ocda-campo" style={{ flex: '0 1 180px' }}>
          <span>Día</span>
          <select value={fecha} onChange={(e) => setFecha(e.target.value)}>
            <option value="">Todos</option>
            {d.fechas.map((f) => (
              <option key={f} value={f}>
                {diaCorto(f)}
              </option>
            ))}
          </select>
        </label>
        <label className="ocda-campo" style={{ flex: '0 1 240px' }}>
          <span>Encargado</span>
          <select value={encargado} onChange={(e) => setEncargado(e.target.value)}>
            <option value="">Todos</option>
            {encargados.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <label className="ocda-campo" style={{ flex: '1 1 220px' }}>
          <span>Buscar</span>
          <input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Nombre, cédula, cargo, cantón…" maxLength={60} />
        </label>
      </div>

      <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', margin: '0.75rem 0' }}>
        <button type="button" className="btn" onClick={() => exportar('xlsx')} disabled={!!descarga.descargando} aria-busy={descarga.descargando === 'xlsx'}>
          {descarga.descargando === 'xlsx' ? 'Generando…' : 'Excel'}
        </button>
        <button type="button" className="btn secondary" onClick={() => exportar('pdf')} disabled={!!descarga.descargando} aria-busy={descarga.descargando === 'pdf'}>
          {descarga.descargando === 'pdf' ? 'Generando…' : 'PDF'}
        </button>
        {editable && (
          <>
            <button type="button" className="btn secondary" onClick={() => setAgregando(true)}>
              Agregar persona
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={regenerar.isPending}
              onClick={() => {
                if (window.confirm('¿Rehacer la distribución desde cero? Se pierden los cambios y las personas agregadas a mano.')) regenerar.mutate();
              }}
            >
              {regenerar.isPending ? 'Repartiendo…' : 'Rehacer reparto'}
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={borrar.isPending}
              onClick={() => {
                if (window.confirm(`¿Borrar la distribución «${d.nombre}»? No se puede deshacer.`)) borrar.mutate();
              }}
            >
              Borrar
            </button>
          </>
        )}
      </div>

      <p className="ocda-pie" role="status" style={{ marginTop: 0 }}>
        {filas.length} de {d.personas.length} personas{fecha || encargado || buscar ? ' (con filtros; el Excel y el PDF usan el día y el encargado elegidos)' : ''}
      </p>

      <div className="ocda-tabla" tabIndex={0} role="region" aria-label="Personas de la distribución">
        <table>
          <caption className="sr-only">Personas de la distribución {d.nombre}, por día</caption>
          <thead>
            <tr>
              <th scope="col">N°</th>
              <th scope="col">Día</th>
              <th scope="col">Apellidos y nombres</th>
              <th scope="col">Cédula</th>
              <th scope="col">Celular</th>
              <th scope="col">Sexo</th>
              <th scope="col">Cargo</th>
              <th scope="col">Cantón</th>
              <th scope="col">Encargado</th>
              {editable && <th scope="col">Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {filas.map((p, i) => (
              <tr key={p.id}>
                <td>{i + 1}</td>
                <td>{diaCorto(p.fecha)}</td>
                <th scope="row" style={{ fontWeight: 'normal' }}>
                  {p.nombres}
                  {p.operadorId === null && <span className="ocda-estado pendiente" style={{ marginLeft: '0.4rem' }}>Externa</span>}
                </th>
                <td>{p.cedula}</td>
                <td>{p.telefono ?? '—'}</td>
                <td>{p.sexo ? SEXO_TEXTO[p.sexo] : '—'}</td>
                <td>{p.cargo}</td>
                <td>{p.canton ?? '—'}</td>
                <td>{p.encargado ?? '—'}</td>
                {editable && (
                  <td>
                    <div className="row" style={{ gap: '0.4rem', flexWrap: 'nowrap' }}>
                      <button type="button" className="ocda-chip" onClick={() => setEditando(p)} aria-label={`Editar a ${p.nombres}`}>
                        Editar
                      </button>
                      <button
                        type="button"
                        className="ocda-chip"
                        disabled={quitar.isPending}
                        aria-label={`Quitar a ${p.nombres} de la distribución`}
                        onClick={() => {
                          if (window.confirm(`¿Quitar a ${p.nombres} de la distribución?`)) quitar.mutate(p);
                        }}
                      >
                        Quitar
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {filas.length === 0 && (
              <tr>
                <td colSpan={editable ? 10 : 9} className="muted">
                  Nadie coincide con los filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {agregando && <AgregarPersonaDistribucionModal distribucionId={d.id} fechas={d.fechas} sugerencias={sugerencias} onClose={() => setAgregando(false)} />}
      {editando && (
        <EditarPersonaDistribucionModal distribucionId={d.id} persona={editando} fechas={d.fechas} sugerencias={sugerencias} onClose={() => setEditando(null)} />
      )}
    </div>
  );
}
