import { ConflictException, GoneException, NotFoundException, BadRequestException } from '@nestjs/common';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

import {
  CARGOS_CON_INFORME,
  generarWordInformeProductos,
  CAJA,
  recorteEnCaja,
  nombreArchivoInforme,
} from './informe-productos.documento';
import { InformeProductosService, FALTAN_FOTOS } from './informe-productos.service';
import { hashToken } from './foto-cda.service';
import { FOTO_INFORME_PEQUENA } from '@cne/shared-validation';

/** JPEG mínimo válido (el mismo armado que jpeg.spec.ts). */
function jpegDePrueba(ancho = 800, alto = 600): Buffer {
  const segmento = (m: number, d: Buffer) => {
    const c = Buffer.alloc(4);
    c[0] = 0xff;
    c[1] = m;
    c.writeUInt16BE(d.length + 2, 2);
    return Buffer.concat([c, d]);
  };
  const sof = Buffer.alloc(15);
  sof[0] = 8;
  sof.writeUInt16BE(alto, 1);
  sof.writeUInt16BE(ancho, 3);
  sof[5] = 3;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segmento(0xdb, Buffer.alloc(65, 1)),
    segmento(0xc0, sof),
    segmento(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x12, 0x34]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function textoWord(xml: string): string {
  return (xml.match(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('|');
}

describe('informe de productos (Word)', () => {
  const fotos = [1, 2, 3, 4, 5, 6].map((posicion) => ({ posicion, jpeg: jpegDePrueba(), ancho: 800, alto: 600 }));

  it.each(CARGOS_CON_INFORME)('la plantilla de %s lleva el nombre y las 6 fotos en el anexo', (grupo) => {
    const word = generarWordInformeProductos(grupo, 'Andrade Chasipanta Lizeth Selena', fotos);
    const zip = new PizZip(word);
    const xml = zip.file('word/document.xml')!.asText();
    const texto = textoWord(xml);

    // Nombre en la tabla de datos y en la firma, en mayúsculas.
    expect(texto.match(/ANDRADE CHASIPANTA LIZETH SELENA/g)).toHaveLength(2);
    // El anexo conserva sus títulos y el marcador desaparece.
    expect(texto).toContain('ANEXO');
    expect(texto).toContain('REGISTRO FOTOGRÁFICO DE TRABAJO');
    expect(xml).not.toContain('FOTOS_ANEXO_CNE');
    expect(xml).not.toMatch(/[{}]apellidosNombres/);
    // 6 imágenes con su relación y archivo.
    expect(xml.match(/<w:drawing>/g)).toHaveLength(6);
    const rels = zip.file('word/_rels/document.xml.rels')!.asText();
    for (let p = 1; p <= 6; p++) {
      expect(zip.file(`word/media/informe_foto_${p}.jpg`)).toBeTruthy();
      expect(rels).toContain(`Target="media/informe_foto_${p}.jpg"`);
    }
    // XML bien formado: docxtemplater vuelve a abrirlo (falla si Word no podría).
    expect(() => new Docxtemplater(new PizZip(word), { paragraphLoop: true })).not.toThrow();
  });

  it('las posiciones que faltan quedan como celdas vacías', () => {
    const xml = new PizZip(generarWordInformeProductos('OPERADOR', 'Paz Ana', fotos.slice(0, 2)))
      .file('word/document.xml')!
      .asText();
    expect(xml.match(/<w:drawing>/g)).toHaveLength(2);
    expect(xml).not.toContain('FOTOS_ANEXO_CNE');
  });

  it('escapa < & del nombre y quita caracteres de control', () => {
    const xml = new PizZip(generarWordInformeProductos('OPERADOR', 'Paz <b> & Ana\u0007', []))
      .file('word/document.xml')!
      .asText();
    expect(xml).toContain('PAZ &lt;B&gt; &amp; ANA');
  });

  it('un cargo sin plantilla es un error claro', () => {
    expect(() => generarWordInformeProductos('ARCHIVADOR_ACTAS', 'X', [])).toThrow('No hay informe');
  });

  it('todas las fotos salen del mismo tamaño, en filas de alto fijo', () => {
    const mezcla = [
      { posicion: 1, jpeg: jpegDePrueba(1600, 1200), ancho: 1600, alto: 1200 },
      { posicion: 2, jpeg: jpegDePrueba(900, 1600), ancho: 900, alto: 1600 },
      { posicion: 3, jpeg: jpegDePrueba(1600, 600), ancho: 1600, alto: 600 },
    ];
    const xml = new PizZip(generarWordInformeProductos('ASISTENTE', 'Paz Ana', mezcla)).file('word/document.xml')!.asText();
    const medidas = xml.match(/<wp:extent cx="\d+" cy="\d+"\/>/g)!;
    expect(medidas).toHaveLength(3);
    expect(new Set(medidas)).toEqual(new Set([`<wp:extent cx="${CAJA.cx}" cy="${CAJA.cy}"/>`]));
    expect(xml.match(/<w:trHeight w:val="\d+" w:hRule="exact"\/>/g)).toHaveLength(3);
  });

  it('recorta al centro lo que sobra para llenar la caja sin deformar', () => {
    const proporcion = CAJA.cx / CAJA.cy;
    // Vertical: se corta arriba y abajo por igual.
    const vertical = recorteEnCaja(900, 1600);
    expect(vertical.l).toBe(0);
    expect(vertical.r).toBe(0);
    expect(vertical.t).toBe(vertical.b);
    const altoVisible = 1600 * (1 - (vertical.t + vertical.b) / 100000);
    expect(900 / altoVisible).toBeCloseTo(proporcion, 2);
    // Panorámica: se corta a los lados.
    const ancha = recorteEnCaja(1600, 600);
    expect(ancha.t).toBe(0);
    expect(ancha.l).toBe(ancha.r);
    const anchoVisible = 1600 * (1 - (ancha.l + ancha.r) / 100000);
    expect(anchoVisible / 600).toBeCloseTo(proporcion, 2);
    // Con la misma proporción de la caja no se corta nada.
    expect(recorteEnCaja(CAJA.cx, CAJA.cy)).toEqual({ l: 0, t: 0, r: 0, b: 0 });
    // Medidas inválidas: sin recorte, nunca NaN.
    expect(recorteEnCaja(0, 600)).toEqual({ l: 0, t: 0, r: 0, b: 0 });
    expect(recorteEnCaja(800, Number.NaN)).toEqual({ l: 0, t: 0, r: 0, b: 0 });
  });

  it.each(CARGOS_CON_INFORME)('la hoja del anexo de %s lleva el pie oficial del FORMATO ANEXOS, no el del informe', (grupo) => {
    const zip = new PizZip(generarWordInformeProductos(grupo, 'Paz Ana', fotos));
    const xml = zip.file('word/document.xml')!.asText();
    const seccionAnexo = xml.slice(xml.lastIndexOf('<w:sectPr'));
    const rId = seccionAnexo.match(/<w:footerReference w:type="default" r:id="(rId\d+)"\/>/)?.[1];
    expect(rId).toBeDefined();
    const rels = zip.file('word/_rels/document.xml.rels')!.asText();
    const destino = rels.match(new RegExp(`Id="${rId}"[^>]*Target="([^"]+)"`))?.[1];
    const pie = textoWord(zip.file(`word/${destino}`)!.asText());
    expect(pie).toContain('DELEGACIÓN PROVINCIAL ELECTORAL DE IMBABURA');
    expect(pie).not.toContain('FO-03');
    expect(zip.file('[Content_Types].xml')!.asText()).toContain(`/word/${destino}`);
  });

  it('el nombre del archivo solo lleva los dígitos de la cédula', () => {
    expect(nombreArchivoInforme('1050"123412')).toBe('informe_productos_1050123412.docx');
  });
});

describe('InformeProductosService', () => {
  const operador = { id: 'op1', cedula: '1050123412', apellidosNombres: 'Andrade Chasipanta Lizeth', cargo: 'OPERADOR CDA', grupo: 'OPERADOR', activo: true };
  const token = 'a'.repeat(43);
  const visitaViva = () => ({ id: 'v1', operadorId: 'op1', expiraEn: new Date(Date.now() + 60_000), operador: { activo: true } });

  let prisma: any;
  let storage: { saveEncrypted: jest.Mock; readDecrypted: jest.Mock; remove: jest.Mock };
  let service: InformeProductosService;

  beforeEach(() => {
    prisma = {
      operadorCda: { findUnique: jest.fn().mockResolvedValue(operador) },
      visitaInformeCda: {
        deleteMany: jest.fn().mockReturnValue('borrar'),
        create: jest.fn().mockReturnValue('crear'),
        findUnique: jest.fn().mockResolvedValue(visitaViva()),
        count: jest.fn().mockResolvedValue(0),
      },
      fotoInformeCda: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
        groupBy: jest.fn(),
      },
      $transaction: jest.fn(async (arg: any) => (Array.isArray(arg) ? [null, { id: 'v1' }] : arg(prisma))),
    };
    storage = {
      saveEncrypted: jest.fn().mockResolvedValue('fotos-informe-cda/nueva'),
      readDecrypted: jest.fn().mockResolvedValue(jpegDePrueba()),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    service = new InformeProductosService(prisma, storage as any);
  });

  it('consultar abre una visita de 2 h (solo guarda el hash) y no expone la cédula completa', async () => {
    const r = await service.consultar('1050123412');

    expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.cedula).toBe('1050xxxx12');
    expect(r.tieneInforme).toBe(true);
    expect(r.fotos).toHaveLength(6);
    const datos = prisma.visitaInformeCda.create.mock.calls[0][0].data;
    expect(datos.tokenHash).toBe(hashToken(r.token));
    expect(datos.expiraEn.getTime() - Date.now()).toBeGreaterThan(119 * 60_000);
    expect(prisma.visitaInformeCda.deleteMany).toHaveBeenCalledWith({ where: { expiraEn: { lt: expect.any(Date) } } });
  });

  it('con 10 visitas en 15 min con la misma cédula responde 429; con 9 sí entra', async () => {
    prisma.visitaInformeCda.count.mockResolvedValue(10);
    await expect(service.consultar('1050123412')).rejects.toMatchObject({ status: 429 });
    expect(prisma.visitaInformeCda.create).not.toHaveBeenCalled();
    const where = prisma.visitaInformeCda.count.mock.calls[0][0].where;
    expect(where.operadorId).toBe('op1');
    expect(Date.now() - where.creadoEn.gt.getTime()).toBeGreaterThanOrEqual(15 * 60_000 - 1000);

    prisma.visitaInformeCda.count.mockResolvedValue(9);
    await expect(service.consultar('1050123412')).resolves.toMatchObject({ cedula: '1050xxxx12' });
  });

  it('una cédula inactiva o desconocida es 404', async () => {
    prisma.operadorCda.findUnique.mockResolvedValue({ ...operador, activo: false });
    await expect(service.consultar('1050123412')).rejects.toThrow(NotFoundException);
  });

  it('una visita vencida o inexistente es 410', async () => {
    prisma.visitaInformeCda.findUnique.mockResolvedValue({ ...visitaViva(), expiraEn: new Date(Date.now() - 1) });
    await expect(service.verFoto(token, 1)).rejects.toThrow(GoneException);
    prisma.visitaInformeCda.findUnique.mockResolvedValue(null);
    await expect(service.generarPublico(token)).rejects.toThrow(GoneException);
  });

  it('subir reemplaza la foto de la posición y borra la anterior', async () => {
    prisma.fotoInformeCda.findUnique.mockResolvedValue({ fotoKey: 'fotos-informe-cda/vieja' });
    prisma.fotoInformeCda.findMany.mockResolvedValue([{ posicion: 3, visitaId: 'v1' }]);
    const file = { buffer: jpegDePrueba(1024, 768), size: 500 } as Express.Multer.File;

    const r = await service.subirFoto(token, 3, file, 'LOPDP');

    const upsert = prisma.fotoInformeCda.upsert.mock.calls[0][0];
    expect(upsert.where).toEqual({ operadorId_posicion: { operadorId: 'op1', posicion: 3 } });
    expect(upsert.update).toMatchObject({ fotoKey: 'fotos-informe-cda/nueva', ancho: 1024, alto: 768, visitaId: 'v1' });
    expect(storage.remove).toHaveBeenCalledWith('fotos-informe-cda/vieja');
    expect(r.fotos[2]).toEqual({ posicion: 3, cargada: true, deEstaVisita: true });
  });

  it.each([
    [799, 600],
    [600, 799],
    [1600, 599],
  ])('una foto de %i × %i px es muy pequeña: no se guarda', async (ancho, alto) => {
    const file = { buffer: jpegDePrueba(ancho, alto), size: 500 } as Express.Multer.File;
    await expect(service.subirFoto(token, 1, file, 'LOPDP')).rejects.toThrow(FOTO_INFORME_PEQUENA);
    expect(storage.saveEncrypted).not.toHaveBeenCalled();
  });

  it.each([
    [800, 600],
    [600, 800],
  ])('una foto de %i × %i px (la medida mínima) sí se guarda', async (ancho, alto) => {
    const file = { buffer: jpegDePrueba(ancho, alto), size: 500 } as Express.Multer.File;
    await service.subirFoto(token, 1, file, 'LOPDP');
    expect(storage.saveEncrypted).toHaveBeenCalled();
  });

  it('un archivo que no es JPEG no se guarda', async () => {
    const file = { buffer: Buffer.from('no soy jpeg'), size: 11 } as Express.Multer.File;
    await expect(service.subirFoto(token, 1, file, 'LOPDP')).rejects.toThrow(BadRequestException);
    expect(storage.saveEncrypted).not.toHaveBeenCalled();
  });

  it('si falla la base, se borra el archivo recién subido', async () => {
    prisma.fotoInformeCda.upsert.mockRejectedValue(new Error('caída'));
    const file = { buffer: jpegDePrueba(), size: 500 } as Express.Multer.File;
    await expect(service.subirFoto(token, 1, file, 'LOPDP')).rejects.toThrow('caída');
    expect(storage.remove).toHaveBeenCalledWith('fotos-informe-cda/nueva');
  });

  it('solo se ve una foto subida en esta misma visita', async () => {
    prisma.fotoInformeCda.findUnique.mockResolvedValue({ fotoKey: 'k', visitaId: 'otra-visita' });
    await expect(service.verFoto(token, 2)).rejects.toThrow(NotFoundException);

    prisma.fotoInformeCda.findUnique.mockResolvedValue({ fotoKey: 'k', visitaId: 'v1' });
    await expect(service.verFoto(token, 2)).resolves.toBeInstanceOf(Buffer);
  });

  it('el informe público exige las 6 fotos subidas en esta visita', async () => {
    const seis = (visita: string) =>
      [1, 2, 3, 4, 5, 6].map((p) => ({ posicion: p, visitaId: p === 6 ? visita : 'v1', fotoKey: `k${p}`, ancho: 800, alto: 600 }));

    prisma.fotoInformeCda.findMany.mockResolvedValue(seis('vieja'));
    await expect(service.generarPublico(token)).rejects.toThrow(new ConflictException(FALTAN_FOTOS));

    prisma.fotoInformeCda.findMany.mockResolvedValue(seis('v1'));
    const r = await service.generarPublico(token);
    expect(r.nombre).toBe('informe_productos_1050123412.docx');
    expect(r.operadorId).toBe('op1');
    expect(storage.readDecrypted).toHaveBeenCalledTimes(6);
  });

  it('la Delegación descarga con las fotos que haya; un cargo sin plantilla es 400', async () => {
    prisma.fotoInformeCda.findMany.mockResolvedValue([{ posicion: 1, fotoKey: 'k1', ancho: 800, alto: 600 }]);
    await expect(service.informe('op1')).resolves.toMatchObject({ nombre: 'informe_productos_1050123412.docx' });

    prisma.operadorCda.findUnique.mockResolvedValue({ ...operador, grupo: 'ARCHIVADOR_ACTAS' });
    await expect(service.informe('op1')).rejects.toThrow(BadRequestException);
  });

  it('avance: cuántas fotos lleva cada persona', async () => {
    prisma.fotoInformeCda.groupBy.mockResolvedValue([{ operadorId: 'op1', _count: { _all: 4 } }]);
    await expect(service.avance()).resolves.toEqual([{ operadorId: 'op1', fotos: 4 }]);
  });
});
