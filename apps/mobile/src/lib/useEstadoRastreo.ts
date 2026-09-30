import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  activarRastreoSegundoPlano,
  asegurarRastreoSiHayPermiso,
  permisoSegundoPlanoConcedido,
} from './location';

export type EstadoRastreo = 'verificando' | 'activo' | 'inactivo';

/**
 * Estado del rastreo en segundo plano mientras el operador está en tránsito.
 * Se re-verifica al volver al foreground: si el operador concedió "Permitir
 * siempre" desde Ajustes, el rastreo arranca solo y el aviso desaparece.
 */
export function useEstadoRastreo() {
  const [estado, setEstado] = useState<EstadoRastreo>('verificando');
  const [activando, setActivando] = useState(false);
  const [permisoDenegado, setPermisoDenegado] = useState(false);
  const montado = useRef(true);
  // Solo aplica el resultado de la verificación más reciente: una lenta que
  // termina tarde no debe volver a mostrar el aviso.
  const ultimaVerificacion = useRef(0);
  const activacionEnCurso = useRef(false);

  const refrescar = useCallback(async () => {
    const id = ++ultimaVerificacion.current;
    const activo = await asegurarRastreoSiHayPermiso();
    if (!montado.current || id !== ultimaVerificacion.current) return;
    setEstado(activo ? 'activo' : 'inactivo');
    if (activo) setPermisoDenegado(false);
  }, []);

  useEffect(() => {
    montado.current = true;
    refrescar();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refrescar();
    });
    return () => {
      montado.current = false;
      sub.remove();
    };
  }, [refrescar]);

  const activar = useCallback(async () => {
    // Guard síncrono: el estado `activando` tarda un render en deshabilitar el botón.
    if (activacionEnCurso.current) return;
    activacionEnCurso.current = true;
    setActivando(true);
    try {
      const resultado = await activarRastreoSegundoPlano();
      // 'fallo' también ocurre con GPS apagado o error del servicio: solo se
      // ofrece "Abrir ajustes" si de verdad falta el permiso.
      const sinPermiso = resultado === 'fallo' && !(await permisoSegundoPlanoConcedido());
      if (montado.current) setPermisoDenegado(sinPermiso);
      await refrescar();
    } finally {
      activacionEnCurso.current = false;
      if (montado.current) setActivando(false);
    }
  }, [refrescar]);

  return { estado, activando, permisoDenegado, activar };
}
