/**
 * Convierte la primera página de un PDF (el certificado que descarga Evatics)
 * en imagen dentro del navegador. Así el servidor recibe siempre un JPEG: lo
 * leen igual Gemini y Groq, y el supervisor ve lo mismo que la IA. pdf.js se
 * carga solo cuando alguien elige un PDF.
 */

/** Tope para no abrir archivos enormes en un celular. */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
/** Lado mayor de la imagen: el nombre debe leerse bien antes de reducirla. */
export const LADO_PDF = 2000;
/** Un PDF pesado no debe dejar la pantalla en «Preparando…» para siempre. */
export const TIEMPO_PDF_MS = 30_000;

export class PdfIlegibleError extends Error {
  constructor(mensaje = 'No se pudo abrir el PDF. Elija otro archivo o tome una foto del certificado.', causa?: unknown) {
    super(mensaje, causa === undefined ? undefined : { cause: causa });
  }
}

export function esPdf(archivo: Blob): boolean {
  if (archivo.type === 'application/pdf') return true;
  return typeof File !== 'undefined' && archivo instanceof File && /\.pdf$/i.test(archivo.name);
}

/** Bytes del archivo; FileReader para navegadores sin Blob.arrayBuffer (Safari antiguo). */
function leerBytes(archivo: Blob): Promise<Uint8Array> {
  if (typeof archivo.arrayBuffer === 'function') return archivo.arrayBuffer().then((b) => new Uint8Array(b));
  return new Promise((ok, mal) => {
    const lector = new FileReader();
    lector.onload = () => ok(new Uint8Array(lector.result as ArrayBuffer));
    lector.onerror = () => mal(lector.error);
    lector.readAsArrayBuffer(archivo);
  });
}

type Pdfjs = Pick<typeof import('pdfjs-dist'), 'getDocument'>;

async function cargarPdfjs(): Promise<Pdfjs> {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

/** Primera página del PDF como PNG (luego reducirFoto la pasa a JPEG sin metadatos). */
export async function pdfAImagen(
  archivo: Blob,
  cargar: () => Promise<Pdfjs> = cargarPdfjs,
  tiempoMs = TIEMPO_PDF_MS,
): Promise<Blob> {
  if (archivo.size > MAX_PDF_BYTES) {
    throw new PdfIlegibleError('El PDF pesa más de 10 MB. Elija el certificado o tome una foto.');
  }
  let tarea: ReturnType<Pdfjs['getDocument']> | undefined;
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const agotado = new Promise<never>((_, mal) => {
    reloj = setTimeout(() => mal(new PdfIlegibleError('El PDF tarda demasiado en abrirse. Tome una foto del certificado.')), tiempoMs);
  });
  try {
    return await Promise.race([convertir(), agotado]);
  } catch (e) {
    if (e instanceof PdfIlegibleError) throw e;
    throw new PdfIlegibleError(undefined, e);
  } finally {
    clearTimeout(reloj);
    await tarea?.destroy().catch(() => undefined);
  }

  async function convertir(): Promise<Blob> {
    const pdfjs = await cargar();
    const datos = await leerBytes(archivo);
    // Sin formularios XFA: el PDF lo trae cualquiera (pdf.js 6 ya no usa eval).
    tarea = pdfjs.getDocument({ data: datos, enableXfa: false, stopAtErrors: true });
    const doc = await tarea.promise;
    const pagina = await doc.getPage(1);
    const base = pagina.getViewport({ scale: 1 });
    const escala = Math.min(4, LADO_PDF / Math.max(base.width, base.height));
    const vista = pagina.getViewport({ scale: escala });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(vista.width));
    canvas.height = Math.max(1, Math.round(vista.height));
    await pagina.render({ canvas, viewport: vista, background: '#ffffff' }).promise;
    return await new Promise<Blob>((ok, mal) =>
      canvas.toBlob((b) => (b ? ok(b) : mal(new PdfIlegibleError())), 'image/png'),
    );
  }
}
