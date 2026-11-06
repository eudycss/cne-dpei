import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { ConvocatoriaCdaPersona } from '@cne/shared-types';
import { coincideBusqueda } from '@cne/shared-validation';
import { SearchInput } from '../../components/SearchInput';
import { Cargando } from '../../components/Cargando';
import { getConvocatoriaCda, guardarConvocatoriaCda } from '../../lib/queries/operadores-cda';
import { useModulos } from '../../lib/useModulos';
import { hoyEcuador, mensajeError } from './utils';

interface GrupoCargo {
  clave: string;
  cargo: string;
  centro: string;
  personas: ConvocatoriaCdaPersona[];
}

/** Por centro (CDA, CPE) y cargo, en el orden que manda la API. */
function porCargo(personas: ConvocatoriaCdaPersona[]): GrupoCargo[] {
  const grupos = new Map<string, GrupoCargo>();
  for (const p of personas) {
    const g = grupos.get(p.grupo) ?? { clave: p.grupo, cargo: p.cargo, centro: p.centro, personas: [] };
    g.personas.push(p);
    grupos.set(p.grupo, g);
  }
  return [...grupos.values()];
}

const mismos = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((x) => b.has(x));

/**
 * Convocatoria del día (todo el personal CDA y CPE): a quién se llamó. Solo
 * los convocados pueden tener falta en la asistencia. Quienes están en
 * Parejas ese día ya cuentan (se cambian en Parejas).
 */
