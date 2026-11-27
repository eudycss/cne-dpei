import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CentroCda, FormatoReporteCda, GrupoCda, ModoReportePersonalCda } from '@cne/shared-types';
import { Modal } from '../../components/Modal';
import { useDescargaPdf } from '../../lib/useDescargaPdf';
import { getCargosCda, nombreReportePersonalCda, pedirReportePersonalCda } from '../../lib/queries/operadores-cda';
import { Opciones, type Opcion } from './ExportarReporteModal';
import { hoyEcuador } from './utils';

const CENTROS: CentroCda[] = ['CDA', 'CPE'];

const MODOS: Opcion<ModoReportePersonalCda>[] = [
  { valor: 'GENERAL', etiqueta: 'General', detalle: 'Todo el personal en una sola tabla' },
  { valor: 'POR_CARGO', etiqueta: 'Por cargo', detalle: 'Una hoja (Excel) o una sección (PDF) por cada cargo' },
];

const FORMATOS: Opcion<FormatoReporteCda>[] = [
  { valor: 'xlsx', etiqueta: 'Excel', detalle: 'Para filtrar y trabajar los datos' },
  { valor: 'pdf', etiqueta: 'PDF', detalle: 'Para imprimir o adjuntar a un oficio' },
];

/**
 * Reporte del personal CDA/CPE activo: se elige el centro, uno, varios o todos
 * sus cargos activos, la organización (general o por cargo) y el formato.
 * Empieza con el cargo que se está viendo; queda abierta tras descargar.
 */
