import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { ImportOperadoresCdaResult } from '@cne/shared-types';
import { Modal } from '../../components/Modal';
import { importarOperadoresCda } from '../../lib/queries/operadores-cda';
import { useGrupoCda } from './grupo';

function mensajeError(e: unknown, porDefecto: string): string {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? porDefecto;
}

/**
 * Importación en dos pasos: al elegir el archivo se muestra la vista previa
 * (nuevos, actualizados y errores) y solo se guarda al confirmar. La API
 * guarda todo o nada, así que con errores el botón queda deshabilitado.
 */
export function ImportarOperadoresModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { grupo, titulo, singular } = useGrupoCda();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vista, setVista] = useState<ImportOperadoresCdaResult | null>(null);
  // Si se elige otro archivo mientras se lee el anterior, la respuesta vieja
  // no debe mostrarse: la vista previa tiene que ser la del archivo que se importará.
  const archivoActual = useRef<File | null>(null);

  const previsualizar = useMutation({
    mutationFn: (file: File) => importarOperadoresCda(file, false, grupo),
    onSuccess: (r, file) => {
      if (archivoActual.current === file) setVista(r);
    },
  });

  const aplicar = useMutation({
    mutationFn: (file: File) => importarOperadoresCda(file, true, grupo),
    onSuccess: ({ nuevos, actualizados, cuentas }) => {
      qc.invalidateQueries({ queryKey: ['operadores-cda', grupo] });
      const titulo = `Importación lista: ${nuevos} nuevo(s), ${actualizados} actualizado(s).`;
      sileo.success(
        cuentas
          ? {
              title: titulo,
              description: `Cuentas de la app: ${cuentas.creadas} creada(s) y ${cuentas.vinculadas} vinculada(s).`,
            }
          : { title: titulo },
      );
      onClose();
    },
    onError: (e) => sileo.error({ title: mensajeError(e, 'No se pudo importar el archivo') }),
  });

  function elegir(file: File | null) {
    archivoActual.current = file;
    setArchivo(file);
    setVista(null);
    previsualizar.reset();
    if (file) previsualizar.mutate(file);
  }

  const total = vista ? vista.filas.length : 0;
  const puedeImportar = !!archivo && !!vista && total > 0 && vista.errores.length === 0 && !aplicar.isPending;

  return (
    <Modal labelledBy="importar-ocda-titulo" onClose={onClose} maxWidth={760}>
      <div className="login-card" style={{ width: '100%', maxWidth: 'none' }} aria-busy={previsualizar.isPending || aplicar.isPending}>
        <h1 id="importar-ocda-titulo">Importar {titulo}</h1>
        <p className="muted">
          Suba el Excel de talento humano (.xlsx). Se detecta solo la fila de encabezados (N°, Apellidos Nombres,
          Cédula, Teléfonos, Cargo, Unidad, Inicial). Si la cédula ya existe, se actualizan sus datos; si está
          en el otro grupo, esa fila se marca como error.
        </p>

        <div className="field">
          <label htmlFor="importar-ocda-archivo">Archivo (.xlsx)</label>
          <input
            id="importar-ocda-archivo"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => elegir(e.target.files?.[0] ?? null)}
            disabled={previsualizar.isPending || aplicar.isPending}
          />
        </div>

        {previsualizar.isPending && <p role="status">Leyendo el archivo…</p>}
        {previsualizar.isError && (
          <div className="banner error" role="alert">
            {mensajeError(previsualizar.error, 'No se pudo leer el archivo.')}
          </div>
        )}

        {vista && (
          <>
            <p role="status">
              <strong>{total}</strong> {singular}(es): <strong>{vista.nuevos}</strong> nuevo(s) ·{' '}
              <strong>{vista.actualizados}</strong> actualizado(s)
              {vista.errores.length > 0 && (
                <>
                  {' '}· <strong>{vista.errores.length}</strong> con errores
                </>
              )}
            </p>

            {vista.errores.length > 0 && (
              <section aria-labelledby="importar-ocda-errores">
                <h2 id="importar-ocda-errores" style={{ fontSize: '1rem' }}>
                  Corrija estas filas en el Excel y vuelva a cargarlo
                </h2>
                <div className="banner error" role="alert">
                  <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                    {vista.errores.map((e) => (
                      <li key={`${e.fila}-${e.error}`}>
                        <strong>Fila {e.fila}:</strong> {e.error}
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}

            {total > 0 && (
              // Enfocable para poder desplazarse con el teclado (WCAG 2.1.1).
              <div
                style={{ maxHeight: 320, overflow: 'auto' }}
                tabIndex={0}
                role="region"
                aria-label="Vista previa de la importación"
              >
                <table>
                  <caption className="sr-only">Vista previa de la importación</caption>
                  <thead>
                    <tr>
                      <th scope="col">Fila</th>
                      <th scope="col">Apellidos y nombres</th>
                      <th scope="col">Cédula</th>
                      <th scope="col">Teléfono</th>
                      <th scope="col">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vista.filas.map((f) => (
                      <tr key={f.cedula}>
                        <td>{f.fila}</td>
                        <td>{f.apellidosNombres}</td>
                        <td className="mono">{f.cedula}</td>
                        <td className="mono">{f.telefono ?? '—'}</td>
                        <td>{f.accion === 'NUEVO' ? 'Nuevo' : 'Actualizar'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        <div className="row" style={{ justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
          <button type="button" className="btn secondary" onClick={onClose} disabled={aplicar.isPending}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn"
            disabled={!puedeImportar}
            onClick={() => archivo && aplicar.mutate(archivo)}
          >
            {aplicar.isPending ? 'Importando…' : `Importar ${total} ${singular}(es)`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
