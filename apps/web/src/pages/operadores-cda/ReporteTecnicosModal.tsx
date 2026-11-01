import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SIN_TECNICO_PAREJAS_CDA } from '@cne/shared-validation';
import { Modal } from '../../components/Modal';
import { Cargando } from '../../components/Cargando';
import { getTecnicosParejasCda, pedirContactosTecnicosCda, pedirReporteTecnicosCda } from '../../lib/queries/operadores-cda';
import { useDescargaPdf } from '../../lib/useDescargaPdf';
import { mensajeError } from './utils';

const clave = (nombre: string | null) => nombre ?? SIN_TECNICO_PAREJAS_CDA;

/**
 * "Reporte por técnico": se marcan uno o varios técnicos del distributivo (y
 * "Sin técnico") y se baja en un solo archivo el Excel (una hoja por técnico),
 * el PDF o los contactos .vcf de sus parejas del día.
 */
export function ReporteTecnicosModal({ dia, onClose }: { dia: string; onClose: () => void }) {
  const { data: tecnicos, isLoading, error } = useQuery({
    queryKey: ['parejas-cda', 'tecnicos', dia],
    queryFn: () => getTecnicosParejasCda(dia),
  });
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const descarga = useDescargaPdf('No se pudo generar el archivo');
  const elegidos = (tecnicos ?? []).map((t) => clave(t.nombre)).filter((k) => marcados.has(k));
  const ninguno = elegidos.length === 0;

  const alternar = (k: string) =>
    setMarcados((prev) => {
      const s = new Set(prev);
      if (s.has(k)) s.delete(k);
      else s.add(k);
      return s;
    });

  const bajar = (formato: 'xlsx' | 'pdf' | 'vcf') =>
    void descarga.descargar(
      formato,
      () => (formato === 'vcf' ? pedirContactosTecnicosCda(dia, elegidos) : pedirReporteTecnicosCda(dia, elegidos, formato)),
      formato === 'vcf' ? `contactos_parejas_${dia}.vcf` : `parejas_por_tecnico_${dia}.${formato}`,
    );

  const boton = (formato: 'xlsx' | 'pdf' | 'vcf', texto: string, clase = 'btn secondary') => (
    <button
      type="button"
      className={clase}
      onClick={() => bajar(formato)}
      disabled={ninguno || !!descarga.descargando}
      aria-busy={descarga.descargando === formato}
      aria-describedby={ninguno ? 'reporte-tecnicos-ayuda' : undefined}
    >
      {descarga.descargando === formato ? 'Generando…' : texto}
    </button>
  );

  return (
    <Modal labelledBy="reporte-tecnicos-titulo" onClose={onClose} maxWidth={560}>
      <div className="login-card" style={{ width: '100%', maxWidth: 'none' }}>
        <h1 id="reporte-tecnicos-titulo">Reporte por técnico</h1>
        <p className="muted">
          Parejas del {dia} de cada técnico, según el distributivo del Drive: quién ingresa a la app (quien lleva el kit) y si al
          recinto van 1 o 2 parejas.
        </p>

        {isLoading && <Cargando />}
        {error && (
          <p className="banner error" role="alert">
            {mensajeError(error, 'No se pudo leer el distributivo de técnicos')}
          </p>
        )}

        {tecnicos?.length === 0 && <p className="muted">El distributivo de técnicos no tiene recintos.</p>}
        {tecnicos && tecnicos.length > 0 && (
          <fieldset style={{ border: 0, padding: 0, margin: '0 0 1rem' }}>
            <legend className="sr-only">Técnicos</legend>
            <div className="row" style={{ gap: '0.5rem', marginBottom: '0.5rem' }}>
              <button
                type="button"
                className="btn secondary"
                aria-label="Marcar todos los técnicos"
                onClick={() => setMarcados(new Set(tecnicos.map((t) => clave(t.nombre))))}
              >
                Marcar todos
              </button>
              <button type="button" className="btn secondary" aria-label="Desmarcar todos los técnicos" onClick={() => setMarcados(new Set())}>
                Ninguno
              </button>
            </div>
            {tecnicos.map((t) => {
              const k = clave(t.nombre);
              const id = `reporte-tecnico-${k.replace(/[^a-zA-Z0-9]/g, '-')}`;
              return (
                <div key={k} className="row" style={{ gap: '0.5rem', alignItems: 'center', minHeight: 44 }}>
                  <input id={id} type="checkbox" checked={marcados.has(k)} onChange={() => alternar(k)} />
                  <label htmlFor={id}>
                    {t.nombre ?? 'Sin técnico en el distributivo'} · {t.recintos} recintos · {t.parejas} parejas
                  </label>
                </div>
              );
            })}
          </fieldset>
        )}

        {/* Siempre presente: el lector de pantalla anuncia cuántos van marcados (los botones deshabilitados no toman foco). */}
        <p id="reporte-tecnicos-ayuda" className="muted" role="status">
          {ninguno ? 'Marque al menos un técnico.' : `${elegidos.length} marcado(s).`}
        </p>
        <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
          {boton('xlsx', 'Excel', 'btn')}
          {boton('pdf', 'PDF')}
          {boton('vcf', 'Contactos (.vcf)')}
          <button type="button" className="btn secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </Modal>
  );
}
