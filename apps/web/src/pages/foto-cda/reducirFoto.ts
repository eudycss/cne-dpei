/**
 * Reduce la foto en el propio celular antes de subirla: lado mayor de 800 px
 * y unos 200 KB. Al redibujarla en un canvas se pierden los metadatos EXIF
 * (ubicación GPS, modelo del teléfono…), así que no salen del dispositivo.
 */

export const LADO_MAXIMO = 800;
export const BYTES_OBJETIVO = 200 * 1024;
const CALIDADES = [0.85, 0.75, 0.65, 0.55, 0.45];

/** Medidas que caben en `maximo` x `maximo` sin deformar (nunca agranda). */
export function medidasReducidas(ancho: number, alto: number, maximo = LADO_MAXIMO) {
  const escala = Math.min(1, maximo / Math.max(ancho, alto));
  return { ancho: Math.max(1, Math.round(ancho * escala)), alto: Math.max(1, Math.round(alto * escala)) };
}

/** Prueba calidades de mayor a menor y se queda con la primera que pesa menos del objetivo. */
export async function elegirCalidad(
  codificar: (calidad: number) => Promise<Blob>,
  objetivo = BYTES_OBJETIVO,
): Promise<Blob> {
  let ultimo: Blob | null = null;
  for (const calidad of CALIDADES) {
    ultimo = await codificar(calidad);
    if (ultimo.size <= objetivo) return ultimo;
  }
  return ultimo as Blob;
}

/** Abre la imagen respetando la orientación de la cámara (EXIF) antes de que se pierda. */
async function abrirImagen(archivo: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(archivo, { imageOrientation: 'from-image' });
    } catch {
      // Algunos navegadores no aceptan la opción: se intenta con <img>.
    }
  }
  const url = URL.createObjectURL(archivo);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export class FotoIlegibleError extends Error {
  constructor() {
    super('No se pudo abrir la foto. Tome otra o elija una imagen JPG o PNG.');
  }
}

/** Devuelve la foto reducida, como JPEG y sin metadatos. */
export async function reducirFoto(archivo: Blob): Promise<Blob> {
  let imagen: Awaited<ReturnType<typeof abrirImagen>>;
  try {
    imagen = await abrirImagen(archivo);
  } catch {
    throw new FotoIlegibleError();
  }
  const { ancho, alto } = medidasReducidas(imagen.width, imagen.height);
  const canvas = document.createElement('canvas');
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new FotoIlegibleError();
  ctx.drawImage(imagen, 0, 0, ancho, alto);
  return elegirCalidad(
    (calidad) =>
      new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new FotoIlegibleError())), 'image/jpeg', calidad),
      ),
  );
}