export function ConvocatoriaPanel() {
  const hoy = hoyEcuador();
  const { puede } = useModulos();
  const editable = puede('cda.convocatoria.gestionar');
  const qc = useQueryClient();
  const [fecha, setFecha] = useState(hoy);
  const [busqueda, setBusqueda] = useState('');
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [copiarDe, setCopiarDe] = useState('');
  const [copiando, setCopiando] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['convocatoria-cda', fecha],
    queryFn: () => getConvocatoriaCda(fecha),
  });
  // Marcados a mano tal como están guardados (los de Parejas van aparte).
  const guardados = useMemo(
    () => new Set((data?.personas ?? []).filter((p) => p.convocado && !p.porPareja).map((p) => p.operadorId)),
    [data],
  );
  // Al llegar los datos del día (o tras guardar) las casillas parten de lo guardado.
  useEffect(() => setMarcados(new Set(guardados)), [guardados]);

  const guardar = useMutation({
    mutationFn: () => guardarConvocatoriaCda(fecha, [...marcados]),
    onSuccess: (r) => {
      qc.setQueryData(['convocatoria-cda', fecha], r);
      // La asistencia y los atrasos de ese día cambian (quién puede tener falta).
      qc.invalidateQueries({ queryKey: ['asistencia-cda'] });
      qc.invalidateQueries({ queryKey: ['atrasos-cda'] });
      sileo.success({ title: `Convocatoria del ${fecha} guardada`, description: `${r.convocados} convocados de ${r.total}` });
    },
    onError: (e) => sileo.error({ title: mensajeError(e, 'No se pudo guardar la convocatoria') }),
  });

  const personas = data?.personas ?? [];
  const esConvocado = (p: ConvocatoriaCdaPersona) => p.porPareja || marcados.has(p.operadorId);
  const total = personas.length;
  const convocados = personas.filter(esConvocado).length;
  const cambiado = !mismos(marcados, guardados);
  const grupos = useMemo(() => porCargo(personas), [personas]);
  const q = busqueda.trim();
  const visibles = (g: GrupoCargo) => g.personas.filter((p) => coincideBusqueda([p.apellidosNombres, p.cedula], q));

  function alternar(id: string) {
    setMarcados((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }

  function todoElCargo(g: GrupoCargo, convocar: boolean) {
    setMarcados((prev) => {
      const s = new Set(prev);
      for (const p of visibles(g)) {
        if (p.porPareja) continue;
        if (convocar) s.add(p.operadorId);
        else s.delete(p.operadorId);
      }
      return s;
    });
  }

  function cambiarFecha(nueva: string) {
    if (!nueva || nueva === fecha) return;
    if (cambiado && !window.confirm('Hay cambios sin guardar en esta convocatoria. ¿Cambiar de día y perderlos?')) return;
    setFecha(nueva);
  }

  async function copiar() {
    if (!copiarDe) return;
    const destino = fecha;
    setCopiando(true);
    try {
      const otra = await getConvocatoriaCda(copiarDe);
      // Si mientras tanto cambió el día de destino, no se mezcla.
      if (destino !== fecha) return;
      const activos = new Set(personas.map((p) => p.operadorId));
      // Todos los convocados de ese día (también los que fueron en Parejas), salvo quienes aquí ya van en Parejas.
      const enParejas = new Set(personas.filter((p) => p.porPareja).map((p) => p.operadorId));
      const copiados = otra.personas
        .filter((p) => p.convocado && activos.has(p.operadorId) && !enParejas.has(p.operadorId))
        .map((p) => p.operadorId);
      if (otra.convocados === 0) {
        sileo.error({ title: `El ${copiarDe} no tiene convocados`, description: 'No se cambió nada.' });
        return;
      }
      if (marcados.size > 0 && !window.confirm(`¿Reemplazar las marcas actuales por los ${copiados.length} convocados del ${copiarDe}?`)) return;
      setMarcados(new Set(copiados));
      sileo.success({ title: `Copiada la convocatoria del ${copiarDe}`, description: 'Revise y toque Guardar.' });
    } catch (e) {
      sileo.error({ title: mensajeError(e, 'No se pudo leer esa fecha') });
    } finally {
      setCopiando(false);
    }
  }

  return (
    <section aria-labelledby="convocatoria-titulo">
      <h3 id="convocatoria-titulo" className="sr-only">
        Convocatoria del día
      </h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Solo los convocados pueden tener falta. Quienes están en Parejas ese día ya cuentan como convocados (se cambian en
        Parejas).
      </p>

      <div className="ocda-filtros">
        <label className="ocda-fecha">
          <span>Día</span>
          <input type="date" value={fecha} min="2020-01-01" max="2100-12-31" disabled={copiando} onChange={(e) => cambiarFecha(e.target.value)} />
        </label>
        <span className="ocda-campo" style={{ flex: '1 1 240px', maxWidth: 340 }}>
          <SearchInput value={busqueda} onChange={setBusqueda} placeholder="Buscar por nombre o cédula…" ariaLabel="Buscar persona en la convocatoria" />
        </span>
        {editable && (
          <span className="ocda-filtros" style={{ margin: 0 }}>
            <label className="ocda-fecha">
              <span>Copiar de</span>
              <input type="date" value={copiarDe} min="2020-01-01" max="2100-12-31" onChange={(e) => setCopiarDe(e.target.value)} />
            </label>
            <button type="button" className="btn secondary" disabled={!copiarDe || copiarDe === fecha || copiando} onClick={copiar}>
              {copiando ? 'Copiando…' : 'Copiar'}
            </button>
          </span>
        )}
      </div>

      {isLoading && <Cargando />}
      {error && (
        <div className="banner error" role="alert">
          {mensajeError(error, 'No se pudo cargar la convocatoria.')}
        </div>
      )}

      {data && (
        <>
          <p role="status" className="ocda-pie" style={{ marginTop: 0 }}>
            Convocados: <strong>{convocados}</strong> de {total}
            {cambiado && ' · hay cambios sin guardar'}
          </p>
          {fecha < hoy && editable && (
            <div className="banner aviso">Está cambiando un día pasado: las faltas de ese día se recalculan.</div>
          )}
          {!editable && <div className="banner">Solo consulta: su rol no puede cambiar la convocatoria.</div>}

          {grupos.map((g) => {
            const lista = visibles(g);
            if (lista.length === 0) return null;
            const marcadosDelCargo = g.personas.filter(esConvocado).length;
            const idCargo = `convocatoria-cargo-${g.clave}`;
            return (
              <fieldset key={g.clave} className="ocda-tabla" style={{ padding: '0.75rem', marginBottom: '0.75rem' }} aria-labelledby={idCargo}>
                <legend id={idCargo} style={{ fontWeight: 600 }}>
                  {g.centro} · {g.cargo} ({marcadosDelCargo}/{g.personas.length})
                </legend>
                {editable && (
                  <div className="row" style={{ gap: '0.4rem', marginBottom: '0.4rem' }}>
                    <button type="button" className="ocda-chip" onClick={() => todoElCargo(g, true)} aria-label={`Convocar a todo el cargo ${g.cargo}${q ? ' (los de la búsqueda)' : ''}`}>
                      Todo el cargo
                    </button>
                    <button type="button" className="ocda-chip" onClick={() => todoElCargo(g, false)} aria-label={`Quitar a todo el cargo ${g.cargo}${q ? ' (los de la búsqueda)' : ''}`}>
                      Nadie
                    </button>
                  </div>
                )}
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, columns: '18rem' }}>
                  {lista.map((p) => (
                    <li key={p.operadorId} style={{ breakInside: 'avoid', padding: '0.15rem 0' }}>
                      <label style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
                        <input
                          type="checkbox"
                          checked={esConvocado(p)}
                          disabled={!editable || p.porPareja || guardar.isPending}
                          onChange={() => alternar(p.operadorId)}
                        />
                        <span>{p.apellidosNombres}</span>
                        {p.porPareja && <span className="ocda-estado pendiente">En Parejas</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            );
          })}

          {editable && (
            <div
              className="row"
              style={{
                justifyContent: 'flex-end',
                gap: '0.5rem',
                position: 'sticky',
                bottom: 0,
                padding: '0.6rem 0.25rem',
                background: 'var(--f-bg-surface)',
                borderTop: '1px solid var(--f-border-subtle)',
              }}
            >
              {!cambiado && <span className="muted" style={{ fontSize: '0.8rem', marginRight: 'auto' }}>Sin cambios por guardar</span>}
              <button type="button" className="btn secondary" disabled={!cambiado || guardar.isPending} onClick={() => setMarcados(new Set(guardados))}>
                Descartar cambios
              </button>
              <button type="button" className="btn" disabled={!cambiado || guardar.isPending} onClick={() => guardar.mutate()}>
                {guardar.isPending ? 'Guardando…' : `Guardar convocatoria (${convocados})`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
