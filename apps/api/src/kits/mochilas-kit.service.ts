import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import {
  leerCodigoQrKit,
  leerNumeroMochila,
  MAX_FILAS_CARGA_MOCHILAS,
  numeroMochilaRequestSchema,
} from '@cne/shared-validation';
import type {
  CargaMochilasResult,
  FilaCargaMochila,
  MochilaPorQr,
  NumeroMochilaRequest,
  NumeroMochilaResponse,
} from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';
import { parseUploadRows } from '../common/parse-upload-rows';

/** Encabezado de la plantilla → claves que se aceptan (sin tildes ni signos, en minúsculas). */
const COLUMNAS = {
  recinto: ['recinto', 'codigorecinto', 'codrecinto'],
  codigo: ['codigoqr', 'qr', 'codigo', 'codigounico'],
  numero: ['nmochila', 'nomochila', 'numeromochila', 'mochila', 'numero'],
} as const;

/** "N.º mochila" → "nmochila"; "Código QR" → "codigoqr". */
function claveColumna(encabezado: string): string {
  return encabezado
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function columna(fila: Record<string, string>, aceptadas: readonly string[]): string {
  for (const [encabezado, valor] of Object.entries(fila)) {
    if (aceptadas.includes(claveColumna(encabezado))) return (valor ?? '').trim();
  }
  return '';
}

/** Solo .xlsx o .csv; un archivo dañado es un 400 (sin el detalle interno), no un 500. */
async function leerArchivo(file: Express.Multer.File): Promise<Record<string, string>[]> {
  const nombre = (file.originalname ?? '').toLowerCase();
  if (!nombre.endsWith('.xlsx') && !nombre.endsWith('.csv')) {
    throw new BadRequestException('Use la plantilla en Excel (.xlsx) o un archivo .csv');
  }
  try {
    return await parseUploadRows(file);
  } catch {
    throw new BadRequestException('No se pudo leer el archivo: revise que sea la plantilla de mochilas');
  }
}

/** "0971" y "971" son el mismo recinto (Excel suele quitar o poner ceros). */
const claveRecinto = (codigo: string) => codigo.trim().replace(/^0+(?=\d)/, '');

/** Choque con un índice único (otro guardó lo mismo a la vez). */
const esUnicoRepetido = (e: unknown) => (e as { code?: string } | null)?.code === 'P2002';

interface KitDelEvento {
  codigoUnico: string;
  recinto: { codigoRecinto: string; nombre: string } | null;
}

/**
 * N.º de mochila de cada QR. El número es de la mochila física (el código del
 * QR se repite en todos los eventos del recinto), así que se guarda por código,
 * no por kit ni por evento.
 */
@Injectable()
export class MochilasKitService {
  constructor(private readonly prisma: PrismaService) {}

  /** Número de cada código que tenga uno. */
  async numerosPorCodigo(codigos: string[]): Promise<Map<string, number>> {
    if (codigos.length === 0) return new Map();
    const filas = await this.prisma.mochilaKit.findMany({
      where: { codigoUnico: { in: codigos } },
      select: { codigoUnico: true, numero: true },
    });
    return new Map<string, number>(filas.map((f) => [f.codigoUnico, f.numero]));
  }

  /**
   * Lo que trae un QR escaneado: el kit más reciente con ese código (el del
   * evento activo si lo hay), su recinto y el N.º de mochila si ya tiene.
   */
  async porQr(valor: string): Promise<MochilaPorQr> {
    const codigo = leerCodigoQrKit(valor);
    if (!codigo) throw new BadRequestException('Ese QR no es de un kit');
    const kits = await this.prisma.kitElectoral.findMany({
      where: { OR: [{ codigoUnico: codigo }, { qrPayload: codigo }] },
      orderBy: { creadoEn: 'desc' },
      take: 20,
      select: {
        id: true,
        codigoUnico: true,
        nombre: true,
        eventoId: true,
        recinto: { select: { codigoRecinto: true, nombre: true } },
      },
    });
    if (kits.length === 0) throw new NotFoundException(`El QR ${codigo} no es de ningún kit registrado`);
    const eventos = await this.prisma.eventoElectoral.findMany({
      where: { id: { in: [...new Set(kits.map((k) => k.eventoId))] } },
      select: { id: true, nombre: true, estado: true },
    });
    const eventoPorId = new Map<string, { nombre: string; estado: string }>(eventos.map((e) => [e.id, e]));
    const kit = kits.find((k) => eventoPorId.get(k.eventoId)?.estado === 'ACTIVO') ?? kits[0];
    const mochila = await this.prisma.mochilaKit.findUnique({ where: { codigoUnico: kit.codigoUnico }, select: { numero: true } });
    return {
      kitId: kit.id,
      codigoUnico: kit.codigoUnico,
      numeroMochila: mochila?.numero ?? null,
      nombreKit: kit.nombre,
      evento: eventoPorId.get(kit.eventoId)?.nombre ?? '',
      recinto: kit.recinto,
    };
  }

  /**
   * Pone, cambia o quita (null) el N.º de mochila del QR del kit. Si el número
   * ya es de otro QR, avisa (409) salvo que se pida `reemplazar`, y eso solo lo
   * puede el administrador (`puedeReemplazar`): el supervisor solo recibe el aviso.
   */
  async asignar(
    kitId: string,
    input: NumeroMochilaRequest,
    usuarioId?: string,
    puedeReemplazar = false,
  ): Promise<NumeroMochilaResponse> {
    const parsed = numeroMochilaRequestSchema.parse(input);
    const numero = parsed.numero;
    const reemplazar = parsed.reemplazar === true && puedeReemplazar;
    const kit = await this.prisma.kitElectoral.findUnique({ where: { id: kitId }, select: { codigoUnico: true } });
    if (!kit) throw new NotFoundException('Kit no encontrado');
    const { codigoUnico } = kit;
    const actual = await this.prisma.mochilaKit.findUnique({ where: { codigoUnico }, select: { numero: true } });
    const numeroAnterior = actual?.numero ?? null;

    if (numero === null) {
      await this.prisma.mochilaKit.deleteMany({ where: { codigoUnico } });
      return { codigoUnico, numeroMochila: null, numeroAnterior, quitadoDe: null };
    }

    const duenio = await this.prisma.mochilaKit.findUnique({ where: { numero }, select: { codigoUnico: true } });
    const quitadoDe = duenio && duenio.codigoUnico !== codigoUnico ? duenio.codigoUnico : null;
    if (quitadoDe && !reemplazar) {
      throw new ConflictException({
        message:
          `La mochila N.º ${numero} ya está ligada al QR ${quitadoDe}${await this.textoRecinto(quitadoDe)}.` +
          (puedeReemplazar ? '' : ' Revise el número de la mochila; si está bien, avise al administrador.'),
        codigo: 'MOCHILA_EN_OTRO_QR',
        codigoUnico: quitadoDe,
        puedeReemplazar,
      });
    }

    try {
      await this.prisma.$transaction([
        // deleteMany: si otro ya se lo quitó, no falla.
        ...(quitadoDe ? [this.prisma.mochilaKit.deleteMany({ where: { codigoUnico: quitadoDe } })] : []),
        this.prisma.mochilaKit.upsert({
          where: { codigoUnico },
          create: { codigoUnico, numero, actualizadoPorId: usuarioId ?? null },
          update: { numero, actualizadoPorId: usuarioId ?? null },
        }),
      ]);
    } catch (e) {
      if (esUnicoRepetido(e)) {
        throw new ConflictException('Otra persona acaba de cambiar ese N.º de mochila. Recargue la página e intente de nuevo.');
      }
      throw e;
    }
    return { codigoUnico, numeroMochila: numero, numeroAnterior, quitadoDe };
  }

  /**
   * Carga desde Excel/CSV: cada fila trae el Código QR o el Recinto (si tiene un
   * solo kit en el evento) y el N.º de mochila. Con `aplicar` guarda las filas
   * válidas; sin él solo devuelve la vista previa.
   */
  async cargar(file: Express.Multer.File | undefined, eventoId: string, aplicar: boolean, usuarioId?: string): Promise<CargaMochilasResult> {
    if (!file) throw new BadRequestException('Adjunte el archivo de mochilas');
    if (!eventoId) throw new BadRequestException('Falta el evento');
    const evento = await this.prisma.eventoElectoral.findUnique({ where: { id: eventoId }, select: { id: true } });
    if (!evento) throw new NotFoundException('Evento no encontrado');

    const datos = (await leerArchivo(file)).filter((f) => Object.values(f).some((v) => (v ?? '').trim() !== ''));
    if (datos.length === 0) throw new BadRequestException('El archivo no tiene filas');
    if (datos.length > MAX_FILAS_CARGA_MOCHILAS) {
      throw new BadRequestException(`El archivo tiene ${datos.length} filas; el máximo es ${MAX_FILAS_CARGA_MOCHILAS}`);
    }

    const [kits, mochilas] = await Promise.all([
      this.prisma.kitElectoral.findMany({
        where: { eventoId, esPrueba: false },
        select: { codigoUnico: true, recinto: { select: { codigoRecinto: true, nombre: true } } },
      }),
      this.prisma.mochilaKit.findMany({ select: { codigoUnico: true, numero: true } }),
    ]);
    const filas = this.revisarFilas(datos, kits, mochilas);
    const aGuardar = filas.filter((f) => f.estado === 'NUEVA' || f.estado === 'CAMBIA');
    const errores = filas.filter((f) => f.estado === 'ERROR').length;

    if (aplicar && aGuardar.length > 0) {
      try {
        await this.prisma.$transaction(
          aGuardar.map((f) =>
            this.prisma.mochilaKit.upsert({
              where: { codigoUnico: f.codigoUnico! },
              create: { codigoUnico: f.codigoUnico!, numero: f.numero!, actualizadoPorId: usuarioId ?? null },
              update: { numero: f.numero!, actualizadoPorId: usuarioId ?? null },
            }),
          ),
        );
      } catch (e) {
        if (esUnicoRepetido(e)) {
          throw new ConflictException('Alguien cambió mochilas mientras tanto. Vuelva a revisar el archivo.');
        }
        throw e;
      }
    }
    return { aplicada: aplicar && aGuardar.length > 0, filas, guardadas: aGuardar.length, errores };
  }

  /** Valida cada fila contra los kits del evento, las mochilas ya cargadas y el resto del archivo. */
  private revisarFilas(
    datos: Record<string, string>[],
    kits: KitDelEvento[],
    mochilas: { codigoUnico: string; numero: number }[],
  ): FilaCargaMochila[] {
    const kitPorCodigo = new Map<string, KitDelEvento>(kits.map((k) => [k.codigoUnico.toUpperCase(), k]));
    const kitsPorRecinto = new Map<string, KitDelEvento[]>();
    for (const k of kits) {
      if (!k.recinto) continue;
      const clave = claveRecinto(k.recinto.codigoRecinto);
      kitsPorRecinto.set(clave, [...(kitsPorRecinto.get(clave) ?? []), k]);
    }
    const numeroDeCodigo = new Map<string, number>(mochilas.map((m) => [m.codigoUnico, m.numero]));
    const codigoDeNumero = new Map<number, string>(mochilas.map((m) => [m.numero, m.codigoUnico]));
    const filaDelNumero = new Map<number, number>();
    const filaDelCodigo = new Map<string, number>();

    return datos.map((d, i): FilaCargaMochila => {
      const fila = i + 2;
      const recintoEscrito = columna(d, COLUMNAS.recinto);
      const codigoEscrito = columna(d, COLUMNAS.codigo).toUpperCase();
      const numeroEscrito = columna(d, COLUMNAS.numero);
      const error = (mensaje: string, kit?: KitDelEvento | null, numero: number | null = null): FilaCargaMochila => ({
        fila,
        codigoRecinto: kit?.recinto?.codigoRecinto ?? (recintoEscrito || null),
        nombreRecinto: kit?.recinto?.nombre ?? null,
        codigoUnico: kit?.codigoUnico || codigoEscrito || null,
        numero,
        estado: 'ERROR',
        mensaje,
      });

      const numero = leerNumeroMochila(numeroEscrito);
      if (numero === null) {
        return error(numeroEscrito ? `"${numeroEscrito}" no es un N.º de mochila (de 1 a 9999)` : 'Falta el N.º de mochila');
      }

      let kit: KitDelEvento | null = null;
      if (codigoEscrito) {
        kit = kitPorCodigo.get(codigoEscrito) ?? null;
        if (!kit) return error(`El código QR ${codigoEscrito} no es de un kit de este evento`, null, numero);
        if (recintoEscrito && claveRecinto(kit.recinto?.codigoRecinto ?? '') !== claveRecinto(recintoEscrito)) {
          return error(`El QR ${codigoEscrito} es del recinto ${kit.recinto?.codigoRecinto ?? 'sin recinto'}, no del ${recintoEscrito}`, kit, numero);
        }
      } else if (recintoEscrito) {
        const delRecinto = kitsPorRecinto.get(claveRecinto(recintoEscrito)) ?? [];
        if (delRecinto.length === 0) return error(`El recinto ${recintoEscrito} no tiene kit en este evento`, null, numero);
        if (delRecinto.length > 1) {
          return error(
            `El recinto ${recintoEscrito} tiene ${delRecinto.length} kits (${delRecinto.map((k) => k.codigoUnico).join(', ')}): escriba el Código QR`,
            { codigoUnico: '', recinto: delRecinto[0].recinto },
            numero,
          );
        }
        kit = delRecinto[0];
      } else {
        return error('Falta el Recinto o el Código QR', null, numero);
      }

      const repetidoNumero = filaDelNumero.get(numero);
      if (repetidoNumero) return error(`El N.º ${numero} ya está en la fila ${repetidoNumero} del archivo`, kit, numero);
      const repetidoCodigo = filaDelCodigo.get(kit.codigoUnico);
      if (repetidoCodigo) return error(`Este kit ya está en la fila ${repetidoCodigo} del archivo`, kit, numero);
      filaDelNumero.set(numero, fila);
      filaDelCodigo.set(kit.codigoUnico, fila);

      const duenio = codigoDeNumero.get(numero);
      if (duenio && duenio !== kit.codigoUnico) {
        return error(`La mochila N.º ${numero} ya está ligada al QR ${duenio}: cámbiela primero en la tabla de kits`, kit, numero);
      }
      const anterior = numeroDeCodigo.get(kit.codigoUnico);
      const base = {
        fila,
        codigoRecinto: kit.recinto?.codigoRecinto ?? null,
        nombreRecinto: kit.recinto?.nombre ?? null,
        codigoUnico: kit.codigoUnico,
        numero,
      };
      if (anterior === numero) return { ...base, estado: 'IGUAL', mensaje: 'Ya tenía ese número' };
      if (anterior !== undefined) return { ...base, estado: 'CAMBIA', mensaje: `Antes era el N.º ${anterior}` };
      return { ...base, estado: 'NUEVA', mensaje: null };
    });
  }

  /** Plantilla para la carga: Recinto o Código QR, y el N.º de mochila. */
  async plantilla(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Mochilas');
    ws.columns = [
      { header: 'Recinto', key: 'recinto', width: 12 },
      { header: 'Código QR', key: 'codigo', width: 14 },
      { header: 'N.º mochila', key: 'numero', width: 12 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.addRow({ recinto: '1440', codigo: '', numero: 54 });
    ws.addRow({ recinto: '', codigo: 'P2ZCERV4', numero: 23 });
    const ayuda = wb.addWorksheet('Cómo llenarla');
    ayuda.getColumn(1).width = 100;
    for (const linea of [
      'Una fila por mochila. Escriba el código del Recinto o el Código QR (8 letras impresas bajo el QR), y el N.º de mochila.',
      'Si el recinto tiene dos kits, use el Código QR: con el recinto solo no se sabe cuál de las dos mochilas es.',
      'El número es de la mochila física: se carga una vez y sirve en todos los eventos.',
      'Borre las filas de ejemplo antes de subirla.',
    ]) {
      ayuda.addRow([linea]);
    }
    return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  }

  /** Reporte del evento: cada kit con su N.º de mochila; los que no tienen número van primero. */
  async reporte(eventoId: string): Promise<Buffer> {
    if (!eventoId) throw new BadRequestException('Falta el evento');
    const evento = await this.prisma.eventoElectoral.findUnique({ where: { id: eventoId }, select: { nombre: true } });
    if (!evento) throw new NotFoundException('Evento no encontrado');

    const kits = await this.prisma.kitElectoral.findMany({
      where: { eventoId, esPrueba: false },
      select: {
        id: true,
        codigoUnico: true,
        estado: true,
        recinto: { select: { codigoRecinto: true, nombre: true, canton: { select: { nombre: true } } } },
        operador: { select: { nombres: true, apellidos: true } },
      },
    });
    const [numeros, parejas] = await Promise.all([
      this.numerosPorCodigo(kits.map((k) => k.codigoUnico)),
      this.prisma.parejaCda.findMany({
        where: { kitId: { in: kits.map((k) => k.id) } },
        orderBy: { fecha: 'desc' },
        select: { kitId: true, operador: { select: { apellidosNombres: true } }, asistente: { select: { apellidosNombres: true } } },
      }),
    ]);
    // La pareja más reciente de cada kit.
    const parejaPorKit = new Map<string, (typeof parejas)[number]>();
    for (const p of parejas) if (p.kitId && !parejaPorKit.has(p.kitId)) parejaPorKit.set(p.kitId, p);

    const filas = kits
      .map((k) => {
        const pareja = parejaPorKit.get(k.id);
        return {
          numero: numeros.get(k.codigoUnico) ?? null,
          codigo: k.codigoUnico,
          codigoRecinto: k.recinto?.codigoRecinto ?? '',
          recinto: k.recinto?.nombre ?? 'Sin recinto',
          canton: k.recinto?.canton?.nombre ?? '',
          operador: pareja?.operador?.apellidosNombres ?? (k.operador ? `${k.operador.apellidos} ${k.operador.nombres}`.trim() : ''),
          asistente: pareja?.asistente?.apellidosNombres ?? '',
          estado: k.estado,
        };
      })
      .sort(
        (a, b) =>
          (a.numero === null ? 0 : 1) - (b.numero === null ? 0 : 1) ||
          (a.numero ?? 0) - (b.numero ?? 0) ||
          a.codigoRecinto.localeCompare(b.codigoRecinto, 'es', { numeric: true }),
      );

    // Siempre .xlsx: ExcelJS guarda los nombres como texto (un nombre que empiece
    // con "=" no se vuelve fórmula). Si algún día pasa a CSV, hay que escaparlos.
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Mochilas');
    ws.columns = [
      { header: 'N.º mochila', key: 'numero', width: 12 },
      { header: 'Código QR', key: 'codigo', width: 13 },
      { header: 'Cód. recinto', key: 'codigoRecinto', width: 12 },
      { header: 'Recinto', key: 'recinto', width: 45 },
      { header: 'Cantón', key: 'canton', width: 16 },
      { header: 'Operador', key: 'operador', width: 32 },
      { header: 'Asistente', key: 'asistente', width: 32 },
      { header: 'Estado del kit', key: 'estado', width: 14 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const f of filas) ws.addRow({ ...f, numero: f.numero ?? 'SIN NÚMERO' });
    ws.autoFilter = { from: 'A1', to: 'H1' };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const sinNumero = filas.filter((f) => f.numero === null).length;
    const resumen = wb.addWorksheet('Resumen');
    resumen.getColumn(1).width = 28;
    resumen.addRows([
      ['Evento', evento.nombre],
      ['Kits', filas.length],
      ['Con N.º de mochila', filas.length - sinNumero],
      ['Sin N.º de mochila', sinNumero],
    ]);
    return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  }

  /** " (recinto 1440 · UE Atahualpa)" del kit más reciente con ese código, o "". */
  private async textoRecinto(codigoUnico: string): Promise<string> {
    const kit = await this.prisma.kitElectoral.findFirst({
      where: { codigoUnico },
      orderBy: { creadoEn: 'desc' },
      select: { recinto: { select: { codigoRecinto: true, nombre: true } } },
    });
    return kit?.recinto ? ` (recinto ${kit.recinto.codigoRecinto} · ${kit.recinto.nombre})` : '';
  }
}
