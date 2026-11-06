import { useRef, useState } from 'react';
import { sileo } from 'sileo';
import type { CargaMochilasResult, EstadoFilaMochila } from '@cne/shared-types';
import { Modal } from '../../components/Modal';
import { cargarMochilas, downloadMochilasPlantilla, downloadMochilasReporte } from '../../lib/queries/kits';
import { mensajeError } from '../operadores-cda/utils';

function descargar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  // Diferido: algunos navegadores aún no empezaron la descarga al volver de click().
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const ETIQUETA_ESTADO: Record<EstadoFilaMochila, string> = {
  NUEVA: 'Nueva',
  CAMBIA: 'Cambia',
  IGUAL: 'Sin cambios',
  ERROR: 'Error',
};
const CLASE_ESTADO: Record<EstadoFilaMochila, string> = {
  NUEVA: 'badge',
  CAMBIA: 'badge warn',
  IGUAL: 'badge',
  ERROR: 'badge error',
};

/**
 * Botones del N.º de mochila en la página de kits: plantilla, carga con vista
 * previa (nada se guarda hasta confirmar) y reporte Excel del evento.
 */
export function MochilasKitPanel({ eventoId, isAdmin, onCargado }: { eventoId: string; isAdmin: boolean; onCargado: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<CargaMochilasResult | null>(null);
  const [ocupado, setOcupado] = useState<'plantilla' | 'reporte' | 'revisar' | 'guardar' | null>(null);

  async function bajar(tipo: 'plantilla' | 'reporte') {
    setOcupado(tipo);
    try {
      if (tipo === 'plantilla') descargar((await downloadMochilasPlantilla()).data, 'plantilla_mochilas.xlsx');
      else descargar((await downloadMochilasReporte(eventoId)).data, 'mochilas_kits.xlsx');
    } catch (e) {
      sileo.error({ title: mensajeError(e, tipo === 'plantilla' ? 'No se pudo descargar la plantilla' : 'No se pudo generar el reporte') });
    } finally {
      setOcupado(null);
    }
  }

  async function revisar(file: File) {
    setOcupado('revisar');
    try {
      setPrevia((await cargarMochilas(eventoId, file, false)).data);
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
      const r = (await cargarMochilas(eventoId, archivo, true)).data;
      sileo.success({
        title: `${r.guardadas} N.º de mochila guardado${r.guardadas === 1 ? '' : 's'}`,
        description: r.errores > 0 ? `${r.errores} fila${r.errores === 1 ? '' : 's'} con error no se guardaron.` : undefined,
      });
      cerrar();
      onCargado();
    } catch (e) {
      sileo.error({ title: mensajeError(e, 'No se pudieron guardar las mochilas') });
    } finally {
      setOcupado(null);
    }
  }

  function cerrar() {
    setPrevia(null);
    setArchivo(null);
  }

  return (
    <>
      {isAdmin && (
        <>
          <button className="btn secondary" disabled={ocupado !== null} onClick={() => bajar('plantilla')}>
            <span aria-hidden="true">↓ </span>Plantilla mochilas
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.csv"
            style={{ display: 'none' }}
            aria-label="Archivo de N.º de mochila"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void revisar(file);
            }}
          />
          <button className="btn secondary" disabled={ocupado !== null} onClick={() => inputRef.current?.click()}>
            {ocupado === 'revisar' ? 'Revisando…' : <><span aria-hidden="true">↑ </span>Cargar mochilas</>}
          </button>
        </>
      )}
      <button className="btn secondary" disabled={ocupado !== null} onClick={() => bajar('reporte')}>
        {ocupado === 'reporte' ? 'Generando…' : <><span aria-hidden="true">↓ </span>Reporte mochilas</>}
      </button>

      {previa && (
        <Modal labelledBy="mochilas-previa-titulo" onClose={cerrar} maxWidth={820}>
          <div className="login-card" style={{ width: '100%', maxWidth: 'none' }} aria-busy={ocupado === 'guardar'}>
            <h1 id="mochilas-previa-titulo">Revisar mochilas antes de guardar</h1>
            <p role="status">
              {previa.guardadas > 0 ? (
                <>
                  Se guardarán <strong>{previa.guardadas}</strong> N.º de mochila.
                </>
              ) : (
                'No hay números nuevos ni cambios para guardar.'
              )}
              {previa.errores > 0 && (
                <>
                  {' '}
                  <strong>{previa.errores}</strong> fila{previa.errores === 1 ? '' : 's'} con error no se guardará
                  {previa.errores === 1 ? '' : 'n'}: corríjala{previa.errores === 1 ? '' : 's'} en el archivo y vuelva a cargarlo, o cámbiela
                  {previa.errores === 1 ? '' : 's'} en la tabla.
                </>
              )}
            </p>
            <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
              <table>
                <caption className="sr-only">Filas del archivo y qué pasará con cada una</caption>
                <thead>
                  <tr>
                    <th scope="col">Fila</th>
                    <th scope="col">Recinto</th>
                    <th scope="col">Código QR</th>
                    <th scope="col">N.º mochila</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {[...previa.filas]
                    .sort((a, b) => (a.estado === 'ERROR' ? 0 : 1) - (b.estado === 'ERROR' ? 0 : 1) || a.fila - b.fila)
                    .map((f) => (
                      <tr key={f.fila}>
                        <td>{f.fila}</td>
                        <td>
                          {f.codigoRecinto ?? '—'}
                          {f.nombreRecinto && <div className="muted" style={{ fontSize: '0.78rem' }}>{f.nombreRecinto}</div>}
                        </td>
                        <td>{f.codigoUnico ? <code>{f.codigoUnico}</code> : '—'}</td>
                        <td>{f.numero ?? '—'}</td>
                        <td>
                          <span className={CLASE_ESTADO[f.estado]}>{ETIQUETA_ESTADO[f.estado]}</span>
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
              <button type="button" className="btn" onClick={guardar} disabled={previa.guardadas === 0 || ocupado === 'guardar'}>
                {ocupado === 'guardar' ? 'Guardando…' : `Guardar ${previa.guardadas}`}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
