import { Fragment, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import {
  MODULOS_WEB,
  PERMISOS,
  ROLES_CONFIGURABLES,
  type ModuloWebId,
  type PermisoId,
  type RolConfigurable,
  type SeccionModulo,
} from '@cne/shared-validation';
import { getPermisosModulos, guardarModulosRol } from '../../lib/queries/permisos-modulos';
import { MIS_MODULOS_KEY } from '../../lib/useModulos';
import { etiquetaRol } from '../../lib/roles';

type Config = { modulos: ModuloWebId[]; permisos: PermisoId[] };
type Borrador = Record<RolConfigurable, Config>;

const SECCIONES: SeccionModulo[] = ['Preparación', 'Operación', 'Personal', 'Informes'];
const NOTA_TECHO_ID = 'nota-modulo-no-disponible';
const NOTA_MODULO_ID = 'nota-accion-sin-modulo';
const PENDIENTES_ID = 'modulos-cambios-pendientes';

function borradorVacio(): Borrador {
  const vacio = (): Config => ({ modulos: [], permisos: [] });
  return { TECNICO_SUPERVISOR: vacio(), LECTOR: vacio(), ASISTENTE_TRANSVERSAL: vacio() };
}

function borradorDeFabrica(): Borrador {
  const b = borradorVacio();
  for (const rol of ROLES_CONFIGURABLES) {
    b[rol] = {
      modulos: MODULOS_WEB.filter((m) => m.rolesPorDefecto.includes(rol)).map((m) => m.id),
      permisos: PERMISOS.filter((p) => p.rolesPorDefecto.includes(rol)).map((p) => p.id),
    };
  }
  return b;
}

const mismos = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

type Fallido = { rol: RolConfigurable; motivo: string };

/** Algún rol no se pudo guardar; cada uno con el motivo que dio el servidor. */
class GuardadoParcial extends Error {
  constructor(
    readonly fallidos: Fallido[],
    readonly guardados: RolConfigurable[],
  ) {
    super('guardado parcial');
  }
}

function mensajeServidor(e: any): string | undefined {
  // La validación del servidor puede devolver una lista de mensajes.
  const m = e?.response?.data?.message;
  return (Array.isArray(m) ? m.join(', ') : m) || undefined;
}

const SIN_GUARDAR = 'No se pudieron guardar los módulos por rol';

function mensajeGuardadoParcial({ fallidos, guardados }: GuardadoParcial): string {
  // Un solo rol y nada guardado: basta el motivo del servidor.
  if (guardados.length === 0 && fallidos.length === 1) return fallidos[0].motivo;
  const partes: string[] = [];
  if (guardados.length > 0) {
    partes.push(`${guardados.length === 1 ? 'Se guardó' : 'Se guardaron'} ${guardados.map(etiquetaRol).join(', ')}.`);
  }
  const detalle = fallidos.map((f) => `${etiquetaRol(f.rol)} (${f.motivo})`).join('; ');
  partes.push(`${fallidos.length === 1 ? 'No se pudo guardar' : 'No se pudieron guardar'}: ${detalle}.`);
  partes.push('Sus cambios siguen en pantalla para reintentar.');
  return partes.join(' ');
}

const alternarId = <T extends string>(lista: T[], id: T) =>
  lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id];

