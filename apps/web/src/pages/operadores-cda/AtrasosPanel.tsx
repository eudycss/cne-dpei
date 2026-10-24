import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { ConfigAsistenciaCda, EstadoPuntualidad, FilaAtrasoCda } from '@cne/shared-types';
import { configAsistenciaCdaSchema, rangoAsistenciaSchema } from '@cne/shared-validation';
import { useAuth } from '../../auth/AuthContext';
import { SearchInput } from '../../components/SearchInput';
import { Cargando } from '../../components/Cargando';
import { Modal } from '../../components/Modal';
import {
  getAtrasosCda,
  getConfigAsistenciaCda,
  guardarConfigAsistenciaCda,
} from '../../lib/queries/operadores-cda';
import { AccionesEncabezado } from './AccionesEncabezado';
import { Campo } from './Campo';
import { ExportarReporteModal } from './ExportarReporteModal';
import { Kpi } from './Kpi';
import { hoyEcuador, mensajeError, normalizar } from './utils';

type Vista = 'resumen' | 'detalle';
type Filtro = 'todos' | EstadoPuntualidad;

const ESTADO: Record<EstadoPuntualidad, { etiqueta: string; clase: string }> = {
  PUNTUAL: { etiqueta: 'Puntual', clase: 'ok' },
  ATRASO: { etiqueta: 'Atraso', clase: 'aviso' },
  FALTA: { etiqueta: 'Falta', clase: 'error' },
  PENDIENTE: { etiqueta: 'Pendiente', clase: 'pendiente' },
};

const FILTROS: { id: Filtro; etiqueta: string }[] = [
  { id: 'todos', etiqueta: 'Todos' },
  { id: 'ATRASO', etiqueta: 'Atrasos' },
  { id: 'FALTA', etiqueta: 'Faltas' },
  { id: 'PUNTUAL', etiqueta: 'Puntuales' },
  { id: 'PENDIENTE', etiqueta: 'Pendientes' },
];

/**
 * Reporte de atrasos: con la hora oficial de entrada y los minutos de gracia,
 * cada día de cada operador queda como puntual, atraso o falta (sin entrada).
 * La API hace el cálculo; aquí solo se filtra y se muestra.
 */
