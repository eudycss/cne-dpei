import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { activarRastreoSegundoPlano, asegurarRastreoSiHayPermiso } from './location';

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

  const refrescar = useCallback(async () => {
    const activo = await asegurarRastreoSiHayPermiso();
    if (montado.current) setEstado(activo ? 'activo' : 'inactivo');
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
    setActivando(true);
    try {
      const resultado = await activarRastreoSegundoPlano();
      if (montado.current) setPermisoDenegado(resultado === 'fallo');
      await refrescar();
    } finally {
      if (montado.current) setActivando(false);
    }
  }, [refrescar]);

  return { estado, activando, permisoDenegado, activar };
}