/** El administrador elige qué módulos de la web ve cada rol y qué puede hacer en ellos. */
export function PermisosModulosPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['permisos-modulos'], queryFn: getPermisosModulos });
  const [borrador, setBorrador] = useState<Borrador>(borradorVacio);
  const [anuncio, setAnuncio] = useState('');
  const [alerta, setAlerta] = useState('');
  // Roles cuyo guardado falló: al recargar lo del servidor, su borrador no se pisa.
  const conservar = useRef<ReadonlySet<RolConfigurable>>(new Set());
  // Se vacía antes de escribir: el lector de pantalla repite el aviso aunque el texto sea el mismo.
  // Los errores van a una región role="alert" (asertiva), el resto a role="status".
  const anunciar = (texto: string, esError = false) => {
    const fijar = esError ? setAlerta : setAnuncio;
    setAnuncio('');
    setAlerta('');
    setTimeout(() => fijar(texto), 50);
  };

  const guardado: Borrador = borradorVacio();
  for (const r of data?.roles ?? []) {
    if ((ROLES_CONFIGURABLES as readonly string[]).includes(r.rol)) {
      guardado[r.rol as RolConfigurable] = {
        modulos: r.modulos as ModuloWebId[],
        permisos: (r.permisos ?? []) as PermisoId[],
      };
    }
  }

  // Al llegar (o cambiar) lo guardado en el servidor, la tabla lo refleja.
  useEffect(() => {
    if (!data) return;
    setBorrador((previo) => {
      const b = { ...guardado };
      for (const rol of conservar.current) b[rol] = previo[rol];
      return b;
    });
  }, [data]);

  const rolesCambiados = ROLES_CONFIGURABLES.filter(
    (rol) =>
      !mismos(borrador[rol].modulos, guardado[rol].modulos) || !mismos(borrador[rol].permisos, guardado[rol].permisos),
  );

  const guardar = useMutation({
    mutationFn: async () => {
      const roles = rolesCambiados;
      const resultados = await Promise.allSettled(
        roles.map((rol) => guardarModulosRol(rol, borrador[rol].modulos, borrador[rol].permisos)),
      );
      const fallidos: Fallido[] = [];
      resultados.forEach((r, i) => {
        if (r.status === 'rejected') fallidos.push({ rol: roles[i], motivo: mensajeServidor(r.reason) ?? SIN_GUARDAR });
      });
      if (fallidos.length > 0) {
        throw new GuardadoParcial(fallidos, roles.filter((rol) => !fallidos.some((f) => f.rol === rol)));
      }
    },
    onSuccess: () => {
      conservar.current = new Set();
      qc.invalidateQueries({ queryKey: ['permisos-modulos'] });
      qc.invalidateQueries({ queryKey: MIS_MODULOS_KEY });
      sileo.success({ title: 'Módulos por rol guardados' });
      anunciar('Módulos por rol guardados');
    },
    onError: (e: unknown) => {
      const parcial = e instanceof GuardadoParcial ? e : null;
      conservar.current = new Set(parcial ? parcial.fallidos.map((f) => f.rol) : rolesCambiados);
      qc.invalidateQueries({ queryKey: ['permisos-modulos'] });
      if (parcial?.guardados.length) qc.invalidateQueries({ queryKey: MIS_MODULOS_KEY });
      const mensaje = parcial ? mensajeGuardadoParcial(parcial) : (mensajeServidor(e) ?? SIN_GUARDAR);
      sileo.error({ title: mensaje });
      anunciar(mensaje, true);
    },
  });

  function alternarModulo(rol: RolConfigurable, id: ModuloWebId) {
    setBorrador((b) => {
      const quitando = b[rol].modulos.includes(id);
      // Al quitar el módulo se quitan también sus acciones: no reaparecen solas al volver a activarlo.
      const permisos = quitando
        ? b[rol].permisos.filter((p) => PERMISOS.find((x) => x.id === p)?.modulo !== id)
        : b[rol].permisos;
      return { ...b, [rol]: { modulos: alternarId(b[rol].modulos, id), permisos } };
    });
  }

  function alternarPermiso(rol: RolConfigurable, id: PermisoId) {
    setBorrador((b) => ({ ...b, [rol]: { ...b[rol], permisos: alternarId(b[rol].permisos, id) } }));
  }

  return (
    <>
      <h2>Módulos por rol</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Elija qué secciones de la web ve cada rol y, debajo de cada sección, qué puede hacer en ella. El Administrador
        siempre ve y puede todo. Los cambios le llegan a cada usuario en un minuto como máximo, o al recargar la página.
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {anuncio}
      </p>
      <p className="sr-only" role="alert">
        {alerta}
      </p>

      {isLoading ? (
        <p className="muted" role="status">
          Cargando…
        </p>
      ) : isError ? (
        <div role="alert">
          <p>No se pudo cargar la configuración de módulos.</p>
          <button type="button" className="btn secondary" onClick={() => refetch()}>
            Reintentar
          </button>
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 0, overflow: 'auto' }}>
            <table>
              <caption className="sr-only">Módulos visibles y acciones permitidas por rol</caption>
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
              {SECCIONES.map((seccion) => (
                  <tbody key={seccion}>
                    <tr>
                      <th scope="rowgroup" colSpan={ROLES_CONFIGURABLES.length + 1} className="muted" style={{ fontSize: '0.8rem' }}>
                        {seccion}
                      </th>
                    </tr>
                    {MODULOS_WEB.filter((m) => m.seccion === seccion).map((m) => (
                      <Fragment key={m.id}>
                        <tr>
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
                                  checked={disponible && borrador[rol].modulos.includes(m.id)}
                                  disabled={!disponible || guardar.isPending}
                                  onChange={() => alternarModulo(rol, m.id)}
                                />
                                {!disponible && <span className="sr-only">No disponible para este rol</span>}
                              </td>
                            );
                          })}
                        </tr>
                        {PERMISOS.filter((p) => p.modulo === m.id).map((p) => (
                          <tr key={p.id}>
                            <th scope="row" style={{ fontWeight: 'normal', paddingLeft: '2rem', fontSize: '0.9rem' }}>
                              <span aria-hidden="true">↳ </span>
                              {p.etiqueta}
                            </th>
                            {ROLES_CONFIGURABLES.map((rol) => {
                              const disponible = p.rolesPermitidos.includes(rol);
                              const conModulo = borrador[rol].modulos.includes(m.id);
                              const habilitada = disponible && conModulo;
                              return (
                                <td key={rol} style={{ textAlign: 'center' }}>
                                  <input
                                    type="checkbox"
                                    style={{ width: 24, height: 24, cursor: habilitada ? 'pointer' : 'not-allowed' }}
                                    aria-label={`${m.etiqueta}: ${p.etiqueta}, para ${etiquetaRol(rol)}`}
                                    aria-describedby={!disponible ? NOTA_TECHO_ID : !conModulo ? NOTA_MODULO_ID : undefined}
                                    checked={habilitada && borrador[rol].permisos.includes(p.id)}
                                    disabled={!habilitada || guardar.isPending}
                                    onChange={() => alternarPermiso(rol, p.id)}
                                  />
                                  {!habilitada && (
                                    <span className="sr-only">
                                      {!disponible ? 'No disponible para este rol' : 'Requiere activar el módulo'}
                                    </span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                ))}
            </table>
          </div>
          <p id={NOTA_TECHO_ID} className="muted" style={{ fontSize: '0.8rem' }}>
            Las casillas deshabilitadas no están disponibles para ese rol: el servidor no le permite consultar esos
            datos ni hacer esa acción.
          </p>
          <p id={NOTA_MODULO_ID} className="muted" style={{ fontSize: '0.8rem' }}>
            Las acciones (↳) solo se pueden dar si el rol ve el módulo; al quitarle el módulo, tampoco puede hacerlas.
          </p>
          <p className="muted" style={{ fontSize: '0.8rem' }}>
            Atención: «Emitir o anular carnets QR» permite imprimir el carnet de cualquier persona del CDA y anular el que
            tenga. Désela solo a quien de verdad lo necesite.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn primary"
              disabled={rolesCambiados.length === 0 || guardar.isPending}
              aria-describedby={PENDIENTES_ID}
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
                anunciar('Valores de fábrica restaurados. Falta guardar los cambios.');
              }}
            >
              Restaurar valores de fábrica
            </button>
          </div>
          <p id={PENDIENTES_ID} className="muted" style={{ fontSize: '0.8rem' }}>
            {rolesCambiados.length === 0
              ? 'No hay cambios por guardar.'
              : `Cambios sin guardar en: ${rolesCambiados.map(etiquetaRol).join(', ')}.`}
          </p>
        </>
      )}
    </>
  );
}
