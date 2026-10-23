import { limpiarJpeg } from './jpeg';

/** Segmento con marcador y largo (el largo incluye sus 2 bytes). */
const segmento = (marcador: number, datos: Buffer) => {
  const cab = Buffer.alloc(4);
  cab[0] = 0xff;
  cab[1] = marcador;
  cab.writeUInt16BE(datos.length + 2, 2);
  return Buffer.concat([cab, datos]);
};

const sof = (alto: number, ancho: number) => {
  const d = Buffer.alloc(15);
  d[0] = 8; // precisión
  d.writeUInt16BE(alto, 1);
  d.writeUInt16BE(ancho, 3);
  d[5] = 3;
  return segmento(0xc0, d);
};

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);
const JFIF = segmento(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'binary'));
const EXIF = segmento(0xe1, Buffer.from('Exif\0\0GPSLatitude=0.35849'));
const XMP = segmento(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/ <x:xmpmeta/>'));
const COMENTARIO = segmento(0xfe, Buffer.from('tomada en Ibarra'));
const DQT = segmento(0xdb, Buffer.alloc(65, 1));
const SOS = segmento(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0]));
const DATOS = Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]); // incluye un byte escapado y un RST

const jpeg = (...partes: Buffer[]) => Buffer.concat([SOI, ...partes, SOS, DATOS, EOI]);

describe('limpiarJpeg', () => {
  it('quita JFIF, EXIF (con GPS), XMP y comentarios; conserva tablas e imagen', () => {
    const r = limpiarJpeg(jpeg(JFIF, EXIF, XMP, COMENTARIO, DQT, sof(600, 800)));
    expect(r).not.toBeNull();
    expect(r!.ancho).toBe(800);
    expect(r!.alto).toBe(600);
    expect(r!.limpio).toEqual(jpeg(DQT, sof(600, 800)));
    expect(r!.limpio.toString('latin1')).not.toMatch(/GPS|xmpmeta|Ibarra/);
  });

  it('descarta lo que venga después del fin de la imagen (EOI)', () => {
    const conCola = Buffer.concat([jpeg(sof(10, 10)), Buffer.from('PK zip escondido'), EOI]);
    const r = limpiarJpeg(conCola);
    expect(r!.limpio).toEqual(jpeg(sof(10, 10)));
  });

  it('JPEG progresivo: quita los metadatos que vengan entre scans', () => {
    const progresivo = Buffer.concat([SOI, sof(10, 10), SOS, DATOS, EXIF, DQT, SOS, DATOS, EOI]);
    const r = limpiarJpeg(progresivo);
    expect(r!.limpio).toEqual(Buffer.concat([SOI, sof(10, 10), SOS, DATOS, DQT, SOS, DATOS, EOI]));
  });

  it('acepta bytes de relleno 0xFF antes de un marcador', () => {
    const relleno = Buffer.from([0xff, 0xff]);
    const r = limpiarJpeg(Buffer.concat([SOI, relleno.subarray(0, 1), sof(10, 10), SOS, DATOS, EOI]));
    expect(r?.ancho).toBe(10);
  });

  it.each([
    ['vacío', Buffer.alloc(0)],
    ['un PNG', Buffer.from('89504e470d0a1a0a0000', 'hex')],
    ['un HTML con extensión .jpg', Buffer.from('<html><script>alert(1)</script></html>')],
    ['un JPEG cortado (sin FFD9)', jpeg(sof(10, 10)).subarray(0, -2)],
    ['sin dimensiones (sin SOF)', jpeg(JFIF)],
    ['de más de 2000 px', jpeg(sof(2001, 300))],
    ['con ancho 0', jpeg(sof(10, 0))],
    ['con un largo de segmento que se sale del archivo', Buffer.concat([SOI, Buffer.from([0xff, 0xe1, 0xff, 0xff]), EOI])],
    ['que termina antes de la imagen', Buffer.concat([SOI, sof(10, 10), EOI])],
    ['con basura entre segmentos', Buffer.concat([SOI, Buffer.from([0x00]), sof(10, 10), SOS, DATOS, EOI])],
  ])('rechaza %s', (_caso, buf) => {
    expect(limpiarJpeg(buf)).toBeNull();
  });
});
