import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import type { OperadorCda } from '@cne/shared-types';
import { useAuth } from '../../auth/AuthContext';
import { SearchInput } from '../../components/SearchInput';
import { Cargando } from '../../components/Cargando';
import { getOperadoresCda } from '../../lib/queries/operadores-cda';
import { ImportarOperadoresModal } from './ImportarOperadoresModal';

/** Sin tildes y en minúsculas, para buscar "chavez" y encontrar "CHÁVEZ". */
export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Iniciales para el avatar: primer apellido y primer nombre ("APELLIDO1 APELLIDO2 NOMBRE1 …"). */
export function iniciales(apellidosNombres: string): string {
  const p = apellidosNombres.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p[2]?.[0] ?? p[1]?.[0] ?? '')).toUpperCase();
}

/**
 * Personal de los Centros de Digitalización de Actas. Son ~56 personas: se
 * traen todas y se filtra en el navegador, sin pedir a la API en cada tecla.
 */
export function OperadoresCdaPage() {
  const { user } = useAuth();
  const isAdmin = user?.roles.includes('ADMINISTRADOR') ?? false;
  const [busqueda, setBusqueda] = useState('');
  const [importando, setImportando] = useState(false);
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
      <div className="row ocda-encabezado">
        <div>
          <h2 style={{ marginBottom: '0.25rem' }}>Operadores CDA</h2>
          <p className="muted" style={{ margin: 0 }}>
            Personal de los Centros de Digitalización de Actas.
          </p>
        </div>
        {isAdmin && (
          <button type="button" className="btn" onClick={() => setImportando(true)}>
            Importar Excel
          </button>
        )}
      </div>

      {isLoading && <Cargando />}
      {error && (
        <div className="banner error" role="alert">
          No se pudo cargar la lista de operadores.
        </div>
      )}

      {data && data.length === 0 && (
        <div className="card ocda-vacio">
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
          <div className="row ocda-filtros">
            <SearchInput
              value={busqueda}
              onChange={setBusqueda}
              placeholder="Buscar por nombre o cédula…"
              ariaLabel="Buscar operador por nombre o cédula"
              style={{ flex: '1 1 280px', maxWidth: 420 }}
            />
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
                <TarjetaOperador operador={o} />
              </motion.li>
            ))}
          </ul>
          {visibles.length === 0 && <p className="muted">Ningún operador coincide con “{busqueda}”.</p>}
        </>
      )}

      {importando && <ImportarOperadoresModal onClose={() => setImportando(false)} />}
    </>
  );
}

function TarjetaOperador({ operador: o }: { operador: OperadorCda }) {
  return (
    <>
      <div className="ocda-tarjeta-top">
        <span className={`ocda-avatar${o.tieneFoto ? ' con-foto' : ''}`} aria-hidden="true">
          {iniciales(o.apellidosNombres)}
        </span>
        <h3 className="ocda-nombre">{o.apellidosNombres}</h3>
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
          <dd>{o.cargo}</dd>
        </div>
      </dl>
      <span className={`ocda-estado ${o.tieneFoto ? 'ok' : 'pendiente'}`}>
        {o.tieneFoto ? 'Foto cargada' : 'Sin foto'}
      </span>
    </>
  );
}