export function AtrasosPanel({ acciones = null }: { acciones?: HTMLElement | null }) {
  const { user } = useAuth();
  const isAdmin = user?.roles.includes('ADMINISTRADOR') ?? false;
  const hoy = hoyEcuador();
  const [desde, setDesde] = useState(`${hoy.slice(0, 8)}01`);
  const [hasta, setHasta] = useState(hoy);
  const [vista, setVista] = useState<Vista>('resumen');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [configurando, setConfigurando] = useState(false);
  const [exportando, setExportando] = useState(false);

  const rango = rangoAsistenciaSchema.safeParse({ desde, hasta });
  const errorRango = rango.success ? null : rango.error.issues[0]?.message ?? 'Rango inválido';

  // Aparte del reporte: el administrador puede cambiarla aunque el rango sea inválido.
  const config = useQuery({ queryKey: ['asistencia-cda-config'], queryFn: getConfigAsistenciaCda, enabled: isAdmin });
  const { data, isLoading, error } = useQuery({
    queryKey: ['atrasos-cda', desde, hasta],
    queryFn: () => getAtrasosCda(desde, hasta),
    enabled: rango.success,
  });

  const q = normalizar(busqueda.trim());
  const coincide = (p: { apellidosNombres: string; cedula: string }) =>
    !q || normalizar(p.apellidosNombres).includes(q) || p.cedula.includes(q);

  const resumen = (data?.resumen ?? [])
    .filter(coincide)
    .sort((a, b) => b.atrasos - a.atrasos || b.minutosAtraso - a.minutosAtraso || b.faltas - a.faltas);
  const filas = (data?.filas ?? []).filter((f) => (filtro === 'todos' || f.estado === filtro) && coincide(f));
  const conteo = (f: Filtro) => (data?.filas ?? []).filter((x) => f === 'todos' || x.estado === f).length;

  const t = data?.totales;
  const evaluados = t ? t.puntuales + t.atrasos + t.faltas : 0;
  const pct = (n: number) => (evaluados > 0 ? Math.round((n / evaluados) * 100) : 0);

  return (
    <>
      <AccionesEncabezado destino={acciones}>
        {isAdmin && (
          <button type="button" className="btn secondary" disabled={!config.data} onClick={() => setConfigurando(true)}>
            Hora de entrada
          </button>
        )}
        <button type="button" className="btn" onClick={() => setExportando(true)} disabled={!rango.success}>
          Exportar
        </button>
      </AccionesEncabezado>

      {data && (
        <div className="banner" role="status">
          Hora de entrada <strong>{data.config.horaEntrada}</strong> · gracia de{' '}
          <strong>{data.config.minutosGracia} min</strong>: entrada hasta las{' '}
          {sumarMinutos(data.config.horaEntrada, data.config.minutosGracia)} es puntual; desde las{' '}
          {sumarMinutos(data.config.horaEntrada, data.config.minutosGracia + 1)} es atraso; sin marca de entrada es
          falta.
        </div>
      )}

      {t && (
        <div className="ocda-kpis" role="group" aria-label="Resumen del periodo">
          <Kpi
            etiqueta="Puntuales"
            valor={String(t.puntuales)}
            parte={t.puntuales}
            total={evaluados}
            detalle={`${pct(t.puntuales)}% de los días evaluados`}
          />
          <Kpi
            etiqueta="Atrasos"
            valor={String(t.atrasos)}
            parte={t.atrasos}
            total={evaluados}
            detalle={`${pct(t.atrasos)}% de los días evaluados`}
          />
          <Kpi
            etiqueta="Faltas"
            valor={String(t.faltas)}
            parte={t.faltas}
            total={evaluados}
            detalle={`${pct(t.faltas)}% de los días evaluados`}
          />
          <Kpi
            etiqueta="Minutos de atraso"
            valor={String(t.minutosAtraso)}
            parte={t.atrasos}
            total={evaluados}
            detalle={t.atrasos > 0 ? `Promedio ${Math.round(t.minutosAtraso / t.atrasos)} min por atraso` : 'Sin atrasos'}
          />
        </div>
      )}

      <div className="ocda-filtros">
        <span className="ocda-campo" style={{ flex: '1 1 260px', maxWidth: 360 }}>
          <SearchInput
            value={busqueda}
            onChange={setBusqueda}
            placeholder="Buscar por nombre o cédula…"
            ariaLabel="Buscar operador por nombre o cédula"
          />
        </span>
        <label className="ocda-fecha">
          <span>Desde</span>
          <input
            type="date"
            value={desde}
            max={hasta || hoy}
            aria-invalid={errorRango ? true : undefined}
            onChange={(e) => e.target.value && setDesde(e.target.value)}
          />
        </label>
        <label className="ocda-fecha">
          <span>Hasta</span>
          <input
            type="date"
            value={hasta}
            min={desde}
            max={hoy}
            aria-invalid={errorRango ? true : undefined}
            onChange={(e) => e.target.value && setHasta(e.target.value)}
          />
        </label>
        <div className="ocda-filtros" role="group" aria-label="Vista" style={{ margin: 0 }}>
          {(['resumen', 'detalle'] as const).map((v) => (
            <button key={v} type="button" className="ocda-chip" aria-pressed={vista === v} onClick={() => setVista(v)}>
              {vista === v && <span aria-hidden="true">✓ </span>}
              {v === 'resumen' ? 'Por operador' : 'Detalle por día'}
            </button>
          ))}
        </div>
      </div>

      {vista === 'detalle' && (
        <div className="ocda-filtros" role="group" aria-label="Filtrar por estado">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="ocda-chip"
              aria-pressed={filtro === f.id}
              onClick={() => setFiltro(f.id)}
            >
              {filtro === f.id && <span aria-hidden="true">✓ </span>}
              {f.etiqueta} · {data ? conteo(f.id) : '…'}
            </button>
          ))}
        </div>
      )}

      {config.error && (
        <div className="banner error" role="alert">
          {mensajeError(config.error, 'No se pudo cargar la hora de entrada; no se puede cambiar por ahora.')}
        </div>
      )}
      {errorRango && (
        <div className="banner error" role="alert">
          {errorRango}
        </div>
      )}
      {isLoading && rango.success && <Cargando />}
      {error && (
        <div className="banner error" role="alert">
          {mensajeError(error, 'No se pudo cargar el reporte de atrasos.')}
        </div>
      )}
      {data && data.resumen.length === 0 && (
        <p className="muted">Aún no hay operadores. Impórtelos desde la pestaña Listado.</p>
      )}

      {data && data.resumen.length > 0 && vista === 'resumen' && (
        <div className="ocda-tabla" tabIndex={0} role="region" aria-label="Atrasos por operador">
          <table>
            <caption className="sr-only">
              Atrasos por operador del {data.desde} al {data.hasta}, ordenados de más a menos atrasos
            </caption>
            <thead>
              <tr>
                <th scope="col">Operador</th>
                <th scope="col">Cédula</th>
                <th scope="col">Puntuales</th>
                <th scope="col">Atrasos</th>
                <th scope="col">Faltas</th>
                <th scope="col">Min. de atraso</th>
              </tr>
            </thead>
            <tbody>
              {resumen.map((r) => (
                <tr key={r.operadorId}>
                  <th scope="row">{r.apellidosNombres}</th>
                  <td className="mono">{r.cedula}</td>
                  <td>{r.puntuales}</td>
                  <td>{r.atrasos > 0 ? <span className="ocda-estado aviso">{r.atrasos}</span> : 0}</td>
                  <td>{r.faltas > 0 ? <span className="ocda-estado error">{r.faltas}</span> : 0}</td>
                  <td>{r.minutosAtraso}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {resumen.length === 0 && <p className="ocda-pie">Ningún operador coincide con la búsqueda.</p>}
          <p className="ocda-pie">
            {resumen.length} de {data.resumen.length} operadores · del {data.desde} al {data.hasta}
          </p>
        </div>
      )}

      {data && data.resumen.length > 0 && vista === 'detalle' && (
        <div className="ocda-tabla" tabIndex={0} role="region" aria-label="Detalle de atrasos por día">
          <table>
            <caption className="sr-only">
              Detalle por día del {data.desde} al {data.hasta}: {filas.length} registro(s) con el filtro actual
            </caption>
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Operador</th>
                <th scope="col">Entrada</th>
                <th scope="col">Min. de atraso</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <FilaDetalle key={`${f.fecha}-${f.operadorId}`} fila={f} />
              ))}
            </tbody>
          </table>
          {filas.length === 0 && <p className="ocda-pie">Ningún registro con este filtro.</p>}
          <p className="ocda-pie">
            Mostrando {filas.length} de {data.filas.length} registros
          </p>
        </div>
      )}

      {configurando && config.data && (
        <ConfigHoraModal actual={config.data} onClose={() => setConfigurando(false)} />
      )}

      {exportando && (
        <ExportarReporteModal
          reporte="atrasos"
          desdeInicial={desde}
          hastaInicial={hasta}
          onClose={() => setExportando(false)}
        />
      )}
    </>
  );
}

