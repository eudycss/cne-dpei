import { useState } from 'react';
import { sileo } from 'sileo';
import { guardarArchivo } from './queries/custodia';

/** Texto de un Blob (FileReader como respaldo de navegadores sin Blob.text). */
function textoDeBlob(b: Blob): Promise<string> {
  if (typeof b.text === 'function') return b.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(b);
  });
}

/**
 * Descarga de PDFs generados por la API: guarda el archivo y, si falla, muestra
 * el mensaje del servidor (con responseType blob llega dentro de un Blob).
 * `descargando` es la clave de la descarga en curso (una a la vez).
 */
export function useDescargaPdf(mensajePorDefecto: string) {
  const [descargando, setDescargando] = useState<string | null>(null);

  async function descargar(clave: string, accion: () => Promise<{ data: Blob }>, archivo: string) {
    setDescargando(clave);
    try {
      guardarArchivo((await accion()).data, archivo);
    } catch (e: any) {
      let mensaje = mensajePorDefecto;
      try {
        const cuerpo = e?.response?.data;
        if (cuerpo instanceof Blob) mensaje = JSON.parse(await textoDeBlob(cuerpo))?.message ?? mensaje;
      } catch {
        /* se queda el mensaje genérico */
      }
      sileo.error({ title: mensaje });
    } finally {
      setDescargando(null);
    }
  }

  return { descargando, descargar };
}
