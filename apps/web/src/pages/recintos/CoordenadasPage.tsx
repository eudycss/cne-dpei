import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { coincideBusqueda } from '@cne/shared-validation';
import { getCoordenadasRecintos } from '../../lib/queries/coordenadas-recintos';
import { mensajeError } from '../operadores-cda/utils';

const UMBRAL_INICIAL = 150;

const coord = (lat: number, lng: number) => `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
const urlMapa = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`;

/**
 * Coordenada guardada de cada recinto frente a dónde marcó el personal la
 * llegada y la salida. Un recinto desplazado tiene la coordenada corrida: el
 * personal no puede registrar la llegada aunque ya esté dentro. Solo lectura;
 * la propuesta es la mediana de las marcaciones reales.
 */
export function CoordenadasPage() {
  // Lo escrito en la casilla (puede estar a medias) y el umbral válido que se consulta.
  const [umbralTexto, setUmbralTexto] = useState(String(UMBRAL_INICIAL));
  const [umbral, setUmbral] = useState(UMBRAL_INICIAL);
  const [soloDesplazadas, setSoloDesplazadas] = useState(true);
  const [filtro, setFiltro] = useState('');
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['recintos', 'coordenadas', umbral],
    queryFn: () => getCoordenadasRecintos(umbral),
    // Al cambiar el umbral la tabla anterior sigue visible: si no, la casilla desaparece y pierde el foco.
    placeholderData: keepPreviousData,
  });

  if (isLoading) {
    return (
      <p className="muted" role="status">
        Calculando coordenadas…
      </p>
    );
  }
  // Un error sin datos previos no deja nada que mostrar; con datos previos se avisa sin quitar los filtros.
  if (error && !data) {
    return (
      <p className="banner error" role="alert">
        {mensajeError(error, 'No se pudieron cargar las coordenadas')}
      </p>
    );
  }
  const umbralInvalido = !(Number.isInteger(Number(umbralTexto)) && Number(umbralTexto) >= 10 && Number(umbralTexto) <= 5000);

  const todos = data?.recintos ?? [];
  const desplazadas = todos.filter((r) => r.sospechosa).length;
  const q = filtro.trim();
  const visibles = todos
    .filter((r) => !soloDesplazadas || r.sospechosa)
    .filter((r) => !q || coincideBusqueda([r.codigo, r.nombre, r.canton], q));

  return (
    <>
      <p className="muted">
        Compara la coordenada guardada de cada recinto con dónde marcó el personal la llegada y la salida (a menos de 2 km, sin
        registros manuales). Si la mediana de esas distancias supera el umbral, la coordenada está desplazada. La{' '}
        <strong>propuesta</strong> es la mediana de las marcaciones y exige al menos {data?.minMarcas ?? 3}. Las marcaciones a más de 2 km no
        entran en la propuesta, pero se cuentan: un recinto con solo marcaciones lejanas tiene la coordenada muy corrida.
      </p>
      {error && (
        <p className="banner error" role="alert">
          {mensajeError(error, 'No se pudieron actualizar las coordenadas')} Se muestra el resultado anterior.
        </p>
      )}
      <p role="status">
        {isFetching ? 'Actualizando con el umbral nuevo…' : desplazadas === 0
          ? 'Ningún recinto tiene la coordenada desplazada.'
          : `${desplazadas} de ${todos.length} recintos con marcaciones tienen la coordenada desplazada.`}
      </p>

      <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
        <div className="field" style={{ margin: 0, flex: '1 1 220px' }}>
          <label htmlFor="coord-filtro">Buscar recinto</label>
          <input
            id="coord-filtro"
            type="search"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Código, nombre o cantón…"
            autoComplete="off"
          />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="coord-umbral">Umbral (m)</label>
          <input
            id="coord-umbral"
            type="number"
            inputMode="numeric"
            min={10}
            max={5000}
            step={10}
            value={umbralTexto}
            onChange={(e) => {
              setUmbralTexto(e.target.value);
              const n = Number(e.target.value);
              if (e.target.value.trim() && Number.isInteger(n) && n >= 10 && n <= 5000) setUmbral(n);
            }}
            aria-invalid={umbralInvalido ? true : undefined}
            aria-describedby={umbralInvalido ? 'coord-umbral-error' : undefined}
            style={{ width: '7rem' }}
          />
          {umbralInvalido && (
            <span id="coord-umbral-error" className="ocda-form-ayuda" style={{ display: 'block', color: 'var(--danger, #b91c1c)' }}>
              Entero entre 10 y 5000. Se muestra el umbral de {umbral} m.
            </span>
          )}
        </div>
        <label className="row" style={{ gap: '0.4rem', alignItems: 'center' }}>
          <input type="checkbox" checked={soloDesplazadas} onChange={(e) => setSoloDesplazadas(e.target.checked)} />
          Solo desplazadas
        </label>
      </div>

      {visibles.length === 0 ? (
        <p className="muted" role="status">
          {todos.length === 0 ? 'Aún no hay marcaciones de llegada o salida de recintos.' : 'Ningún recinto coincide.'}
        </p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ minWidth: 860 }}>
            <caption className="sr-only">Coordenada guardada y propuesta de cada recinto</caption>
            <thead>
              <tr>
                <th scope="col">Cantón</th>
                <th scope="col">Recinto</th>
                <th scope="col">Marcaciones</th>
                <th scope="col">A más de 2 km</th>
                <th scope="col">Distancia mediana</th>
                <th scope="col">Guardada</th>
                <th scope="col">Propuesta</th>
                <th scope="col">Desfase</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((r) => {
                const nombre = `${r.codigo} · ${r.nombre}`;
                return (
                  <tr key={r.id}>
                    <td>{r.canton}</td>
                    <td>
                      {nombre}
                      {r.sospechosa && <strong style={{ marginLeft: '0.4rem' }}>(desplazada)</strong>}
                    </td>
                    <td>{r.marcas}</td>
                    <td>{r.marcasLejanas}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.medianaMetros} m</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <a
                        href={urlMapa(r.latActual, r.lngActual)}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`${coord(r.latActual, r.lngActual)}, coordenada guardada de ${nombre} (se abre en una pestaña nueva)`}
                      >
                        {coord(r.latActual, r.lngActual)}
                      </a>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {r.latPropuesta === null || r.lngPropuesta === null ? (
                        <span className="muted">Pocas marcaciones</span>
                      ) : (
                        <a
                          href={urlMapa(r.latPropuesta, r.lngPropuesta)}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`${coord(r.latPropuesta, r.lngPropuesta)}, coordenada propuesta de ${nombre} (se abre en una pestaña nueva)`}
                        >
                          {coord(r.latPropuesta, r.lngPropuesta)}
                        </a>
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.desfaseMetros === null ? '—' : `${r.desfaseMetros} m`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
