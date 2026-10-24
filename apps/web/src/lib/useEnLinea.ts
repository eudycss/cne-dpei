import { useEffect, useState } from 'react';

/**
 * true si el navegador tiene red. Solo detecta "sin red" con certeza; con
 * red pero sin internet, las peticiones fallan y se maneja el error.
 */
export function useEnLinea(): boolean {
  const [enLinea, setEnLinea] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const si = () => setEnLinea(true);
    const no = () => setEnLinea(false);
    window.addEventListener('online', si);
    window.addEventListener('offline', no);
    return () => {
      window.removeEventListener('online', si);
      window.removeEventListener('offline', no);
    };
  }, []);
  return enLinea;
}
