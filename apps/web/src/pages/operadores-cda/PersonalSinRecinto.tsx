import { useState } from 'react';
import { coincideBusqueda } from '@cne/shared-validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import { Cargando } from '../../components/Cargando';
import { SearchInput } from '../../components/SearchInput';
import { crearReservasParejaCda, getDisponiblesParejasCda } from '../../lib/queries/operadores-cda';
import { cargoPareja } from './ParejaFormModal';
import { mensajeError } from './utils';

/**
 * Operadores y Asistentes CDA activos que ese día no están en ninguna pareja
 * ni reserva; los elegidos pasan a reserva, cada uno por su cuenta. La
 * consulta y la acción son solo para el administrador.
 */
export function PersonalSinRecinto({ dia }: { dia: string }) {
  const qc = useQueryClient();
  const [busqueda, setBusqueda] = useState('');
  const [elegidos, setElegidos] = useState<ReadonlySet<string>>(new Set());
  const { data, isLoading, error } = useQuery({
    queryKey: ['parejas-cda', 'disponibles', dia, true],
    queryFn: () => getDisponiblesParejasCda(dia, true),
  });

  const operadores = data?.operadores ?? [];
  const asistentes = data?.asistentes ?? [];
  const personas = [...operadores, ...asistentes];
  const q = busqueda.trim();
  const visibles = q ? personas.filter((p) => coincideBusqueda([p.apellidosNombres, p.cedula, cargoPareja(p)], q)) : personas;
  // Solo cuentan quienes siguen en la lista: otro administrador pudo haberlos asignado.
  const idsElegidos = (lista: typeof personas) => lista.filter((p) => elegidos.has(p.id)).map((p) => p.id);
  const totalElegidos = idsElegidos(personas).length;
  const elegidasVisibles = idsElegidos(visibles).length;
  const todasVisibles = visibles.length > 0 && elegidasVisibles === visibles.length;
  // Buscar no borra la selección (se busca y se marca a varias personas seguidas), pero se avisa quién no se ve.
  const elegidasOcultas = totalElegidos - elegidasVisibles;

  const pasar = useMutation({
    mutationFn: () => crearReservasParejaCda({ fecha: dia, operadores: idsElegidos(operadores), asistentes: idsElegidos(asistentes) }),
    onSuccess: (r) => {
      setElegidos(new Set());
      // Quien va en Parejas está convocado: cambian la convocatoria y la asistencia de ese día.
      qc.invalidateQueries({ queryKey: ['parejas-cda'] });
      qc.invalidateQueries({ queryKey: ['convocatoria-cda'] });
      qc.invalidateQueries({ queryKey: ['asistencia-cda'] });
      sileo.success({ title: `${r.creadas} persona(s) pasaron a reserva` });
    },
    // Si alguien ya no estaba libre, un reintento con la misma selección volvería a fallar.
    onError: () => {
      setElegidos(new Set());
      qc.invalidateQueries({ queryKey: ['parejas-cda'] });
    },
  });

  const alternar = (id: string, marcar: boolean) =>
    setElegidos((prev) => {
      const siguiente = new Set(prev);
      if (marcar) siguiente.add(id);
      else siguiente.delete(id);
      return siguiente;
    });
  const alternarVisibles = (marcar: boolean) => visibles.forEach((p) => alternar(p.id, marcar));

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
          <p className="muted" style={{ marginTop: 0 }}>
            Quien pasa a reserva queda convocado ese día y sale en la hoja <strong>Reserva</strong> del reporte. Luego puede unir a dos personas con{' '}
            <strong>Completar</strong>.
          </p>
          <div className="ocda-filtros">
            <span className="ocda-campo" style={{ flex: '1 1 260px', maxWidth: 420 }}>
              <SearchInput
                value={busqueda}
                onChange={setBusqueda}
                placeholder="Buscar por nombre, cédula o cargo…"
                ariaLabel="Buscar personal sin recinto por nombre, cédula o cargo"
              />
            </span>
            <button type="button" className="btn" onClick={() => pasar.mutate()} disabled={totalElegidos === 0 || pasar.isPending}>
              {pasar.isPending ? 'Pasando a reserva…' : `Pasar a reserva (${totalElegidos})`}
            </button>
          </div>
          {pasar.isError && (
            <p className="banner error" role="alert">
              {mensajeError(pasar.error, 'No se pudo pasar a reserva')}
            </p>
          )}
          <p className="muted" role="status">
            {q
              ? `${visibles.length} de ${personas.length} persona(s)`
              : `${personas.length} persona(s): ${operadores.length} operador(es) · ${asistentes.length} asistente(s)`}
            {elegidasOcultas > 0 && ` · ${elegidasOcultas} elegida(s) oculta(s) por el buscador`}
          </p>
          <div className="ocda-tabla" tabIndex={0} role="region" aria-label={`Personal sin recinto del ${dia}`}>
            <table>
              <caption className="sr-only">Personal sin recinto del {dia}: nombre, cédula y cargo</caption>
              <thead>
                <tr>
                  <th scope="col">
                    <input
                      type="checkbox"
                      aria-label="Seleccionar todas las personas visibles"
                      checked={todasVisibles}
                      ref={(el) => {
                        if (el) el.indeterminate = elegidasVisibles > 0 && !todasVisibles;
                      }}
                      onChange={(e) => alternarVisibles(e.target.checked)}
                    />
                  </th>
                  <th scope="col">N°</th>
                  <th scope="col">Apellidos y nombres</th>
                  <th scope="col">Cédula</th>
                  <th scope="col">Cargo</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((p, i) => (
                  <tr key={p.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Seleccionar ${p.apellidosNombres}`}
                        checked={elegidos.has(p.id)}
                        onChange={(e) => alternar(p.id, e.target.checked)}
                      />
                    </td>
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