function FilaDetalle({ fila: f }: { fila: FilaAtrasoCda }) {
  const e = ESTADO[f.estado];
  return (
    <tr>
      <td className="mono">{f.fecha}</td>
      <th scope="row">
        {f.apellidosNombres}
        <span className="sr-only"> · cédula {f.cedula}</span>
      </th>
      <td className="mono">{f.entrada ?? '—'}</td>
      <td>{f.estado === 'ATRASO' ? f.minutosAtraso : '—'}</td>
      <td>
        <span className={`ocda-estado ${e.clase}`}>{e.etiqueta}</span>
      </td>
    </tr>
  );
}

/** "08:00" + 10 → "08:10". */
function sumarMinutos(horaEntrada: string, minutos: number): string {
  const [h, m] = horaEntrada.split(':').map(Number);
  const total = (h * 60 + m + minutos) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function ConfigHoraModal({ actual, onClose }: { actual: ConfigAsistenciaCda; onClose: () => void }) {
  const qc = useQueryClient();
  const [hora, setHora] = useState(actual.horaEntrada);
  const [gracia, setGracia] = useState(String(actual.minutosGracia));
  const [errores, setErrores] = useState<{ hora?: string; gracia?: string }>({});

  const guardar = useMutation({
    mutationFn: guardarConfigAsistenciaCda,
    onSuccess: (c) => {
      qc.setQueryData(['asistencia-cda-config'], c);
      void qc.invalidateQueries({ queryKey: ['atrasos-cda'] });
      sileo.success({ title: `Hora de entrada: ${c.horaEntrada} con ${c.minutosGracia} min de gracia` });
      onClose();
    },
    onError: (e) => sileo.error({ title: mensajeError(e, 'No se pudo guardar la hora de entrada') }),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    const r = configAsistenciaCdaSchema.safeParse({
      horaEntrada: hora,
      minutosGracia: gracia.trim() === '' ? undefined : Number(gracia),
    });
    if (!r.success) {
      const campo = (c: string) => r.error.issues.find((i) => i.path[0] === c)?.message;
      setErrores({ hora: campo('horaEntrada'), gracia: campo('minutosGracia') });
      document.getElementById(campo('horaEntrada') ? 'cfg-hora' : 'cfg-gracia')?.focus();
      return;
    }
    setErrores({});
    guardar.mutate(r.data);
  }

  return (
    <Modal labelledBy="cfg-hora-titulo" onClose={onClose} maxWidth={480}>
      <form className="ocda-modal" onSubmit={enviar} noValidate aria-busy={guardar.isPending}>
        <div className="ocda-modal-cabecera">
          <div>
            <h2 id="cfg-hora-titulo">Hora de entrada</h2>
            <p className="muted">Se aplica a todos los operadores CDA y a todos los días del reporte.</p>
          </div>
          <button type="button" className="ocda-modal-cerrar" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>
        <div className="ocda-form">
          <Campo id="cfg-hora" etiqueta="Hora oficial de entrada" error={errores.hora} ancho={false}>
            <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
          </Campo>
          <Campo
            id="cfg-gracia"
            etiqueta="Minutos de gracia"
            error={errores.gracia}
            ayuda="Hasta este minuto cuenta como puntual."
            ancho={false}
          >
            <input type="number" inputMode="numeric" min={0} max={120} step={1} value={gracia} onChange={(e) => setGracia(e.target.value)} />
          </Campo>
        </div>
        <p className="ocda-enlace-aviso">
          Cambiarla recalcula también los días pasados del reporte. El cambio queda en la bitácora.
        </p>
        <div className="ocda-modal-acciones">
          <button type="button" className="btn secondary" onClick={onClose} disabled={guardar.isPending}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={guardar.isPending}>
            {guardar.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
