import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import { motion, useReducedMotion } from 'motion/react';
import type { GrupoCda, OperadorCda } from '@cne/shared-types';
import { useAuth } from '../../auth/AuthContext';
import { useModulos } from '../../lib/useModulos';
import { SearchInput } from '../../components/SearchInput';
import { Cargando } from '../../components/Cargando';
import { cambiarActivoOperadorCda, getOperadoresCda } from '../../lib/queries/operadores-cda';
import { useFotoOperadorUrl } from './useFotoOperador';
import { EnlaceFotoModal } from './EnlaceFotoModal';
import { CarnetsQrModal } from './CarnetsQrModal';
import { useGrupoCda } from './grupo';
import { ImportarOperadoresModal } from './ImportarOperadoresModal';
import { AccionesEncabezado } from './AccionesEncabezado';
import { OperadorFormModal } from './OperadorFormModal';
import { OcultarOperadorModal } from './OcultarOperadorModal';
import { FILTROS_INGRESO, cumpleIngreso, fechaDeUrl, ordenarPorIngreso, rangoIngresoInvalido, type OrdenListado } from './filtroIngreso';
import { cargoCorto, fechaCorta, iniciales, mensajeError, normalizar, partirNombre } from './utils';

/**
 * Tras agregar, editar u ocultar: listados (con y sin ocultos), asistencia y
 * actas. No se tocan las fotos ya descifradas (cada una cuesta CPU en la API).
 */
function refrescarOperadores(qc: QueryClient, grupo: GrupoCda) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['operadores-cda', grupo], exact: true }),
    qc.invalidateQueries({ queryKey: ['operadores-cda', grupo, 'con-ocultos'], exact: true }),
    qc.invalidateQueries({ queryKey: ['asistencia-cda'] }),
    qc.invalidateQueries({ queryKey: ['actas-cda'] }),
  ]);
}

/**
 * Personal de los Centros de Digitalización de Actas. Son ~64 personas por
 * cargo: se traen todas y se filtra en el navegador (nombre, cédula y fecha
 * de ingreso), sin pedir a la API en cada tecla. El rango de ingreso queda
 * en la URL para poder compartir la vista.
 */
