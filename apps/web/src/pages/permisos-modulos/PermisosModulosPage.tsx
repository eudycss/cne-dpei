import { Fragment, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import {
  MODULOS_WEB,
  ROLES_CONFIGURABLES,
  type ModuloWebId,
  type RolConfigurable,
  type SeccionModulo,
} from '@cne/shared-validation';
import { getPermisosModulos, guardarModulosRol } from '../../lib/queries/permisos-modulos';
import { MIS_MODULOS_KEY } from '../../lib/useModulos';
import { etiquetaRol } from '../../lib/roles';

type Borrador = Record<RolConfigurable, ModuloWebId[]>;

const SECCIONES: SeccionModulo[] = ['Preparación', 'Operación', 'Personal', 'Informes'];
const NOTA_TECHO_ID = 'nota-modulo-no-disponible';

function borradorVacio(): Borrador {
  return { TECNICO_SUPERVISOR: [], LECTOR: [], ASISTENTE_TRANSVERSAL: [] };
}

function borradorDeFabrica(): Borrador {
  const b = borradorVacio();
  for (const rol of ROLES_CONFIGURABLES) {
    b[rol] = MODULOS_WEB.filter((m) => m.rolesPorDefecto.includes(rol)).map((m) => m.id);
  }
  return b;
}

const mismos = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/** El administrador elige qué módulos de la web ve cada rol. */
export function PermisosModulosPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['permisos-modulos'], queryFn: getPermisosModulos });
  const [borrador, setBorrador] = useState<Borrador>(borradorVacio);
  const [anuncio, setAnuncio] = useState('');

  const guardado: Borrador = borradorVacio();
  for (const r of data?.roles ?? []) {
    if ((ROLES_CONFIGURABLES as readonly string[]).includes(r.rol)) {
      guardado[r.rol as RolConfigurable] = r.modulos as ModuloWebId[];
    }
  }

  // Al llegar (o cambiar) lo guardado en el servidor, la tabla lo refleja.
  useEffect(() => {
    if (data) setBorrador(guardado);
  }, [data]);

  const rolesCambiados = ROLES_CONFIGURABLES.filter((rol) => !mismos(borrador[rol], guardado[rol]));

  const guardar = useMutation({
    mutationFn: () => Promise.all(rolesCambiados.map((rol) => guardarModulosRol(rol, borrador[rol]))),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['permisos-modulos'] });
      qc.invalidateQueries({ queryKey: MIS_MODULOS_KEY });
      sileo.success({ title: 'Módulos por rol guardados' });
      setAnuncio('Módulos por rol guardados');
    },
    onError: (e: any) => {
      qc.invalidateQueries({ queryKey: ['permisos-modulos'] });
      const mensaje = e?.response?.data?.message ?? 'No se pudieron guardar los módulos por rol';
      sileo.error({ title: mensaje });
      setAnuncio(mensaje);
    },
  });

  function alternar(rol: RolConfigurable, id: ModuloWebId) {
    setBorrador((b) => ({
      ...b,
      [rol]: b[rol].includes(id) ? b[rol].filter((m) => m !== id) : [...b[rol], id],
    }));
  }

  return (
    <>
      <h2>Módulos por rol</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Elija qué secciones de la web ve cada rol. El Administrador siempre las ve todas. Los cambios le llegan a
        cada usuario en un minuto como máximo, o al recargar la página.
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {anuncio}
      </p>

      {isLoading ? (
        <p className="muted" role="status">
          Cargando…
        </p>
      ) : isError ? (
        <p role="alert">No se pudo cargar la configuración de módulos.</p>
      ) : (
        <>
          <div className="card" style={{ padding: 0, overflow: 'auto' }}>
            <table>
              <caption className="sr-only">Módulos visibles por rol</caption>
              <thead>
                <tr>
                  <th scope="col">Módulo</th>
                  {ROLES_CONFIGURABLES.map((rol) => (
                    <th scope="col" key={rol} style={{ textAlign: 'center' }}>
                      {etiquetaRol(rol)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SECCIONES.map((seccion) => (
                  <Fragment key={seccion}>
                    <tr>
                      <th scope="colgroup" colSpan={ROLES_CONFIGURABLES.length + 1} className="muted" style={{ fontSize: '0.8rem' }}>
                        {seccion}
                      </th>
                    </tr>
                    {MODULOS_WEB.filter((m) => m.seccion === seccion).map((m) => (
                      <tr key={m.id}>
                        <th scope="row" style={{ fontWeight: 'normal' }}>
                          {m.etiqueta}
                        </th>
                        {ROLES_CONFIGURABLES.map((rol) => {
                          const disponible = m.rolesPermitidos.includes(rol);
                          return (
                            <td key={rol} style={{ textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                style={{ width: 24, height: 24, cursor: disponible ? 'pointer' : 'not-allowed' }}
                                aria-label={`${m.etiqueta} para ${etiquetaRol(rol)}`}
                                aria-describedby={disponible ? undefined : NOTA_TECHO_ID}
                                checked={disponible && borrador[rol].includes(m.id)}
                                disabled={!disponible || guardar.isPending}
                                onChange={() => alternar(rol, m.id)}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p id={NOTA_TECHO_ID} className="muted" style={{ fontSize: '0.8rem' }}>
            Las casillas deshabilitadas no están disponibles para ese rol: el servidor no le permite consultar esos
            datos.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn primary"
              disabled={rolesCambiados.length === 0 || guardar.isPending}
              onClick={() => guardar.mutate()}
            >
              {guardar.isPending ? 'Guardando…' : 'Guardar cambios'}
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={guardar.isPending}
              onClick={() => {
                setBorrador(borradorDeFabrica());
                setAnuncio('Valores de fábrica restaurados. Falta guardar los cambios.');
              }}
            >
              Restaurar valores de fábrica
            </button>
          </div>
        </>
      )}
    </>
  );
}
