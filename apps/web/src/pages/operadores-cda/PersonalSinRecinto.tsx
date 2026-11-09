import { useState } from 'react';
import { coincideBusqueda } from '@cne/shared-validation';
import { useQuery } from '@tanstack/react-query';
import { Cargando } from '../../components/Cargando';
import { SearchInput } from '../../components/SearchInput';
import { getDisponiblesParejasCda } from '../../lib/queries/operadores-cda';
import { cargoPareja } from './ParejaFormModal';
import { mensajeError } from './utils';

/**
 * Operadores y Asistentes CDA activos que ese día no están en ninguna pareja
 * ni reserva. La consulta es solo para el administrador.
 */
export function PersonalSinRecinto({ dia }: { dia: string }) {
  const [busqueda, setBusqueda] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['parejas-cda', 'disponibles', dia, true],
    queryFn: () => getDisponiblesParejasCda(dia, true),
  });

  const personas = [...(data?.operadores ?? []), ...(data?.asistentes ?? [])];
  const q = busqueda.trim();
  const visibles = q ? personas.filter((p) => coincideBusqueda([p.apellidosNombres, p.cedula, cargoPareja(p)], q)) : personas;

  return (
    <section aria-labelledby="personal-sin-recinto-titulo" style={{ marginTop: '1.5rem' }}>
      <h4 id="personal-sin-recinto-titulo" className="ocda-subtitulo">
        Personal sin recinto este día
      </h4>
      {isLoading && <Cargando />}
      {error && (
        <p className="banner error" role="alert">
          {mensajeError(error, 'No se pudo cargar el personal sin recinto')}
        </p>
      )}
      {data && personas.length === 0 && <p className="muted">Todo el personal activo ya tiene pareja o reserva este día.</p>}
      {data && personas.length > 0 && (
        <>
          <div className="ocda-filtros">
            <span className="ocda-campo" style={{ flex: '1 1 260px', maxWidth: 420 }}>
              <SearchInput
                value={busqueda}
                onChange={setBusqueda}
                placeholder="Buscar por nombre, cédula o cargo…"
                ariaLabel="Buscar personal sin recinto por nombre, cédula o cargo"
              />
            </span>
          </div>
          <p className="muted" role="status">
            {q
              ? `${visibles.length} de ${personas.length} persona(s)`
              : `${personas.length} persona(s): ${data.operadores.length} operador(es) · ${data.asistentes.length} asistente(s)`}
          </p>
          <div className="ocda-tabla" tabIndex={0} role="region" aria-label={`Personal sin recinto del ${dia}`}>
            <table>
              <caption className="sr-only">Personal sin recinto del {dia}: nombre, cédula y cargo</caption>
              <thead>
                <tr>
                  <th scope="col">N°</th>
                  <th scope="col">Apellidos y nombres</th>
                  <th scope="col">Cédula</th>
                  <th scope="col">Cargo</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((p, i) => (
                  <tr key={p.id}>
                    <th scope="row" className="mono">
                      {i + 1}
                    </th>
                    <td>{p.apellidosNombres}</td>
                    <td className="mono">{p.cedula}</td>
                    <td>{cargoPareja(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