export function ListadoOperadores({ acciones = null }: { acciones?: HTMLElement | null }) {
  const { user } = useAuth();
  const isAdmin = user?.roles.includes('ADMINISTRADOR') ?? false;
  const { puede } = useModulos();
  const puedeCarnets = puede('cda.carnets.emitir');
  const { grupo, titulo, plural, singular, Singular } = useGrupoCda();
  const [busqueda, setBusqueda] = useState('');
  const [params, setParams] = useSearchParams();
  const filtro = {
    desde: fechaDeUrl(params.get('ingresoDesde')),
    hasta: fechaDeUrl(params.get('ingresoHasta')),
    incluirSinFecha: params.get('sinFecha') === '1',
  };
  const rangoInvalido = rangoIngresoInvalido(filtro);
  const conRango = filtro.desde !== '' || filtro.hasta !== '';
  const [orden, setOrden] = useState<OrdenListado>('lista');
  const cambiarFiltro = (clave: (typeof FILTROS_INGRESO)[number], valor: string) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (valor) p.set(clave, valor);
        else p.delete(clave);
        return p;
      },
      { replace: true },
    );
  const limpiarFiltros = () => {
    setBusqueda('');
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        for (const f of FILTROS_INGRESO) p.delete(f);
        return p;
      },
      { replace: true },
    );
  };
  const [importando, setImportando] = useState(false);
  const [carnets, setCarnets] = useState(false);
  const [enlacePara, setEnlacePara] = useState<OperadorCda | null>(null);
  // null = cerrado; 'nuevo' = agregar; un operador = editarlo.
  const [formulario, setFormulario] = useState<OperadorCda | 'nuevo' | null>(null);
  const [ocultarA, setOcultarA] = useState<OperadorCda | null>(null);
  const [conOcultos, setConOcultos] = useState(false);
  const verOcultos = isAdmin && conOcultos;
  const reducirMovimiento = useReducedMotion();
  const qc = useQueryClient();
  const refrescar = () => refrescarOperadores(qc, grupo);
  const chipRef = useRef<HTMLButtonElement>(null);
  const agregarRef = useRef<HTMLButtonElement>(null);
  // Ocultar o reactivar cambia los botones de la tarjeta: el que tenía el foco
  // desaparece al refrescar. El foco pasa a un control estable (WCAG 2.4.3).
  const refrescarYEnfocar = () =>
    refrescar().then(() => (chipRef.current?.isConnected ? chipRef.current : agregarRef.current)?.focus());

  const { data, isLoading, error } = useQuery({
    queryKey: verOcultos ? ['operadores-cda', grupo, 'con-ocultos'] : ['operadores-cda', grupo],
    queryFn: () => getOperadoresCda(verOcultos, grupo),
    // Al alternar "Mostrar ocultos" la lista (y el foco en el botón) se queda mientras carga.
    placeholderData: keepPreviousData,
  });
  const reactivar = useMutation({
    mutationFn: (o: OperadorCda) => cambiarActivoOperadorCda(o.id, true),
    onSuccess: (o) => {
      sileo.success({ title: `${Singular} reactivado`, description: o.apellidosNombres });
      refrescarYEnfocar();
    },
    onError: (e) => sileo.error({ title: mensajeError(e, `No se pudo reactivar al ${singular}`) }),
  });

  const { desde, hasta, incluirSinFecha } = filtro;
  const visibles = useMemo(() => {
    const q = normalizar(busqueda.trim());
    const f = { desde, hasta, incluirSinFecha };
    const filtrados = (data ?? []).filter(
      (o) => (!q || normalizar(o.apellidosNombres).includes(q) || o.cedula.includes(q)) && cumpleIngreso(o, f),
    );
    return ordenarPorIngreso(filtrados, orden);
  }, [data, busqueda, desde, hasta, incluirSinFecha, orden]);
  const hayFiltros = busqueda.trim() !== '' || conRango;

  const conFoto = data?.filter((o) => o.activo && o.tieneFoto).length ?? 0;
  const ocultos = data?.filter((o) => !o.activo).length ?? 0;

  return (
    <>
      {(isAdmin || puedeCarnets) && (
        <AccionesEncabezado destino={acciones}>
          {isAdmin && (
            <button type="button" className="btn secondary" onClick={() => setImportando(true)}>
              Importar Excel
            </button>
          )}
          {puedeCarnets && (
            <button
              type="button"
              className="btn secondary"
              disabled={!data?.some((o) => o.activo)}
              onClick={() => setCarnets(true)}
            >
              Carnets QR
            </button>
          )}
          {isAdmin && (
            <button ref={agregarRef} type="button" className="btn" onClick={() => setFormulario('nuevo')}>
              Agregar {singular}
            </button>
          )}
        </AccionesEncabezado>
      )}

      {isLoading && <Cargando />}
      {error && (
        <div className="banner error" role="alert">
          No se pudo cargar la lista de {plural}.
        </div>
      )}

      {data && data.length === 0 && !verOcultos && (
        <div className="ocda-vacio">
          <p style={{ margin: 0 }}>Aún no hay {plural} registrados.</p>
          {isAdmin && (
            <p className="muted" style={{ margin: '0.25rem 0 0' }}>
              Use <strong>Importar Excel</strong> con el archivo de talento humano
              {grupo === 'OPERADOR' ? ' (20. OPERADORES CDA.xlsx)' : ''} o <strong>Agregar {singular}</strong> para
              registrar a alguien a mano.
            </p>
          )}
        </div>
      )}

      {data && (data.length > 0 || verOcultos) && (
        <>
          <div className="ocda-filtros">
            <span className="ocda-campo" style={{ flex: '1 1 280px', maxWidth: 420 }}>
              <SearchInput
                value={busqueda}
                onChange={setBusqueda}
                placeholder="Buscar por nombre o cédula…"
                ariaLabel={`Buscar ${singular} por nombre o cédula`}
              />
            </span>
            <label className="ocda-fecha">
              <span>Ingreso desde</span>
              <input
                type="date"
                value={filtro.desde}
                max={filtro.hasta || undefined}
                aria-invalid={rangoInvalido || undefined}
                aria-describedby={rangoInvalido ? 'ingreso-rango-error' : undefined}
                onChange={(e) => cambiarFiltro('ingresoDesde', e.target.value)}
              />
            </label>
            <label className="ocda-fecha">
              <span>Ingreso hasta</span>
              <input
                type="date"
                value={filtro.hasta}
                min={filtro.desde || undefined}
                aria-invalid={rangoInvalido || undefined}
                aria-describedby={rangoInvalido ? 'ingreso-rango-error' : undefined}
                onChange={(e) => cambiarFiltro('ingresoHasta', e.target.value)}
              />
            </label>
            {conRango && (
              <button
                type="button"
                className="ocda-chip"
                aria-pressed={filtro.incluirSinFecha}
                onClick={() => cambiarFiltro('sinFecha', filtro.incluirSinFecha ? '' : '1')}
              >
                Incluir sin fecha
              </button>
            )}
            <label className="ocda-fecha">
              <span>Ordenar</span>
              <select value={orden} onChange={(e) => setOrden(e.target.value as OrdenListado)}>
                <option value="lista">Como en la lista</option>
                <option value="ingreso-reciente">Ingreso más reciente</option>
                <option value="ingreso-antiguo">Ingreso más antiguo</option>
              </select>
            </label>
            {hayFiltros && (
              <button type="button" className="ocda-btn-texto" onClick={limpiarFiltros}>
                Limpiar filtros
              </button>
            )}
            {isAdmin && (
              <button
                ref={chipRef}
                type="button"
                className="ocda-chip"
                aria-pressed={conOcultos}
                onClick={() => setConOcultos((v) => !v)}
              >
                Mostrar ocultos
              </button>
            )}
            <p className="muted" role="status" style={{ margin: 0 }}>
              {visibles.length} de {data.length} {plural} · {conFoto} con foto
              {verOcultos && ` · ${ocultos} oculto${ocultos === 1 ? '' : 's'}`}
            </p>
          </div>
          {rangoInvalido && (
            <p id="ingreso-rango-error" className="banner error" role="alert">
              La fecha “desde” es posterior a “hasta”: corrija el rango para filtrar por fecha de ingreso.
            </p>
          )}

          <ul className="ocda-grid" aria-label={titulo}>
            {visibles.map((o, i) => (
              <motion.li
                key={o.id}
                className={`ocda-tarjeta${o.activo ? '' : ' oculta'}`}
                initial={reducirMovimiento ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: Math.min(i, 20) * 0.03 }}
              >
                <TarjetaOperador
                  operador={o}
                  onEnlace={puede('cda.fotos.enlace') ? () => setEnlacePara(o) : undefined}
                  admin={
                    isAdmin
                      ? {
                          onEditar: () => setFormulario(o),
                          onOcultar: () => setOcultarA(o),
                          onReactivar: () => reactivar.mutate(o),
                          reactivando: reactivar.isPending && reactivar.variables?.id === o.id,
                        }
                      : undefined
                  }
                />
              </motion.li>
            ))}
          </ul>
          {visibles.length === 0 && (
            <p className="muted">
              {conRango && !rangoInvalido
                ? `Ningún ${singular} coincide con los filtros.`
                : `Ningún ${singular} coincide con “${busqueda}”.`}
            </p>
          )}
        </>
      )}

      {importando && <ImportarOperadoresModal onClose={() => setImportando(false)} />}
      {carnets && data && (
        <CarnetsQrModal operadores={data.filter((o) => o.activo)} onClose={() => setCarnets(false)} />
      )}
      {enlacePara && <EnlaceFotoModal operador={enlacePara} onClose={() => setEnlacePara(null)} />}
      {formulario && (
        <OperadorFormModal
          operador={formulario === 'nuevo' ? undefined : formulario}
          onClose={() => setFormulario(null)}
          onHecho={refrescar}
        />
      )}
      {ocultarA && <OcultarOperadorModal operador={ocultarA} onClose={() => setOcultarA(null)} onHecho={refrescarYEnfocar} />}
    </>
  );
}

