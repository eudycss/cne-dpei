import { useDeferredValue, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { EstadoCertificadoEvatics, FilaEvatics } from '@cne/shared-types';
import { configEvaticsSchema, type FiltrosEvaticsInput } from '@cne/shared-validation';
import { useAuth } from '../../auth/AuthContext';
import { useModulos } from '../../lib/useModulos';
import { Cargando } from '../../components/Cargando';
import { Modal } from '../../components/Modal';
import { SearchInput } from '../../components/SearchInput';
import { getEvatics, guardarConfigEvatics } from '../../lib/queries/evatics';
import { AccionesEncabezado } from './AccionesEncabezado';
import { AvanceEvatics, pct } from './AvanceEvatics';
import { Campo } from './Campo';
import { Kpi } from './Kpi';
import { RevisarEvaticsModal, sugerenciaIa } from './RevisarEvaticsModal';
import { fechaLarga, mensajeError } from './utils';

/** Pendiente en ámbar (no en cian): el mismo color que su tramo en el gráfico. */
const ESTADO: Record<EstadoCertificadoEvatics, { etiqueta: string; clase: string }> = {
  SIN_SUBIR: { etiqueta: 'Sin subir', clase: 'vacio' },
  PENDIENTE: { etiqueta: 'En revisión', clase: 'aviso' },
  APROBADO: { etiqueta: 'Aprobado', clase: 'ok' },
  RECHAZADO: { etiqueta: 'Rechazado', clase: 'error' },
};

type Filtros = Required<Omit<FiltrosEvaticsInput, 'estado'>> & { estado: EstadoCertificadoEvatics | '' };
const SIN_FILTROS: Filtros = { canton: '', cargo: '', tecnico: '', estado: '', q: '' };

const FILTROS_ESTADO: { id: EstadoCertificadoEvatics | ''; etiqueta: string }[] = [
  { id: '', etiqueta: 'Todos' },
  { id: 'PENDIENTE', etiqueta: 'En revisión' },
  { id: 'SIN_SUBIR', etiqueta: 'Sin subir' },
  { id: 'RECHAZADO', etiqueta: 'Rechazados' },
  { id: 'APROBADO', etiqueta: 'Aprobados' },
];

/** Igual que la API (DIAS_RETENCION_EVATICS): lo promete el aviso LOPDP de la página pública. */
const DIAS_RETENCION = 90;
const sumarDias = (dia: string, dias: number) => {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

export const rutaPublicaEvatics = () => `${window.location.origin}/evatics`;

function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-EC', {
    timeZone: 'America/Guayaquil',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

/**
 * Certificados Evatics de todo el personal CDA, CPE y Asistentes Transversales
 * (no depende del cargo elegido arriba). "Hechos" = aprobados por un
 * supervisor; la IA solo sugiere. Los filtros los aplica la API; los
 * conteos y el gráfico son siempre de todo el personal.
 */
export function EvaticsPanel({ acciones = null }: { acciones?: HTMLElement | null }) {
  const { user } = useAuth();
  const isAdmin = user?.roles.includes('ADMINISTRADOR') ?? false;
  const { puede } = useModulos();
  const puedeRevisar = puede('cda.evatics.revisar');
  const [filtros, setFiltros] = useState<Filtros>(SIN_FILTROS);
  const q = useDeferredValue(filtros.q.trim());
  const [revisando, setRevisando] = useState<FilaEvatics | null>(null);
  const [fechaAbierta, setFechaAbierta] = useState(false);

  const consulta = { ...filtros, q, estado: filtros.estado || undefined };
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['evatics', consulta],
    queryFn: () => getEvatics(consulta),
    placeholderData: (previo) => previo,
  });
  const cambiar = (c: Partial<typeof filtros>) => setFiltros((f) => ({ ...f, ...c }));

  async function copiarEnlace() {
    try {
      await navigator.clipboard.writeText(rutaPublicaEvatics());
      sileo.success({ title: 'Enlace copiado: envíelo al personal por WhatsApp o correo' });
    } catch {
      sileo.error({ title: `No se pudo copiar. El enlace es ${rutaPublicaEvatics()}` });
    }
  }

  const t = data?.totales;
  const hayFiltro = Boolean(filtros.canton || filtros.cargo || filtros.tecnico || filtros.estado || q);
  return (
    <>
      <AccionesEncabezado destino={acciones}>
        <button type="button" className="btn secondary" onClick={copiarEnlace}>
          Copiar enlace público
        </button>
        {isAdmin && (
          <button type="button" className="btn" disabled={!data} onClick={() => setFechaAbierta(true)}>
            Fecha límite
          </button>
        )}
      </AccionesEncabezado>

      {data && (
        <div className={`banner${data.plazoVencido ? ' error' : ''}`} role="status">
          {data.fechaLimite
            ? data.plazoVencido
              ? `El plazo terminó el ${fechaLarga(data.fechaLimite)}: ya no se pueden subir certificados.`
              : `El personal puede subir su certificado hasta el ${fechaLarga(data.fechaLimite)}.`
            : 'Sin fecha límite: el personal puede subir su certificado en cualquier momento.'}{' '}
          Enlace: <span className="mono">{rutaPublicaEvatics()}</span>
        </div>
      )}
      {data && !data.analisisDisponible && (
        <div className="banner error" role="status">
          La lectura automática del nombre no está activa (falta la llave de Gemini o Groq en el servidor): revise
          cada certificado a ojo.
        </div>
      )}
      {data && !data.distributivoDisponible && (
        <div className="banner error" role="status">
          No se pudo leer el distributivo del Drive: los asistentes aparecen como “CPE” hasta que se recupere.
        </div>
      )}

      {t && (
        <div className="ocda-kpis" role="group" aria-label="Resumen de certificados">
          <Kpi
            etiqueta="Hechos (aprobados)"
            valor={`${t.aprobados} de ${t.total}`}
            parte={t.aprobados}
            total={t.total}
            detalle={`${pct(t.aprobados, t.total)} % del personal`}
          />
          <Kpi
            etiqueta="Por revisar"
            valor={String(t.pendientes)}
            parte={t.pendientes}
            total={t.total}
            detalle={t.pendientes > 0 ? 'Esperan la revisión de un supervisor' : 'Nada pendiente'}
          />
          <Kpi
            etiqueta="Rechazados"
            valor={String(t.rechazados)}
            parte={t.rechazados}
            total={t.total}
            detalle="Deben subir otra foto"
          />
          <Kpi
            etiqueta="Sin subir"
            valor={String(t.sinSubir)}
            parte={t.sinSubir}
            total={t.total}
            detalle={`${pct(t.sinSubir, t.total)} % aún no lo sube`}
          />
        </div>
      )}

      {data && (
        <AvanceEvatics
          porCanton={data.porCanton}
          porTecnico={data.porTecnico}
          seleccionado={{ canton: filtros.canton, tecnico: filtros.tecnico }}
          onElegir={(vista, nombre) => cambiar(vista === 'canton' ? { canton: nombre } : { tecnico: nombre })}
        />
      )}

      <div className="ocda-filtros">
        <span className="ocda-campo" style={{ flex: '1 1 260px', maxWidth: 360 }}>
          <SearchInput
            value={filtros.q}
            onChange={(v) => cambiar({ q: v })}
            placeholder="Buscar por nombre o cédula…"
            ariaLabel="Buscar persona por nombre o cédula"
          />
        </span>
        <label className="ocda-fecha">
          <span>Cantón</span>
          <select value={filtros.canton} onChange={(e) => cambiar({ canton: e.target.value })}>
            <option value="">Todos</option>
            {data?.porCanton.map((g) => (
              <option key={g.nombre} value={g.nombre}>
                {g.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="ocda-fecha">
          <span>Cargo</span>
          <select value={filtros.cargo} onChange={(e) => cambiar({ cargo: e.target.value })}>
            <option value="">Todos</option>
            {data?.cargos.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="ocda-fecha">
          <span>Asistente</span>
          <select value={filtros.tecnico} onChange={(e) => cambiar({ tecnico: e.target.value })}>
            <option value="">Todos</option>
            {data?.porTecnico.map((g) => (
              <option key={g.nombre} value={g.nombre}>
                {g.nombre}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="ocda-filtros" role="group" aria-label="Filtrar por estado">
        {FILTROS_ESTADO.map((f) => (
          <button
            key={f.id || 'todos'}
            type="button"
            className="ocda-chip"
            aria-pressed={filtros.estado === f.id}
            onClick={() => cambiar({ estado: f.id })}
          >
            {filtros.estado === f.id && <span aria-hidden="true">✓ </span>}
            {f.etiqueta}
          </button>
        ))}
        {hayFiltro && (
          <button
            type="button"
            className="ocda-btn-texto"
            onClick={() => setFiltros(SIN_FILTROS)}
          >
            Quitar filtros
          </button>
        )}
      </div>

      {isLoading && <Cargando />}
      {error && (
        <div className="banner error" role="alert">
          {mensajeError(error, 'No se pudo cargar los certificados.')}
        </div>
      )}

      {data && (
        <div
          className="ocda-tabla"
          tabIndex={0}
          role="region"
          aria-label="Certificados Evatics del personal"
          aria-busy={isFetching}
        >
          <table>
            <caption className="sr-only">
              Certificados Evatics: {data.filas.length} persona(s) con los filtros actuales
            </caption>
            <thead>
              <tr>
                <th scope="col">Persona</th>
                <th scope="col">Cargo</th>
                <th scope="col">Cantón</th>
                <th scope="col">Asistente</th>
                <th scope="col">Estado</th>
                <th scope="col">IA sugiere</th>
                <th scope="col">Subido</th>
                {puedeRevisar && <th scope="col">Acción</th>}
              </tr>
            </thead>
            <tbody>
              {data.filas.map((f) => (
                <Fila key={f.cedula} fila={f} puedeRevisar={puedeRevisar} onRevisar={() => setRevisando(f)} />
              ))}
            </tbody>
          </table>
          {data.filas.length === 0 && <p className="ocda-pie">Nadie coincide con los filtros.</p>}
          <p className="ocda-pie">
            {data.filas.length} de {data.totales.total} personas
          </p>
        </div>
      )}

      {revisando && <RevisarEvaticsModal fila={revisando} onClose={() => setRevisando(null)} />}
      {fechaAbierta && data && <FechaLimiteModal actual={data.fechaLimite} onClose={() => setFechaAbierta(false)} />}
    </>
  );
}

function Fila({
  fila: f,
  puedeRevisar,
  onRevisar,
}: {
  fila: FilaEvatics;
  puedeRevisar: boolean;
  onRevisar: () => void;
}) {
  const e = ESTADO[f.estado];
  const ia = f.certificadoId ? sugerenciaIa(f.analisis) : null;
  const accion = f.estado === 'PENDIENTE' && !f.esPropio ? 'Revisar' : 'Ver';
  return (
    <tr>
      <th scope="row">
        {f.apellidosNombres}
        <span className="mono muted evx-cedula">{f.cedula}</span>
      </th>
      <td>{f.cargo}</td>
      <td>{f.canton}</td>
      <td>{f.tecnico}</td>
      <td>
        <span className={`ocda-estado ${e.clase}`}>{e.etiqueta}</span>
        {f.estado === 'RECHAZADO' && f.motivoRechazo && <span className="evx-motivo">{f.motivoRechazo}</span>}
        {f.reemplazos > 0 && (
          <span className="evx-motivo">
            Reemplazada {f.reemplazos} {f.reemplazos === 1 ? 'vez' : 'veces'}
          </span>
        )}
      </td>
      <td>{ia ? <span className={`ocda-estado ${ia.clase}`}>{ia.texto}</span> : '—'}</td>
      <td className="mono">{f.subidoEn ? fechaHora(f.subidoEn) : '—'}</td>
      {puedeRevisar && (
        <td>
          {f.certificadoId && f.subidoEn ? (
            <button
              type="button"
              className="ocda-btn-texto"
              onClick={onRevisar}
              aria-label={`${accion} certificado de ${f.apellidosNombres}`}
            >
              {accion}
            </button>
          ) : (
            '—'
          )}
        </td>
      )}
    </tr>
  );
}

function FechaLimiteModal({ actual, onClose }: { actual: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [fecha, setFecha] = useState(actual ?? '');
  const [error, setError] = useState<string | undefined>();

  const guardar = useMutation({
    mutationFn: guardarConfigEvatics,
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['evatics'] });
      sileo.success({ title: c.fechaLimite ? `Fecha límite: ${fechaLarga(c.fechaLimite)}` : 'Sin fecha límite' });
      onClose();
    },
    onError: (e) => sileo.error({ title: mensajeError(e, 'No se pudo guardar la fecha límite') }),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    const r = configEvaticsSchema.safeParse({ fechaLimite: fecha || null });
    if (!r.success) {
      setError(r.error.issues[0]?.message ?? 'Fecha inválida');
      document.getElementById('evx-fecha')?.focus();
      return;
    }
    setError(undefined);
    guardar.mutate(r.data.fechaLimite);
  }

  return (
    <Modal labelledBy="evx-fecha-titulo" onClose={onClose} maxWidth={480}>
      <form className="ocda-modal" onSubmit={enviar} noValidate aria-busy={guardar.isPending}>
        <div className="ocda-modal-cabecera">
          <div>
            <h2 id="evx-fecha-titulo">Fecha límite</h2>
            <p className="muted">Último día en que el personal puede subir su certificado (hora de Ecuador).</p>
          </div>
          <button type="button" className="ocda-modal-cerrar" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>
        <div className="ocda-form">
          <Campo
            id="evx-fecha"
            etiqueta="Último día para subir"
            error={error}
            ayuda="Déjela vacía para no poner plazo."
            ancho={false}
            requerido={false}
          >
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </Campo>
        </div>
        <p className="ocda-enlace-aviso" aria-live="polite">
          {fecha
            ? `Las fotos y los datos se borrarán solos desde el ${fechaLarga(sumarDias(fecha, DIAS_RETENCION + 1))}.`
            : `Sin plazo, cada foto se borra ${DIAS_RETENCION} días después de subirla.`}{' '}
          El cambio se aplica en seguida a la página pública y queda en la bitácora.
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
