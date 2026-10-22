import { useEffect } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { PASOS_PREPARACION, type PasoId } from '../lib/flujo';
import { usePreparacion } from '../lib/queries/preparacion';

/** Al terminar la preparación se sigue con la operación del evento. */
const DESPUES_DE_PREPARACION = { ruta: '/operadores', etiqueta: 'Monitoreo' };

/** Listados cuyos cambios mueven el estado de la preparación. */
const CLAVES_PREPARACION = new Set(['recintos', 'users', 'militares', 'eventos', 'asignaciones', 'kits']);

/**
 * Las páginas invalidan su listado después de crear, editar o borrar; con eso
 * basta para refrescar el estado de la preparación sin tocar cada página.
 * Una invalidación llega una vez por cada página o búsqueda en caché, así que
 * se juntan en un solo refresco.
 */
function useRefrescarAlCambiar() {
  const qc = useQueryClient();
  useEffect(() => {
    let pendiente = false;
    return qc.getQueryCache().subscribe((evento) => {
      if (evento.type !== 'updated' || evento.action.type !== 'invalidate') return;
      const clave = evento.query.queryKey[0];
      if (pendiente || typeof clave !== 'string' || !CLAVES_PREPARACION.has(clave)) return;
      pendiente = true;
      queueMicrotask(() => {
        pendiente = false;
        qc.invalidateQueries({ queryKey: ['preparacion'] }, { cancelRefetch: false });
      });
    });
  }, [qc]);
}

/**
 * Guía de la preparación dentro de cada paso: avisa (sin bloquear) si falta un
 * paso previo y, cuando este ya tiene datos, ofrece ir al siguiente. Solo el
 * administrador puede completar pasos; los demás roles ven un aviso neutro.
 */
export function PasoFlujo({ paso }: { paso: PasoId }) {
  useRefrescarAlCambiar();
  const { user } = useAuth();
  const { data } = usePreparacion();
  // Si el estado no se puede cargar, la página sigue igual sin la guía.
  if (!data) return null;

  const esAdmin = user?.roles.includes('ADMINISTRADOR') ?? false;
  const indice = PASOS_PREPARACION.findIndex((p) => p.id === paso);
  const actual = PASOS_PREPARACION[indice];
  const faltantes = PASOS_PREPARACION.filter((p) => actual.requisitos.includes(p.id) && data.conteos[p.id] === 0);
  const siguiente = PASOS_PREPARACION[indice + 1] ?? DESPUES_DE_PREPARACION;
  const hecho = data.conteos[paso] > 0;
  if (faltantes.length === 0 && !hecho) return null;

  return (
    <section className="paso-flujo" aria-label="Guía de preparación">
      {faltantes.length > 0 && (
        <p className="banner">
          {esAdmin ? 'Antes de este paso falta completar: ' : 'Aún no hay datos de: '}
          {faltantes.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ' y '}
              <Link to={p.ruta}>{p.etiqueta}</Link>
            </span>
          ))}
          {esAdmin ? '. Puede seguir trabajando aquí, pero algunos datos no estarán disponibles.' : '.'}
        </p>
      )}
      {hecho && (
        <Link to={siguiente.ruta} className="btn secondary paso-flujo-siguiente">
          Siguiente: {siguiente.etiqueta} <span aria-hidden="true">→</span>
        </Link>
      )}
    </section>
  );
}