export function ReportePersonalModal({ grupoInicial, onClose }: { grupoInicial: GrupoCda; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['cargos-cda'], queryFn: getCargosCda, staleTime: 5 * 60_000 });
  const activos = (data ?? []).filter((c) => c.activo).sort((a, b) => a.orden - b.orden);
  const [centros, setCentros] = useState<CentroCda[]>([]);
  const [cargos, setCargos] = useState<GrupoCda[]>([]);
  const [modo, setModo] = useState<ModoReportePersonalCda>('GENERAL');
  const [formato, setFormato] = useState<FormatoReporteCda>('xlsx');
  const [aviso, setAviso] = useState<string | null>(null);
  const avisoRef = useRef<HTMLParagraphElement>(null);
  const { descargando, descargar } = useDescargaPdf('No se pudo generar el reporte');
  const iniciado = useRef(false);

  // Al llegar los cargos: el centro y el cargo que se estaban viendo, ya marcados.
  useEffect(() => {
    if (iniciado.current || !data) return;
    iniciado.current = true;
    const actual = data.find((c) => c.clave === grupoInicial && c.activo);
    if (actual) {
      setCentros([actual.centro]);
      setCargos([actual.clave]);
    }
  }, [data, grupoInicial]);

  const visibles = activos.filter((c) => centros.includes(c.centro));
  const marcados = visibles.filter((c) => cargos.includes(c.clave)).length;
  const todos = visibles.length > 0 && marcados === visibles.length;
  const todosRef = useRef<HTMLInputElement>(null);
  // Selección parcial: "Todos los cargos" a medio marcar (lo anuncia el lector de pantalla).
  useEffect(() => {
    if (todosRef.current) todosRef.current.indeterminate = marcados > 0 && !todos;
  });

  function alternarCentro(centro: CentroCda) {
    setAviso(null);
    if (centros.includes(centro)) {
      setCentros(centros.filter((c) => c !== centro));
      // Al quitar un centro se quitan sus cargos: nunca se descarga algo que no se ve.
      const delCentro = new Set(activos.filter((c) => c.centro === centro).map((c) => c.clave));
      setCargos(cargos.filter((c) => !delCentro.has(c)));
    } else {
      setCentros([...centros, centro]);
    }
  }

  function alternarCargo(clave: GrupoCda) {
    setAviso(null);
    setCargos(cargos.includes(clave) ? cargos.filter((c) => c !== clave) : [...cargos, clave]);
  }

  function alternarTodos() {
    setAviso(null);
    setCargos(todos ? [] : visibles.map((c) => c.clave));
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    const elegidos = visibles.filter((c) => cargos.includes(c.clave)).map((c) => c.clave);
    if (elegidos.length === 0) {
      setAviso(centros.length === 0 ? 'Elija CDA, CPE o ambos.' : 'Elija al menos un cargo.');
      avisoRef.current?.focus();
      return;
    }
    const o = { cargos: elegidos, modo, formato };
    const centrosElegidos = CENTROS.filter((c) => visibles.some((v) => v.centro === c && elegidos.includes(v.clave)));
    void descargar('reporte', () => pedirReportePersonalCda(o), nombreReportePersonalCda(centrosElegidos, o, hoyEcuador()));
  }

  const ocupado = descargando !== null;

  return (
    <Modal labelledBy="reporte-personal-titulo" onClose={onClose} maxWidth={620}>
      <form className="ocda-modal" onSubmit={enviar} noValidate aria-busy={ocupado}>
        <div className="ocda-modal-cabecera">
          <span className="ocda-modal-icono" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <h2 id="reporte-personal-titulo">Reporte del personal</h2>
            <p className="muted">Personal activo, con el logo institucional y un resumen por cargo.</p>
          </div>
          <button type="button" className="ocda-modal-cerrar" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        {isLoading && <p className="muted">Cargando cargos…</p>}
        {error && (
          <p className="banner error" role="alert">
            No se pudieron cargar los cargos.
          </p>
        )}

        {data && (
          <div className="ocda-form">
            <fieldset className="ocda-opciones ancho">
              <legend>Centro</legend>
              {CENTROS.map((c) => (
                <label key={c} className="ocda-opcion">
                  <input type="checkbox" checked={centros.includes(c)} onChange={() => alternarCentro(c)} />
                  <span>
                    <strong>{c}</strong>
                  </span>
                </label>
              ))}
            </fieldset>

            {centros.length > 0 && (
              <fieldset className="ocda-opciones ancho">
                <legend>Cargos</legend>
                {visibles.length === 0 && <p className="muted">No hay cargos activos en este centro.</p>}
                {visibles.length > 1 && (
                  <label className="ocda-opcion">
                    <input ref={todosRef} type="checkbox" checked={todos} onChange={alternarTodos} />
                    <span>
                      <strong>Todos los cargos</strong>
                    </span>
                  </label>
                )}
                {visibles.map((c) => (
                  <label key={c.clave} className="ocda-opcion">
                    <input
                      type="checkbox"
                      checked={cargos.includes(c.clave)}
                      onChange={() => alternarCargo(c.clave)}
                      aria-labelledby={`reporte-personal-${c.clave}`}
                      aria-describedby={`reporte-personal-${c.clave}-detalle`}
                    />
                    <span>
                      <strong id={`reporte-personal-${c.clave}`}>{c.nombre}</strong>
                      <span id={`reporte-personal-${c.clave}-detalle`} className="ocda-form-ayuda">
                        {c.centro} · {c.personas} {c.personas === 1 ? 'persona' : 'personas'}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}

            <Opciones nombre="reporte-personal-modo" leyenda="Organización" opciones={MODOS} valor={modo} onChange={setModo} />
            <Opciones nombre="reporte-personal-formato" leyenda="Formato" opciones={FORMATOS} valor={formato} onChange={setFormato} />
          </div>
        )}

        <p ref={avisoRef} tabIndex={-1} role="alert" className={aviso ? 'banner error' : 'sr-only'}>
          {aviso ?? ''}
        </p>
        <p role="status" className="sr-only">
          {ocupado
            ? 'Generando reporte…'
            : centros.length > 0 && data
              ? `${visibles.length} ${visibles.length === 1 ? 'cargo' : 'cargos'} para elegir, ${marcados} ${marcados === 1 ? 'marcado' : 'marcados'}`
              : ''}
        </p>

        <div className="ocda-modal-acciones">
          <button type="button" className="btn secondary" onClick={onClose}>
            Cerrar
          </button>
          <button type="submit" className="btn" disabled={ocupado || !data}>
            {ocupado ? 'Generando…' : `Descargar ${formato === 'pdf' ? 'PDF' : 'Excel'}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
