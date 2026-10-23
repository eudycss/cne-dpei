/**
 * Revisa que un archivo sea un JPEG bien formado y le quita los metadatos
 * (EXIF con la ubicación GPS, XMP, miniaturas, comentarios…), sin decodificar
 * la imagen. El navegador ya los quita al redibujar la foto en un canvas; esto
 * es la segunda barrera por si alguien sube el archivo sin pasar por la página.
 *
 * Recorre todo el archivo (también entre los scans de un JPEG progresivo) y
 * corta en el primer EOI: lo que venga después no se guarda.
 */

/** El navegador la deja en 800 px; más de esto no vino de la página. */
const MAX_LADO = 2000;

// APP0…APP15 (JFIF, EXIF, XMP, ICC, Photoshop…) y COM. Ninguno hace falta para ver la foto.
const esMetadato = (m: number) => (m >= 0xe0 && m <= 0xef) || m === 0xfe;
// SOF0…SOF15 menos DHT (C4), JPG (C8) y DAC (CC): traen alto y ancho.
const esSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
// Marcadores sin longitud: TEM y RST0…RST7.
const sinLongitud = (m: number) => m === 0x01 || (m >= 0xd0 && m <= 0xd7);

export interface JpegLimpio {
  limpio: Buffer;
  ancho: number;
  alto: number;
}

/** Devuelve el JPEG sin metadatos, o null si no es un JPEG válido. */
export function limpiarJpeg(buf: Buffer): JpegLimpio | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;

  const partes: Buffer[] = [buf.subarray(0, 2)];
  let ancho = 0;
  let alto = 0;
  let huboScan = false;
  let i = 2;
  while (i + 1 < buf.length) {
    if (buf[i] !== 0xff) return null;
    while (i + 1 < buf.length && buf[i + 1] === 0xff) i++; // bytes de relleno
    const marcador = buf[i + 1];
    if (marcador === undefined) return null;

    if (marcador === 0xd9) {
      // EOI: fin de la imagen. Lo que venga detrás (un ZIP, otro EXIF…) se descarta.
      if (!huboScan) return null;
      partes.push(buf.subarray(i, i + 2));
      return { limpio: Buffer.concat(partes), ancho, alto };
    }
    if (sinLongitud(marcador)) {
      partes.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > buf.length) return null;
    const largo = buf.readUInt16BE(i + 2);
    let fin = i + 2 + largo;
    if (largo < 2 || fin > buf.length) return null;

    if (esSof(marcador)) {
      if (largo < 7) return null;
      alto = buf.readUInt16BE(i + 5);
      ancho = buf.readUInt16BE(i + 7);
      if (!ancho || !alto || ancho > MAX_LADO || alto > MAX_LADO) return null;
    }
    if (marcador === 0xda) {
      if (!ancho || !alto) return null;
      huboScan = true;
      // Datos comprimidos: avanzan hasta el siguiente marcador real (FF00 es un
      // FF escapado y FFD0…FFD7 son reinicios, ambos parte de los datos).
      while (fin + 1 < buf.length) {
        if (buf[fin] === 0xff && buf[fin + 1] !== 0x00 && !(buf[fin + 1] >= 0xd0 && buf[fin + 1] <= 0xd7)) break;
        fin++;
      }
      if (fin + 1 >= buf.length) return null; // terminó sin EOI
    }
    if (!esMetadato(marcador)) partes.push(buf.subarray(i, fin));
    i = fin;
  }
  return null;
}
