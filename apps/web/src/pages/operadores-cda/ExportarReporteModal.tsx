import { useState, type FormEvent } from 'react';
import type { FormatoReporteCda, ModoReporteCda } from '@cne/shared-types';
import {
  MAX_DIAS_REPORTE_PDF,
  MENSAJE_MAX_DIAS_PDF,
  diasDelRango,
  rangoAsistenciaSchema,
} from '@cne/shared-validation';
import { Modal } from '../../components/Modal';
import { useDescargaPdf } from '../../lib/useDescargaPdf';
import { nombreReporteCda, pedirReporteCda, type ReporteCda } from '../../lib/queries/operadores-cda';
import { Campo } from './Campo';
import { useGrupoCda } from './grupo';
import { hoyEcuador } from './utils';

type Opcion<T> = { valor: T; etiqueta: string; detalle: string };

const MODOS: Opcion<ModoReporteCda>[] = [
  { valor: 'GENERAL', etiqueta: 'General', detalle: 'Todo el rango en una sola tabla' },
  { valor: 'POR_DIA', etiqueta: 'Por día', detalle: 'Una hoja (Excel) o una sección (PDF) por cada día' },
];

const FORMATOS: Opcion<FormatoReporteCda>[] = [
  { valor: 'xlsx', etiqueta: 'Excel', detalle: 'Para filtrar y trabajar los datos' },
  { valor: 'pdf', etiqueta: 'PDF', detalle: `Para imprimir o adjuntar a un oficio (hasta ${MAX_DIAS_REPORTE_PDF} días)` },
];

const TITULO: Record<ReporteCda, string> = {
  asistencia: 'Exportar asistencia',
  atrasos: 'Exportar atrasos',
};

/** Grupo de opciones como tarjetas: radios nativos (teclado y lector de pantalla sin trabajo extra). */
function Opciones<T extends string>({
  nombre,
  leyenda,
  opciones,
  valor,
  onChange,
}: {
  nombre: string;
  leyenda: string;
  opciones: Opcion<T>[];
  valor: T;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="ocda-opciones ancho">
      <legend>{leyenda}</legend>
      {opciones.map((o) => (
        <label key={o.valor} className="ocda-opcion">
          <input
            type="radio"
            name={nombre}
            value={o.valor}
            checked={valor === o.valor}
            onChange={() => onChange(o.valor)}
            // Nombre = etiqueta y descripción = detalle: si no, el lector lee el detalle dos veces.
            aria-labelledby={`${nombre}-${o.valor}`}
            aria-describedby={`${nombre}-${o.valor}-detalle`}
          />
          <span>
            <strong id={`${nombre}-${o.valor}`}>{o.etiqueta}</strong>
            <span id={`${nombre}-${o.valor}-detalle`} className="ocda-form-ayuda">
              {o.detalle}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Rango, organización (general o una hoja por día) y formato (Excel o PDF) de
 * los reportes de Operadores o Asistentes CDA (un archivo por grupo, el que se
 * está viendo). Queda abierto tras descargar para poder bajar
 * también el otro formato.
 */
export function ExportarReporteModal({
  reporte,
  desdeInicial,
  hastaInicial,
  onClose,
}: {
  reporte: ReporteCda;
  desdeInicial: string;
  hastaInicial: string;
  onClose: () => void;
}) {
  const { grupo } = useGrupoCda();
  const [desde, setDesde] = useState(desdeInicial);
  const [hasta, setHasta] = useState(hastaInicial);
  const [modo, setModo] = useState<ModoReporteCda>('GENERAL');
  const [formato, setFormato] = useState<FormatoReporteCda>('xlsx');
  const [errores, setErrores] = useState<{ desde?: string; hasta?: string }>({});
  const { descargando, descargar } = useDescargaPdf('No se pudo generar el reporte');
  const hoy = hoyEcuador();

  function validar(): { desde?: string; hasta?: string } {
    if (hasta > hoy) return { hasta: 'La fecha final no puede ser futura' };
    const r = rangoAsistenciaSchema.safeParse({ desde, hasta });
    if (r.success) {
      return formato === 'pdf' && diasDelRango(desde, hasta) > MAX_DIAS_REPORTE_PDF ? { hasta: MENSAJE_MAX_DIAS_PDF } : {};
    }
    const errs: { desde?: string; hasta?: string } = {};
    for (const i of r.error.issues) {
      const campo = i.path[0] === 'desde' ? 'desde' : 'hasta';
      errs[campo] ??= i.message;
    }
    return errs;
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    const errs = validar();
    setErrores(errs);
    const conError = errs.desde ? 'desde' : errs.hasta ? 'hasta' : null;
    if (conError) {
      document.getElementById(`exportar-${conError}`)?.focus();
      return;
    }
    const o = { desde, hasta, modo, formato, grupo };
    void descargar('reporte', () => pedirReporteCda(reporte, o), nombreReporteCda(reporte, o));
  }

  const ocupado = descargando !== null;

  return (
    <Modal labelledBy="exportar-reporte-titulo" onClose={onClose} maxWidth={560}>
      <form className="ocda-modal" onSubmit={enviar} noValidate aria-busy={ocupado}>
        <div className="ocda-modal-cabecera">
          <span className="ocda-modal-icono" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <h2 id="exportar-reporte-titulo">{TITULO[reporte]}</h2>
            <p className="muted">Con el logo institucional, listo para imprimir.</p>
          </div>
          <button type="button" className="ocda-modal-cerrar" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        <div className="ocda-form">
          <Campo id="exportar-desde" etiqueta="Desde" error={errores.desde} ancho={false}>
            <input type="date" value={desde} max={hoy} onChange={(e) => setDesde(e.target.value)} />
          </Campo>
          <Campo id="exportar-hasta" etiqueta="Hasta" error={errores.hasta} ancho={false}>
            <input type="date" value={hasta} max={hoy} onChange={(e) => setHasta(e.target.value)} />
          </Campo>
          <Opciones nombre="exportar-modo" leyenda="Organización" opciones={MODOS} valor={modo} onChange={setModo} />
          <Opciones nombre="exportar-formato" leyenda="Formato" opciones={FORMATOS} valor={formato} onChange={setFormato} />
        </div>

        <p role="status" className="sr-only">
          {ocupado ? 'Generando reporte…' : ''}
        </p>

        <div className="ocda-modal-acciones">
          <button type="button" className="btn secondary" onClick={onClose}>
            Cerrar
          </button>
          <button type="submit" className="btn" disabled={ocupado}>
            {ocupado ? 'Generando…' : `Descargar ${formato === 'pdf' ? 'PDF' : 'Excel'}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
