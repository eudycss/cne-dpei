import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { AplicarParejasCdaResult, ImportParejasCdaResult } from '@cne/shared-types';
import { Modal } from '../../components/Modal';
import { importarParejasCda } from '../../lib/queries/operadores-cda';
import { resumenApp } from './resumenParejas';
import { mensajeError } from './utils';

/**
 * Carga de la plantilla de parejas en dos pasos: al elegir el archivo se ve
 * la vista previa (recinto con código y nombre, parejas, errores y avisos) y
 * solo se guarda al confirmar. Las filas con error no se guardan.
 */
export function ImportarParejasModal({
  dia,
  congelado = false,
  onResultado,
  onClose,
}: {
  dia: string;
  congelado?: boolean;
  onResultado?: (r: AplicarParejasCdaResult | null) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [pasarAApp, setPasarAApp] = useState(true);
  const [justificacion, setJustificacion] = useState('');
  const motivo = justificacion.trim() || undefined;
  /** Al guardar con filas que fallaron se queda abierto mostrando cuáles. */
  const [guardado, setGuardado] = useState<ImportParejasCdaResult | null>(null);
  const [vista, setVista] = useState<ImportParejasCdaResult | null>(null);
  // La respuesta de un archivo anterior no debe mostrarse si ya se eligió otro.
  const archivoActual = useRef<File | null>(null);

  const previsualizar = useMutation({
    mutationFn: (file: File) => importarParejasCda(file, dia, false),
    onSuccess: (r, file) => {
      if (archivoActual.current === file) setVista(r);
    },
  });
  const guardar = useMutation({
    mutationFn: (file: File) => importarParejasCda(file, dia, true, { app: pasarAApp, justificacion: motivo }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['parejas-cda'] });
      const sinGuardar = r.filas.filter((f) => f.errores.length > 0).length;
      sileo[sinGuardar ? 'warning' : 'success']({
        title: `${r.guardadas} pareja(s) guardada(s)${sinGuardar ? `; ${sinGuardar} fila(s) con error no se guardaron` : ''}`,
        description: r.app
          ? resumenApp(r.app).title
          : pasarAApp
            ? 'Sin evento activo de este día: quedan registradas.'
            : 'Quedan registradas sin pasar a la app.',
      });
      onResultado?.(r.app);
      if (sinGuardar) {
        setGuardado(r);
        setVista(r);
      } else onClose();
    },
    onError: (e) => sileo.error({ title: mensajeError(e, 'No se pudo guardar la plantilla') }),
  });

  function elegir(file: File | null) {
    archivoActual.current = file;
    setArchivo(file);
    setVista(null);
    previsualizar.reset();
    if (file) previsualizar.mutate(file);
  }

  const conError = vista?.filas.filter((f) => f.errores.length > 0).length ?? 0;
  const validas = (vista?.filas.length ?? 0) - conError;
  const puedeGuardar =
    !!archivo && !!vista && !guardado && validas > 0 && (!congelado || !pasarAApp || !!motivo) && !guardar.isPending;

  return (
    <Modal labelledBy="importar-parejas-titulo" onClose={onClose} maxWidth={980}>
      <div className="login-card" style={{ width: '100%', maxWidth: 'none' }} aria-busy={previsualizar.isPending || guardar.isPending}>
        <h1 id="importar-parejas-titulo">Cargar parejas del {dia}</h1>
        <p className="muted">
          Use la plantilla (botón “Descargar plantilla”). Una fila por pareja: cédula del operador y código del recinto son
          obligatorios; las cédulas que no estén registradas se crean con el nombre de la fila.
        </p>

        <div className="field">
          <label htmlFor="importar-parejas-archivo">Plantilla (.xlsx)</label>
          <input
            id="importar-parejas-archivo"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => elegir(e.target.files?.[0] ?? null)}
            disabled={previsualizar.isPending || guardar.isPending}
          />
        </div>

        <label className="ocda-check-linea">
          <input type="checkbox" checked={pasarAApp} onChange={(e) => setPasarAApp(e.target.checked)} />
          Pasar a la app al guardar (desmarque para registrar una lista pasada sin tocar sus kits)
        </label>
        {congelado && pasarAApp && (
          <div className="field">
            <label htmlFor="importar-parejas-justificacion">Justificación (la jornada ya inició)</label>
            <input
              id="importar-parejas-justificacion"
              value={justificacion}
              onChange={(e) => setJustificacion(e.target.value)}
              maxLength={500}
              autoComplete="off"
            />
          </div>
        )}

        {previsualizar.isPending && <p role="status">Leyendo la plantilla…</p>}
        {guardado && (
          <p className="banner aviso" role="alert">
            Se guardaron {guardado.guardadas} pareja(s). Las filas con error de abajo no se guardaron: corríjalas y cárguelas de
            nuevo.
          </p>
        )}
        {previsualizar.isError && (
          <div className="banner error" role="alert">
            {mensajeError(previsualizar.error, 'No se pudo leer la plantilla.')}
          </div>
        )}

        {vista && (
          <>
            <p role="status">
              <strong>{validas}</strong> pareja(s) lista(s) para guardar
              {conError > 0 && (
                <>
                  {' '}· <strong>{conError}</strong> fila(s) con error (no se guardan)
                </>
              )}
            </p>
            <div style={{ maxHeight: 380, overflow: 'auto' }} tabIndex={0} role="region" aria-label="Vista previa de las parejas">
              <table>
                <caption className="sr-only">Vista previa de las parejas</caption>
                <thead>
                  <tr>
                    <th scope="col">Fila</th>
                    <th scope="col">Recinto</th>
                    <th scope="col">Operador CDA</th>
                    <th scope="col">Asistente CDA</th>
                    <th scope="col">Observaciones</th>
                  </tr>
                </thead>
                <tbody>
                  {vista.filas.map((f) => (
                    <tr key={f.fila}>
                      <td>{f.fila}</td>
                      <td>{f.recinto ? `${f.recinto.codigo} · ${f.recinto.nombre}` : '—'}</td>
                      <td>
                        {f.operador.nombre ?? '—'}
                        <br />
                        <span className="muted mono">{f.operador.cedula}</span>
                        {f.operador.nuevo && <span className="ocda-estado pendiente">Nuevo</span>}
                      </td>
                      <td>
                        {f.asistente ? (
                          <>
                            {f.asistente.nombre ?? '—'}
                            <br />
                            <span className="muted mono">{f.asistente.cedula}</span>
                            {f.asistente.nuevo && <span className="ocda-estado pendiente">Nuevo</span>}
                          </>
                        ) : (
                          <span className="muted">Sin asistente</span>
                        )}
                      </td>
                      <td>
                        {f.errores.length === 0 && f.avisos.length === 0 && <span className="ocda-estado ok">Lista</span>}
                        {f.errores.length > 0 && (
                          <ul className="ocda-obs error" aria-label={`Errores de la fila ${f.fila}`}>
                            {f.errores.map((e) => (
                              <li key={e}>{e}</li>
                            ))}
                          </ul>
                        )}
                        {f.avisos.length > 0 && (
                          <ul className="ocda-obs aviso" aria-label={`Avisos de la fila ${f.fila}`}>
                            {f.avisos.map((a) => (
                              <li key={a}>{a}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="row" style={{ justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
          <button type="button" className="btn secondary" onClick={onClose} disabled={guardar.isPending}>
            {guardado ? 'Cerrar' : 'Cancelar'}
          </button>
          <button type="button" className="btn" disabled={!puedeGuardar} onClick={() => archivo && guardar.mutate(archivo)}>
            {guardar.isPending ? 'Guardando…' : `Guardar ${validas} pareja(s)`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
