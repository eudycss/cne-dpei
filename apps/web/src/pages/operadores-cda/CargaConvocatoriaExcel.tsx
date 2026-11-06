import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { CargaConvocatoriaCdaResult, EstadoFilaConvocatoriaCda } from '@cne/shared-types';
import { Modal } from '../../components/Modal';
import { cargarConvocatoriaCda, descargarPlantillaConvocatoriaCda } from '../../lib/queries/operadores-cda';
import { mensajeError } from './utils';

const ETIQUETA: Record<EstadoFilaConvocatoriaCda, string> = {
  NUEVA: 'Se convoca',
  YA_CONVOCADA: 'Ya estaba',
  EN_PAREJAS: 'En Parejas',
  ERROR: 'Error',
};
const CLASE: Record<EstadoFilaConvocatoriaCda, string> = {
  NUEVA: 'ok',
  YA_CONVOCADA: 'vacio',
  EN_PAREJAS: 'pendiente',
  ERROR: 'error',
};

/** "2026-11-05" → "05/11/2026". */
const fechaCorta = (dia: string) => dia.split('-').reverse().join('/');

/**
 * Excel de convocatoria (Fecha + Cédula): vista previa por fila y por fecha
 * (convocados, vinieron, sin entrada) antes de guardar. Solo agrega
 * convocados. `fecha`: el día de la pantalla, para filas sin Fecha.
 */
export function CargaConvocatoriaExcel({ fecha }: { fecha: string }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<CargaConvocatoriaCdaResult | null>(null);
  const [ocupado, setOcupado] = useState<'plantilla' | 'revisar' | 'guardar' | null>(null);

  async function plantilla() {
    setOcupado('plantilla');
    try {
      const blob = await descargarPlantillaConvocatoriaCda();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'plantilla_convocatoria.xlsx';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      sileo.error({ title: mensajeError(e, 'No se pudo descargar la plantilla') });
    } finally {
      setOcupado(null);
    }
  }

  async function revisar(file: File) {
    setOcupado('revisar');
    try {
      setPrevia(await cargarConvocatoriaCda(file, fecha, false));
      setArchivo(file);
    } catch (e) {
      sileo.error({ title: mensajeError(e, 'No se pudo leer el archivo') });
    } finally {
      setOcupado(null);
    }
  }

  async function guardar() {
    if (!archivo) return;
    setOcupado('guardar');
    try {
      const r = await cargarConvocatoriaCda(archivo, fecha, true);
      // Cambia quién puede tener falta en esas fechas.
      qc.invalidateQueries({ queryKey: ['convocatoria-cda'] });
      qc.invalidateQueries({ queryKey: ['asistencia-cda'] });
      qc.invalidateQueries({ queryKey: ['atrasos-cda'] });
      sileo.success({
        title: `${r.nuevas} persona${r.nuevas === 1 ? '' : 's'} convocada${r.nuevas === 1 ? '' : 's'}`,
        description: r.errores > 0 ? `${r.errores} fila${r.errores === 1 ? '' : 's'} con error no se cargaron.` : undefined,
      });
      cerrar();
    } catch (e) {
      sileo.error({ title: mensajeError(e, 'No se pudo guardar la convocatoria') });
    } finally {
      setOcupado(null);
    }
  }

  function cerrar() {
    setPrevia(null);
    setArchivo(null);
  }

  const filas = previa ? [...previa.filas].sort((a, b) => (a.estado === 'ERROR' ? 0 : 1) - (b.estado === 'ERROR' ? 0 : 1) || a.fila - b.fila) : [];

  return (
    <>
      <button type="button" className="btn secondary" disabled={ocupado !== null} onClick={plantilla}>
        <span aria-hidden="true">↓ </span>Plantilla
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.csv"
        style={{ display: 'none' }}
        aria-label="Archivo Excel de la convocatoria"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void revisar(file);
        }}
      />
      <button type="button" className="btn secondary" disabled={ocupado !== null} onClick={() => inputRef.current?.click()}>
        {ocupado === 'revisar' ? 'Revisando…' : <><span aria-hidden="true">↑ </span>Cargar Excel</>}
      </button>

      {previa && (
        <Modal labelledBy="carga-convocatoria-titulo" onClose={cerrar} maxWidth={860}>
          <div className="login-card" style={{ width: '100%', maxWidth: 'none' }} aria-busy={ocupado === 'guardar'}>
            <h1 id="carga-convocatoria-titulo">Revisar convocatoria antes de guardar</h1>
            <p role="status">
              {previa.nuevas > 0 ? (
                <>
                  Se convocará a <strong>{previa.nuevas}</strong> persona{previa.nuevas === 1 ? '' : 's'}.
                </>
              ) : (
                'No hay personas nuevas para convocar.'
              )}
              {previa.errores > 0 && (
                <>
                  {' '}
                  <strong>{previa.errores}</strong> fila{previa.errores === 1 ? '' : 's'} con error no se cargará
                  {previa.errores === 1 ? '' : 'n'}.
                </>
              )}
            </p>

            {previa.fechas.length > 0 && (
              <table>
                <caption style={{ textAlign: 'left', fontWeight: 600 }}>Cómo queda cada día (con este archivo)</caption>
                <thead>
                  <tr>
                    <th scope="col">Fecha</th>
                    <th scope="col">Convocados</th>
                    <th scope="col">Vinieron</th>
                    <th scope="col">Sin entrada (falta)</th>
                  </tr>
                </thead>
                <tbody>
                  {previa.fechas.map((f) => (
                    <tr key={f.fecha}>
                      <th scope="row" className="mono">
                        {fechaCorta(f.fecha)}
                      </th>
                      <td>{f.convocados}</td>
                      <td>{f.vinieron}</td>
                      <td>{f.sinEntrada > 0 ? <span className="ocda-estado error">{f.sinEntrada}</span> : 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div
              style={{ maxHeight: '45vh', overflowY: 'auto', marginTop: '0.75rem' }}
              tabIndex={0}
              role="region"
              aria-label="Filas del archivo"
            >
              <table>
                <caption className="sr-only">Filas del archivo y qué pasa con cada una</caption>
                <thead>
                  <tr>
                    <th scope="col">Fila</th>
                    <th scope="col">Fecha</th>
                    <th scope="col">Cédula</th>
                    <th scope="col">Persona</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => (
                    <tr key={f.fila}>
                      <td>{f.fila}</td>
                      <td className="mono">{f.fecha ? fechaCorta(f.fecha) : '—'}</td>
                      <td className="mono">{f.cedula ?? '—'}</td>
                      <td>{f.apellidosNombres ?? '—'}</td>
                      <td>
                        <span className={`ocda-estado ${CLASE[f.estado]}`}>{ETIQUETA[f.estado]}</span>
                      </td>
                      <td style={{ fontSize: '0.82rem' }}>{f.mensaje ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
              <button type="button" className="btn secondary" onClick={cerrar} disabled={ocupado === 'guardar'}>
                Cancelar
              </button>
              <button type="button" className="btn" onClick={guardar} disabled={previa.nuevas === 0 || ocupado === 'guardar'}>
                {ocupado === 'guardar' ? 'Guardando…' : `Convocar a ${previa.nuevas}`}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
