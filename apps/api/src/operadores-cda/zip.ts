/**
 * Suma el tamaño descomprimido de todas las entradas de un ZIP (un .xlsx es
 * un ZIP) leyendo solo su directorio central, sin descomprimir nada. Sirve
 * para rechazar "zip bombs" antes de que ExcelJS las expanda en memoria.
 * Devuelve null si el archivo no tiene un directorio central válido o usa
 * ZIP64 (tamaños que no caben en 32 bits): se trata como no aceptable.
 */
export function tamanoDescomprimidoZip(buf: Buffer): number | null {
  const FIRMA_FIN = 0x06054b50;
  const FIRMA_ENTRADA = 0x02014b50;
  // El registro de fin mide 22 bytes + un comentario de hasta 65535.
  const desde = Math.max(0, buf.length - 22 - 0xffff);
  let fin = -1;
  for (let i = buf.length - 22; i >= desde; i--) {
    if (buf.readUInt32LE(i) === FIRMA_FIN) {
      fin = i;
      break;
    }
  }
  if (fin < 0) return null;

  const entradas = buf.readUInt16LE(fin + 10);
  let pos = buf.readUInt32LE(fin + 16);
  let total = 0;
  for (let n = 0; n < entradas; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== FIRMA_ENTRADA) return null;
    const descomprimido = buf.readUInt32LE(pos + 24);
    if (descomprimido === 0xffffffff) return null;
    total += descomprimido;
    pos += 46 + buf.readUInt16LE(pos + 28) + buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32);
  }
  return total;
}
