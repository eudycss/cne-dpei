import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import type { OperadorCda } from '@cne/shared-types';
import { useAuth } from '../../auth/AuthContext';
import { SearchInput } from '../../components/SearchInput';
import { Cargando } from '../../components/Cargando';
import { getFotoOperadorCda, getOperadoresCda } from '../../lib/queries/operadores-cda';
import { EnlaceFotoModal } from './EnlaceFotoModal';
import { ImportarOperadoresModal } from './ImportarOperadoresModal';
import { AccionesEncabezado } from './AccionesEncabezado';
import { cargoCorto, iniciales, normalizar, partirNombre } from './utils';

/**
 * Personal de los Centros de Digitalización de Actas. Son ~56 personas: se
 * traen todas y se filtra en el navegador, sin pedir a la API en cada tecla.
 */
export function ListadoOperadores({ acciones = null }: { acciones?: HTMLElement | null }) {
  const { user } = useAuth();
  const isAdmin = user?.roles.includes('ADMINISTRADOR') ?? false;
  const [busqueda, setBusqueda] = useState('');
  const [importando, setImportando] = useState(false);
  const [enlacePara, setEnlacePara] = useState<OperadorCda | null>(null);
  const reducirMovimiento = useReducedMotion();

  const { data, isLoading, error } = useQuery({ queryKey: ['operadores-cda'], queryFn: getOperadoresCda });

  const visibles = useMemo(() => {
    const q = normalizar(busqueda.trim());
    if (!q) return data ?? [];
    return (data ?? []).filter((o) => normalizar(o.apellidosNombres).includes(q) || o.cedula.includes(q));
  }, [data, busqueda]);

  const conFoto = data?.filter((o) => o.tieneFoto).length ?? 0;

  return (
    <>
      {isAdmin && (
        <AccionesEncabezado destino={acciones}>
          <button type="button" className="btn secondary" onClick={() => setImportando(true)}>
            Importar Excel
          </button>
        </AccionesEncabezado>
      )}

      {isLoading && <Cargando />}
      {error && (
        <div className="banner error" role="alert">
          No se pudo cargar la lista de operadores.
        </div>
      )}

      {data && data.length === 0 && (
        <div className="ocda-vacio">
          <p style={{ margin: 0 }}>Aún no hay operadores registrados.</p>
          {isAdmin && (
            <p className="muted" style={{ margin: '0.25rem 0 0' }}>
              Use <strong>Importar Excel</strong> con el archivo de talento humano (20. OPERADORES CDA.xlsx).
            </p>
          )}
        </div>
      )}

      {data && data.length > 0 && (
        <>
          <div className="ocda-filtros">
            <span className="ocda-campo" style={{ flex: '1 1 280px', maxWidth: 420 }}>
              <SearchInput
                value={busqueda}
                onChange={setBusqueda}
                placeholder="Buscar por nombre o cédula…"
                ariaLabel="Buscar operador por nombre o cédula"
              />
            </span>
            <p className="muted" role="status" style={{ margin: 0 }}>
              {visibles.length} de {data.length} operadores · {conFoto} con foto
            </p>
          </div>

          <ul className="ocda-grid" aria-label="Operadores CDA">
            {visibles.map((o, i) => (
              <motion.li
                key={o.id}
                className="ocda-tarjeta"
                initial={reducirMovimiento ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: Math.min(i, 20) * 0.03 }}
              >
                <TarjetaOperador operador={o} onEnlace={() => setEnlacePara(o)} />
              </motion.li>
            ))}
          </ul>
          {visibles.length === 0 && <p className="muted">Ningún operador coincide con “{busqueda}”.</p>}
        </>
      )}

      {importando && <ImportarOperadoresModal onClose={() => setImportando(false)} />}
      {enlacePara && <EnlaceFotoModal operador={enlacePara} onClose={() => setEnlacePara(null)} />}
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
  const { data } = useQuery({
    queryKey: ['operadores-cda', o.id, 'foto'],
    queryFn: () => getFotoOperadorCda(o.id),
    enabled: o.tieneFoto && visible,
    staleTime: Infinity,
    retry: false,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!data) return setUrl(null);
    const u = URL.createObjectURL(data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [data]);

  return (
    <span ref={ref} className={`ocda-avatar grande${o.tieneFoto ? ' con-foto' : ''}`} aria-hidden="true">
      {url ? <img src={url} alt="" /> : iniciales(o.apellidosNombres)}
    </span>
  );
}

function TarjetaOperador({ operador: o, onEnlace }: { operador: OperadorCda; onEnlace: () => void }) {
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
      </dl>
      <div className="ocda-tarjeta-pie">
        <span className={`ocda-estado ${o.tieneFoto ? 'ok' : 'pendiente'}`}>
          {o.tieneFoto ? 'Foto cargada' : 'Sin foto'}
        </span>
        <button
          type="button"
          className="btn secondary ocda-btn-chico"
          onClick={onEnlace}
          aria-label={`${accion}: ${o.apellidosNombres}`}
        >
          {accion}
        </button>
      </div>
    </>
  );
}