/** true cuando el elemento entra (o está por entrar) en pantalla; luego se queda en true. */
function useVisible<T extends Element>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (visible || !ref.current) return;
    const obs = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: '200px' });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [visible]);
  return { ref, visible };
}

/**
 * Foto descifrada (blob) o, mientras no haya, las iniciales. Solo se pide al
 * acercarse a la pantalla: cada foto se descifra en la API (Render, 0.1 vCPU).
 */
function AvatarOperador({ operador: o }: { operador: OperadorCda }) {
  const { ref, visible } = useVisible<HTMLSpanElement>();
  const url = useFotoOperadorUrl(o, visible);

  return (
    <span ref={ref} className={`ocda-avatar grande${o.tieneFoto ? ' con-foto' : ''}`} aria-hidden="true">
      {url ? <img src={url} alt="" /> : iniciales(o.apellidosNombres)}
    </span>
  );
}

type AccionesAdmin = { onEditar: () => void; onOcultar: () => void; onReactivar: () => void; reactivando: boolean };

function TarjetaOperador({
  operador: o,
  onEnlace,
  admin,
}: {
  operador: OperadorCda;
  /** Sin permiso para crear enlaces de foto, no se muestra el botón. */
  onEnlace?: () => void;
  /** Solo el administrador agrega, edita u oculta. */
  admin?: AccionesAdmin;
}) {
  const { apellidos, nombres } = partirNombre(o.apellidosNombres);
  const accion = o.tieneFoto ? 'Cambiar foto' : 'Enlace de foto';
  return (
    <>
      <div className="ocda-tarjeta-top">
        <AvatarOperador operador={o} />
        <h3 className="ocda-nombre" aria-label={o.apellidosNombres}>
          <span className="ocda-nombre-apellidos">{apellidos}</span>
          {nombres && <span className="ocda-nombre-nombres">{nombres}</span>}
        </h3>
      </div>
      <dl className="ocda-datos">
        <div>
          <dt>Cédula</dt>
          <dd className="mono">{o.cedula}</dd>
        </div>
        <div>
          <dt>Teléfono</dt>
          <dd className="mono">{o.telefono ?? '—'}</dd>
        </div>
        <div>
          <dt>Cargo</dt>
          <dd title={o.cargo}>{cargoCorto(o.cargo)}</dd>
        </div>
        <div>
          <dt>Ingreso</dt>
          <dd className="mono">{o.fechaInicio ? fechaCorta(o.fechaInicio) : 'Sin fecha'}</dd>
        </div>
      </dl>
      <div className="ocda-tarjeta-pie">
        {o.activo ? (
          <>
            <span className={`ocda-estado ${o.tieneFoto ? 'ok' : 'pendiente'}`}>
              {o.tieneFoto ? 'Foto cargada' : 'Sin foto'}
            </span>
            {onEnlace && (
              <button
                type="button"
                className="btn secondary ocda-btn-chico"
                onClick={onEnlace}
                aria-label={`${accion}: ${o.apellidosNombres}`}
              >
                {accion}
              </button>
            )}
          </>
        ) : (
          <span className="ocda-estado vacio">Oculto</span>
        )}
      </div>
      {admin && (
        <div className="ocda-tarjeta-admin">
          {o.activo ? (
            <>
              <button type="button" className="ocda-btn-texto" onClick={admin.onEditar} aria-label={`Editar: ${o.apellidosNombres}`}>
                Editar
              </button>
              <button
                type="button"
                className="ocda-btn-texto peligro"
                onClick={admin.onOcultar}
                aria-label={`Ocultar: ${o.apellidosNombres}`}
              >
                Ocultar
              </button>
            </>
          ) : (
            <button
              type="button"
              className="ocda-btn-texto"
              onClick={admin.onReactivar}
              disabled={admin.reactivando}
              aria-label={`Reactivar: ${o.apellidosNombres}`}
            >
              {admin.reactivando ? 'Reactivando…' : 'Reactivar'}
            </button>
          )}
        </div>
      )}
    </>
  );
}
