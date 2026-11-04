import type { ImportParejasCdaResult } from '@cne/shared-types';

/**
 * Vista previa de parejas antes de guardar (plantilla o propuesta): recinto,
 * pareja, errores (no se guardan) y avisos.
 */
export function VistaPreviaParejas({ vista, primeraColumna = 'Fila' }: { vista: ImportParejasCdaResult; primeraColumna?: string }) {
  const conError = vista.filas.filter((f) => f.errores.length > 0).length;
  const validas = vista.filas.length - conError;
  return (
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
              <th scope="col">{primeraColumna}</th>
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
  );
}
