import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CdaEstadoDto,
  EstadoOperadorCda,
  IngestaPosicionesRequest,
  IngestaPosicionesResponse,
  KitVerificadoRetorno,
  KitsVerificadosRetornoResponse,
  LlegadaDpiRequest,
  LlegadaDpiResponse,
  LlegadaNoCdaRequest,
  LlegadaNoCdaResponse,
  LlegadaRecintoRequest,
  LlegadaRecintoResponse,
  MiAsignacionResponse,
  OperadorEnRetorno,
  OperadorEnRetornoKit,
  RecepcionKitRequest,
  RecepcionKitResponse,
  ReporteFlujoItem,
  ReporteNoCdaItem,
  RoleName,
  SalidaDpiRequest,
  SalidaDpiResponse,
  SalidaRecintoRequest,
  SalidaRecintoResponse,
  ValidarKitResponse,
  ValidarKitRetornoResponse,
  VerificarKitRetornoRequest,
  VerificarKitRetornoResponse,
} from '@cne/shared-types';
import {
  ingestaPosicionesSchema,
  llegadaDpiSchema,
  llegadaNoCdaSchema,
  llegadaRecintoSchema,
  recepcionKitSchema,
  salidaDpiSchema,
  salidaRecintoSchema,
  verificarKitRetornoSchema,
} from '@cne/shared-validation';

import { PrismaService } from '../db/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';

// HU3: margen para registrar la llegada al recinto. Es configurable por evento
// (ConfigAlerta.margenLlegadaMetros, vía "Configurar alertas" en Eventos) para
// poder hacer demos sin estar en el recinto real, sin tocar este código.
// El mobile usa el mismo valor (recibido en miAsignacion) para gatear el botón
// en UX, pero la validación que de verdad importa es la del servidor, en
// registrarLlegadaRecinto.
const MARGEN_LLEGADA_METROS_DEFAULT = 150;
const MAX_HOLGURA_GPS_METROS = 100;

@Injectable()
export class TrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  /**
   * HU2-CA1 / HU3-CA1: detalle del recinto, militar referencial y kits del
   * operador, con el estado de salida/llegada y qué kits han sido recibidos.
   */
  async miAsignacion(operadorId: string): Promise<MiAsignacionResponse> {
    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
    });
    if (!evento) {
      throw new NotFoundException('No hay un evento electoral activo');
    }

    const kits = await this.prisma.kitElectoral.findMany({
      where: { eventoId: evento.id, operadorId },
      orderBy: { codigoUnico: 'asc' },
    });
    if (kits.length === 0) {
      throw new NotFoundException(
        'No tienes kits asignados para el evento activo. Contacta a tu supervisor.',
      );
    }

    const recintoIds = Array.from(new Set(kits.map((k) => k.recintoId).filter(Boolean) as string[]));
    if (recintoIds.length === 0) {
      throw new NotFoundException('Tus kits no tienen recinto asignado todavía');
    }
    if (recintoIds.length > 1) {
      throw new ConflictException(
        'Tus kits están asignados a varios recintos. Contacta al administrador.',
      );
    }
    const recintoId = recintoIds[0];

    const recinto = await this.prisma.recinto.findUnique({
      where: { id: recintoId },
      include: { canton: true },
    });
    if (!recinto) throw new NotFoundException('Recinto no encontrado');

    const coordsRecinto = await this.prisma.$queryRaw<{ lat: number; lng: number }[]>`
      SELECT ST_Y(ubicacion::geometry) AS lat, ST_X(ubicacion::geometry) AS lng
      FROM recintos WHERE id = ${recinto.id}::uuid AND ubicacion IS NOT NULL;
    `;
    const latitudRecinto = coordsRecinto[0]?.lat ?? null;
    const longitudRecinto = coordsRecinto[0]?.lng ?? null;

    const configAlerta = await this.prisma.configAlerta.findUnique({
      where: { eventoId: evento.id },
      select: { margenLlegadaMetros: true },
    });
    const margenLlegadaMetros = configAlerta?.margenLlegadaMetros ?? MARGEN_LLEGADA_METROS_DEFAULT;

    const noCdas = await this.prisma.recinto.findMany({
      where: { cdaDestinoId: recinto.id },
      include: { canton: true },
      orderBy: { nombre: 'asc' },
    });

    const militar = await this.prisma.militar.findFirst({
      where: { recintoId },
      orderBy: { creadoEn: 'asc' },
    });

    const [
      salidaPrevia,
      llegadaPrevia,
      salidaRecintoPrevia,
      llegadaDpiPrevia,
      recepciones,
      llegadasNoCda,
    ] = await this.prisma.$transaction([
      this.prisma.eventoTracking.findFirst({
        where: { eventoId: evento.id, operadorId, tipo: 'SALIDA_DPI' },
        select: { id: true },
      }),
      this.prisma.eventoTracking.findFirst({
        where: { eventoId: evento.id, operadorId, tipo: 'LLEGADA_RECINTO' },
        select: { id: true },
      }),
      this.prisma.eventoTracking.findFirst({
        where: { eventoId: evento.id, operadorId, tipo: 'SALIDA_RECINTO' },
        select: { id: true },
      }),
      this.prisma.eventoTracking.findFirst({
        where: { eventoId: evento.id, operadorId, tipo: 'LLEGADA_DPI' },
        select: { id: true },
      }),
      this.prisma.recepcionKit.findMany({
        where: { operadorId, kitId: { in: kits.map((k) => k.id) } },
        select: { kitId: true, fotoMilitarUrl: true },
      }),
      this.prisma.eventoTracking.findMany({
        where: {
          eventoId: evento.id,
          operadorId,
          tipo: 'LLEGADA_NO_CDA',
          recintoId: { in: noCdas.map((nc) => nc.id) },
        },
        select: { recintoId: true, ocurridoEn: true },
      }),
    ]);

    const recibidosSet = new Set(recepciones.map((r) => r.kitId));
    const fotoMilitarUrl = recepciones.find((r) => r.fotoMilitarUrl)?.fotoMilitarUrl ?? null;
    const llegadaNoCdaPorRecinto = new Map(
      llegadasNoCda.map((l) => [l.recintoId, l.ocurridoEn.toISOString()]),
    );

    return {
      eventoId: evento.id,
      eventoNombre: evento.nombre,
      recinto: {
        id: recinto.id,
        codigoRecinto: recinto.codigoRecinto,
        nombre: recinto.nombre,
        direccion: recinto.direccion ?? null,
        cantonNombre: recinto.canton?.nombre ?? null,
        parroquia: recinto.parroquia ?? null,
        juntasFemeninas: recinto.juntasFemeninas ?? null,
        juntasMasculinas: recinto.juntasMasculinas ?? null,
        llegadaRegistradaEn: null,
        latitud: latitudRecinto,
        longitud: longitudRecinto,
      },
      noCdas: noCdas.map((nc) => ({
        id: nc.id,
        codigoRecinto: nc.codigoRecinto,
        nombre: nc.nombre,
        direccion: nc.direccion ?? null,
        cantonNombre: nc.canton?.nombre ?? null,
        parroquia: nc.parroquia ?? null,
        juntasFemeninas: nc.juntasFemeninas ?? null,
        juntasMasculinas: nc.juntasMasculinas ?? null,
        llegadaRegistradaEn: llegadaNoCdaPorRecinto.get(nc.id) ?? null,
        latitud: null,
        longitud: null,
      })),
      militar: militar
        ? {
            id: militar.id,
            nombres: militar.nombres,
            apellidos: militar.apellidos,
            cedula: militar.cedula,
          }
        : null,
      kits: kits.map((k) => ({
        id: k.id,
        codigoUnico: k.codigoUnico,
        nombre: k.nombre,
        contenidos: k.contenidos ?? null,
        recibido: recibidosSet.has(k.id),
      })),
      yaRegistroSalida: !!salidaPrevia,
      yaRegistroLlegada: !!llegadaPrevia,
      yaRegistroSalidaRecinto: !!salidaRecintoPrevia,
      yaRegistroLlegadaDpi: !!llegadaDpiPrevia,
      fotoMilitarUrl,
      margenLlegadaMetros,
    };
  }

  /**
   * HU2-CA2/CA3: registra un EventoTracking SALIDA_DPI con ubicación GPS puntual,
   * encola notificaciones para supervisor y administradores. Rechaza segundo POST.
   */
  async registrarSalidaDpi(
    operadorId: string,
    input: SalidaDpiRequest,
  ): Promise<SalidaDpiResponse> {
    const parsed = salidaDpiSchema.parse(input);

    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
    });
    if (!evento) {
      throw new NotFoundException('No hay un evento electoral activo');
    }

    const existente = await this.prisma.eventoTracking.findFirst({
      where: { eventoId: evento.id, operadorId, tipo: 'SALIDA_DPI' },
      select: { id: true, ocurridoEn: true },
    });
    if (existente) {
      throw new ConflictException('Ya registraste tu salida del DPI');
    }

    const kit = await this.prisma.kitElectoral.findFirst({
      where: { eventoId: evento.id, operadorId },
      select: { recintoId: true },
    });
    const recintoId = kit?.recintoId ?? null;

    const ocurridoEn = new Date(parsed.ocurridoEn);

    const id: string = (await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO eventos_tracking (id, evento_id, operador_id, tipo, recinto_id, ubicacion, ocurrido_en, desde_offline, registrado_en)
      VALUES (
        uuid_generate_v4(),
        ${evento.id}::uuid,
        ${operadorId}::uuid,
        'SALIDA_DPI'::tipo_tracking,
        ${recintoId}::uuid,
        ST_SetSRID(ST_MakePoint(${parsed.longitud}, ${parsed.latitud}), 4326)::geography,
        ${ocurridoEn}::timestamptz,
        false,
        now()
      )
      RETURNING id;
    `)[0].id;

    const operador = await this.prisma.usuario.findUnique({
      where: { id: operadorId },
      select: { nombres: true, apellidos: true },
    });
    const recintoNombre = recintoId
      ? (await this.prisma.recinto.findUnique({ where: { id: recintoId }, select: { nombre: true } }))?.nombre ?? null
      : null;

    await this.notifications.encolarSalidaDpi({
      operadorId,
      eventoId: evento.id,
      payload: {
        operadorId,
        operadorNombre: operador ? `${operador.nombres} ${operador.apellidos}` : null,
        recintoNombre,
        ocurridoEn: ocurridoEn.toISOString(),
      },
    });

    return { id, ocurridoEn: ocurridoEn.toISOString() };
  }

  /**
   * HU3-CA2: almacena la foto del militar cifrada y devuelve el identificador
   * para usar en el subsiguiente POST /tracking/recepcion-kit.
   */
  async guardarFotoMilitar(file: Express.Multer.File): Promise<{ fotoUrl: string }> {
    if (!file) {
      throw new BadRequestException('Archivo de foto requerido');
    }
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('El archivo debe ser una imagen');
    }
    const fotoUrl = await this.storage.saveEncrypted({
      categoria: 'militares',
      buffer: file.buffer,
    });
    return { fotoUrl };
  }

  /**
   * HU3-CA5: valida que el código (escaneado o ingresado manualmente)
   * corresponda a un kit asignado al operador autenticado en el evento activo.
   */
  async validarKit(operadorId: string, codigo: string): Promise<ValidarKitResponse> {
    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
      select: { id: true },
    });
    if (!evento) throw new NotFoundException('No hay un evento electoral activo');

    const kit = await this.prisma.kitElectoral.findUnique({
      where: { eventoId_codigoUnico: { eventoId: evento.id, codigoUnico: codigo.trim() } },
    });
    if (!kit) {
      throw new NotFoundException('Kit no encontrado en el evento activo');
    }
    if (kit.operadorId !== operadorId) {
      // HU3-CA5: bloquear si no le pertenece
      throw new BadRequestException('Este kit no te pertenece');
    }

    const yaRecibido = !!(await this.prisma.recepcionKit.findFirst({
      where: { kitId: kit.id, operadorId },
      select: { id: true },
    }));

    return {
      id: kit.id,
      codigoUnico: kit.codigoUnico,
      nombre: kit.nombre,
      contenidos: kit.contenidos ?? null,
      yaRecibido,
    };
  }

  /**
   * HU3-CA6: confirma la recepción de un kit específico tras escaneo o ingreso
   * manual. Inserta RecepcionKit con foto militar y ubicación; marca el kit
   * como ENTREGADO. Idempotente: si ya fue recibido, retorna el registro.
   */
  async confirmarRecepcionKit(
    operadorId: string,
    input: RecepcionKitRequest,
  ): Promise<RecepcionKitResponse> {
    const parsed = recepcionKitSchema.parse(input);

    const kit = await this.prisma.kitElectoral.findUnique({ where: { id: parsed.kitId } });
    if (!kit) throw new NotFoundException('Kit no encontrado');
    if (kit.operadorId !== operadorId) {
      throw new BadRequestException('Este kit no te pertenece');
    }

    const fotoExiste = await this.storage.exists(parsed.fotoMilitarUrl);
    if (!fotoExiste) {
      throw new BadRequestException('Foto del militar no encontrada. Vuelve a tomarla.');
    }

    const existente = await this.prisma.recepcionKit.findFirst({
      where: { kitId: kit.id, operadorId },
      select: { id: true, confirmadoEn: true },
    });
    if (existente) {
      return {
        id: existente.id,
        kitId: kit.id,
        confirmadoEn: existente.confirmadoEn.toISOString(),
      };
    }

    const inserted = await this.prisma.$queryRaw<{ id: string; confirmado_en: Date }[]>`
      INSERT INTO recepciones_kit (id, kit_id, operador_id, militar_id, foto_militar_url, ubicacion, confirmado_en, desde_offline)
      VALUES (
        uuid_generate_v4(),
        ${kit.id}::uuid,
        ${operadorId}::uuid,
        ${parsed.militarId ?? null}::uuid,
        ${parsed.fotoMilitarUrl},
        ST_SetSRID(ST_MakePoint(${parsed.longitud}, ${parsed.latitud}), 4326)::geography,
        now(),
        false
      )
      RETURNING id, confirmado_en;
    `;
    const row = inserted[0];

    await this.prisma.kitElectoral.update({
      where: { id: kit.id },
      data: { estado: 'ENTREGADO' },
    });

    return {
      id: row.id,
      kitId: kit.id,
      confirmadoEn: row.confirmado_en.toISOString(),
    };
  }

  /**
   * Verificación de kits al retorno al DPI (rol TECNICO_SUPERVISOR): busca el
   * kit por código y devuelve su checklist de contenidos (parseado desde
   * `contenidos`) para que el supervisor confirme qué viene completo.
   */
  async validarKitRetorno(
    supervisorId: string,
    roles: RoleName[],
    codigo: string,
  ): Promise<ValidarKitRetornoResponse> {
    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
      select: { id: true },
    });
    if (!evento) throw new NotFoundException('No hay un evento electoral activo');

    const kit = await this.prisma.kitElectoral.findUnique({
      where: { eventoId_codigoUnico: { eventoId: evento.id, codigoUnico: codigo.trim() } },
    });
    if (!kit) throw new NotFoundException('Kit no encontrado en el evento activo');
    if (!kit.operadorId) {
      throw new BadRequestException('Este kit no está asignado a ningún operador');
    }
    await this.verificarPertenenciaOperador(evento.id, supervisorId, roles, kit.operadorId);

    if (kit.estado !== 'EN_RETORNO' && kit.estado !== 'RETORNADO') {
      throw new BadRequestException('Este kit todavía no salió del recinto');
    }

    const operador = await this.prisma.usuario.findUnique({
      where: { id: kit.operadorId },
      select: { nombres: true, apellidos: true },
    });

    const yaVerificado = !!(await this.prisma.recepcionDpiKit.findFirst({
      where: { kitId: kit.id },
      select: { id: true },
    }));

    return {
      id: kit.id,
      codigoUnico: kit.codigoUnico,
      nombre: kit.nombre,
      operadorNombre: operador ? `${operador.nombres} ${operador.apellidos}` : 'Operador',
      items: parseContenidos(kit.contenidos).map((texto) => ({ texto, marcado: true })),
      yaVerificado,
    };
  }

  /**
   * Inserta el registro independiente de verificación de retorno al DPI.
   * No altera EstadoKit ni el flujo de salida/llegada ya existente.
   * Idempotente: si el kit ya fue verificado, retorna el registro existente.
   */
  async confirmarVerificacionKitRetorno(
    supervisorId: string,
    roles: RoleName[],
    input: VerificarKitRetornoRequest,
  ): Promise<VerificarKitRetornoResponse> {
    const parsed = verificarKitRetornoSchema.parse(input);

    const kit = await this.prisma.kitElectoral.findUnique({ where: { id: parsed.kitId } });
    if (!kit) throw new NotFoundException('Kit no encontrado');
    if (!kit.operadorId) {
      throw new BadRequestException('Este kit no está asignado a ningún operador');
    }
    await this.verificarPertenenciaOperador(kit.eventoId, supervisorId, roles, kit.operadorId);

    const existente = await this.prisma.recepcionDpiKit.findFirst({
      where: { kitId: kit.id },
      select: { id: true, confirmadoEn: true },
    });
    if (existente) {
      return { id: existente.id, kitId: kit.id, confirmadoEn: existente.confirmadoEn.toISOString() };
    }

    const creado = await this.prisma.recepcionDpiKit.create({
      data: {
        kitId: kit.id,
        supervisorId,
        items: parsed.items,
        observaciones: parsed.observaciones ?? null,
      },
    });

    return { id: creado.id, kitId: kit.id, confirmadoEn: creado.confirmadoEn.toISOString() };
  }

  /**
   * Verificación retorno DPI: lista de kits ya verificados (con fila en
   * `recepciones_dpi_kit`), filtrada a los operadores del supervisor igual que
   * `operadoresEnRetorno`. El total acompaña la lista para mostrarlo en el móvil.
   */
  async kitsVerificadosRetorno(
    viewerId: string,
    roles: RoleName[],
  ): Promise<KitsVerificadosRetornoResponse> {
    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
      select: { id: true },
    });
    if (!evento) return { total: 0, items: [] };

    const esAdmin = roles.includes('ADMINISTRADOR');
    let operadorIds: string[] | undefined;
    if (!esAdmin) {
      const asignados = await this.prisma.asignacionSupervisor.findMany({
        where: { eventoId: evento.id, supervisorId: viewerId },
        select: { operadorId: true },
      });
      operadorIds = asignados.map((a) => a.operadorId);
      if (operadorIds.length === 0) return { total: 0, items: [] };
    }

    const kits = await this.prisma.kitElectoral.findMany({
      where: { eventoId: evento.id, ...(operadorIds ? { operadorId: { in: operadorIds } } : {}) },
      select: { id: true, codigoUnico: true, nombre: true, operadorId: true },
    });
    if (kits.length === 0) return { total: 0, items: [] };

    const recepciones = await this.prisma.recepcionDpiKit.findMany({
      where: { kitId: { in: kits.map((k) => k.id) } },
      orderBy: { confirmadoEn: 'desc' },
    });
    if (recepciones.length === 0) return { total: 0, items: [] };

    const kitPorId = new Map(kits.map((k) => [k.id, k]));
    const operadoresIds = Array.from(
      new Set(
        recepciones
          .map((r) => kitPorId.get(r.kitId)?.operadorId)
          .filter((id): id is string => !!id),
      ),
    );
    const operadores = await this.prisma.usuario.findMany({
      where: { id: { in: operadoresIds } },
      select: { id: true, nombres: true, apellidos: true },
    });
    const nombrePorId = new Map(operadores.map((o) => [o.id, `${o.nombres} ${o.apellidos}`]));

    const items: KitVerificadoRetorno[] = recepciones.map((r) => {
      const kit = kitPorId.get(r.kitId);
      return {
        kitId: r.kitId,
        codigoUnico: kit?.codigoUnico ?? '',
        nombre: kit?.nombre ?? '',
        operadorId: kit?.operadorId ?? '',
        operadorNombre: kit?.operadorId ? nombrePorId.get(kit.operadorId) ?? 'Operador' : 'Operador',
        confirmadoEn: r.confirmadoEn.toISOString(),
      };
    });

    return { total: items.length, items };
  }

  /** Lanza 400 si el operador no está asignado a este supervisor (admins pasan siempre). */
  private async verificarPertenenciaOperador(
    eventoId: string,
    supervisorId: string,
    roles: RoleName[],
    operadorId: string,
  ): Promise<void> {
    if (roles.includes('ADMINISTRADOR')) return;
    const asignado = await this.prisma.asignacionSupervisor.findFirst({
      where: { eventoId, supervisorId, operadorId },
      select: { id: true },
    });
    if (!asignado) {
      throw new BadRequestException('Este kit no pertenece a uno de tus operadores');
    }
  }

  /**
   * HU3-CA7: registra EventoTracking LLEGADA_RECINTO con GPS, valida que se
   * hayan recibido todos los kits y notifica a supervisor y administradores.
   * Rechaza segundo POST con 409.
   */
  async registrarLlegadaRecinto(
    operadorId: string,
    input: LlegadaRecintoRequest,
  ): Promise<LlegadaRecintoResponse> {
    const parsed = llegadaRecintoSchema.parse(input);

    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
    });
    if (!evento) throw new NotFoundException('No hay un evento electoral activo');

    const existente = await this.prisma.eventoTracking.findFirst({
      where: { eventoId: evento.id, operadorId, tipo: 'LLEGADA_RECINTO' },
      select: { id: true },
    });
    if (existente) throw new ConflictException('Ya registraste tu llegada al recinto');

    const salidaPrevia = await this.prisma.eventoTracking.findFirst({
      where: { eventoId: evento.id, operadorId, tipo: 'SALIDA_DPI' },
      select: { id: true },
    });
    if (!salidaPrevia) {
      throw new BadRequestException('Debes registrar la salida del DPI antes de la llegada al recinto');
    }

    const kits = await this.prisma.kitElectoral.findMany({
      where: { eventoId: evento.id, operadorId },
      select: { id: true, recintoId: true },
    });
    const recepciones = await this.prisma.recepcionKit.findMany({
      where: { operadorId, kitId: { in: kits.map((k) => k.id) } },
      select: { kitId: true },
    });
    const recibidos = new Set(recepciones.map((r) => r.kitId));
    const pendientes = kits.filter((k) => !recibidos.has(k.id));
    if (pendientes.length > 0) {
      throw new BadRequestException(
        `Faltan ${pendientes.length} kit(s) por confirmar antes de registrar la llegada`,
      );
    }

    const recintoId = kits[0]?.recintoId ?? null;
    const ocurridoEn = new Date(parsed.ocurridoEn);

    // HU3: el operador debe estar físicamente en el recinto para registrar la
    // llegada. Margen = margen del evento (configurable, default 150m) +
    // holgura por la imprecisión que reporta el GPS del propio celular (con
    // tope, para que un valor basura no anule el control). PostGIS::geography
    // devuelve metros directos.
    if (recintoId) {
      const filas = await this.prisma.$queryRaw<{ metros: number | null }[]>`
        SELECT ST_Distance(
          r.ubicacion,
          ST_SetSRID(ST_MakePoint(${parsed.longitud}, ${parsed.latitud}), 4326)::geography
        ) AS metros
        FROM recintos r
        WHERE r.id = ${recintoId}::uuid AND r.ubicacion IS NOT NULL;
      `;
      const metros = filas[0]?.metros;
      if (metros != null) {
        const config = await this.prisma.configAlerta.findUnique({
          where: { eventoId: evento.id },
          select: { margenLlegadaMetros: true },
        });
        const holgura = Math.min(parsed.precisionMetros ?? 0, MAX_HOLGURA_GPS_METROS);
        const margen = (config?.margenLlegadaMetros ?? MARGEN_LLEGADA_METROS_DEFAULT) + holgura;
        if (metros > margen) {
          throw new BadRequestException(
            `Estás a ${Math.round(metros)} m del recinto. Acércate (máx. ${Math.round(margen)} m) para registrar la llegada.`,
          );
        }
      }
    }

    const id: string = (await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO eventos_tracking (id, evento_id, operador_id, tipo, recinto_id, ubicacion, ocurrido_en, desde_offline, registrado_en)
      VALUES (
        uuid_generate_v4(),
        ${evento.id}::uuid,
        ${operadorId}::uuid,
        'LLEGADA_RECINTO'::tipo_tracking,
        ${recintoId}::uuid,
        ST_SetSRID(ST_MakePoint(${parsed.longitud}, ${parsed.latitud}), 4326)::geography,
        ${ocurridoEn}::timestamptz,
        false,
        now()
      )
      RETURNING id;
    `)[0].id;

    if (recintoId) {
      await this.prisma.kitElectoral.updateMany({
        where: { eventoId: evento.id, operadorId, estado: 'ENTREGADO' },
        data: { estado: 'EN_RECINTO' },
      });
    }

    const operador = await this.prisma.usuario.findUnique({
      where: { id: operadorId },
      select: { nombres: true, apellidos: true },
    });
    const recintoNombre = recintoId
      ? (await this.prisma.recinto.findUnique({ where: { id: recintoId }, select: { nombre: true } }))?.nombre ?? null
      : null;

    await this.notifications.encolarLlegadaRecinto({
      operadorId,
      eventoId: evento.id,
      payload: {
        operadorId,
        operadorNombre: operador ? `${operador.nombres} ${operador.apellidos}` : null,
        recintoNombre,
        kitsRecibidos: kits.length,
        ocurridoEn: ocurridoEn.toISOString(),
      },
    });

    return { id, ocurridoEn: ocurridoEn.toISOString() };
  }

  /**
   * Checklist del operador: registra que ya visitó un NO-CDA a su cargo
   * (un EventoTracking LLEGADA_NO_CDA por NO-CDA, sin GPS). Rechaza
   * NO-CDAs que no dependan del CDA del operador y segundos registros
   * del mismo NO-CDA con 409.
   */
  async registrarLlegadaNoCda(
    operadorId: string,
    input: LlegadaNoCdaRequest,
  ): Promise<LlegadaNoCdaResponse> {
    const parsed = llegadaNoCdaSchema.parse(input);

    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
    });
    if (!evento) throw new NotFoundException('No hay un evento electoral activo');

    const kits = await this.prisma.kitElectoral.findMany({
      where: { eventoId: evento.id, operadorId },
      select: { recintoId: true },
    });
    const cdaId = kits[0]?.recintoId ?? null;
    if (!cdaId) throw new NotFoundException('No tienes un CDA asignado para el evento activo');

    const noCda = await this.prisma.recinto.findUnique({
      where: { id: parsed.recintoId },
      select: { id: true, cdaDestinoId: true },
    });
    if (!noCda || noCda.cdaDestinoId !== cdaId) {
      throw new NotFoundException('Ese NO-CDA no está a tu cargo');
    }

    const existente = await this.prisma.eventoTracking.findFirst({
      where: {
        eventoId: evento.id,
        operadorId,
        tipo: 'LLEGADA_NO_CDA',
        recintoId: parsed.recintoId,
      },
      select: { id: true },
    });
    if (existente) throw new ConflictException('Ya registraste la llegada a este NO-CDA');

    const ocurridoEn = new Date();

    const id: string = (await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO eventos_tracking (id, evento_id, operador_id, tipo, recinto_id, ubicacion, ocurrido_en, desde_offline, registrado_en)
      VALUES (
        uuid_generate_v4(),
        ${evento.id}::uuid,
        ${operadorId}::uuid,
        'LLEGADA_NO_CDA'::tipo_tracking,
        ${parsed.recintoId}::uuid,
        NULL,
        ${ocurridoEn}::timestamptz,
        false,
        now()
      )
      RETURNING id;
    `)[0].id;

    return { id, recintoId: parsed.recintoId, ocurridoEn: ocurridoEn.toISOString() };
  }

  /**
   * HU4-CA2/CA3: registra EventoTracking SALIDA_RECINTO con GPS, valida que la
   * llegada al recinto se haya registrado antes, marca los kits como EN_RETORNO
   * y notifica a supervisor y administradores. A partir de aquí el móvil arranca
   * el rastreo continuo. Rechaza segundo POST con 409.
   */
  async registrarSalidaRecinto(
    operadorId: string,
    input: SalidaRecintoRequest,
  ): Promise<SalidaRecintoResponse> {
    const parsed = salidaRecintoSchema.parse(input);

    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
    });
    if (!evento) throw new NotFoundException('No hay un evento electoral activo');

    const existente = await this.prisma.eventoTracking.findFirst({
      where: { eventoId: evento.id, operadorId, tipo: 'SALIDA_RECINTO' },
      select: { id: true },
    });
    if (existente) throw new ConflictException('Ya registraste tu salida del recinto');

    const llegadaPrevia = await this.prisma.eventoTracking.findFirst({
      where: { eventoId: evento.id, operadorId, tipo: 'LLEGADA_RECINTO' },
      select: { id: true },
    });
    if (!llegadaPrevia) {
      throw new BadRequestException(
        'Debes registrar la llegada al recinto antes de la salida del recinto',
      );
    }

    const kit = await this.prisma.kitElectoral.findFirst({
      where: { eventoId: evento.id, operadorId },
      select: { recintoId: true },
    });
    const recintoId = kit?.recintoId ?? null;
    const ocurridoEn = new Date(parsed.ocurridoEn);

    const id: string = (await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO eventos_tracking (id, evento_id, operador_id, tipo, recinto_id, ubicacion, ocurrido_en, desde_offline, registrado_en)
      VALUES (
        uuid_generate_v4(),
        ${evento.id}::uuid,
        ${operadorId}::uuid,
        'SALIDA_RECINTO'::tipo_tracking,
        ${recintoId}::uuid,
        ST_SetSRID(ST_MakePoint(${parsed.longitud}, ${parsed.latitud}), 4326)::geography,
        ${ocurridoEn}::timestamptz,
        false,
        now()
      )
      RETURNING id;
    `)[0].id;

    await this.prisma.kitElectoral.updateMany({
      where: { eventoId: evento.id, operadorId, estado: 'EN_RECINTO' },
      data: { estado: 'EN_RETORNO' },
    });

    const operador = await this.prisma.usuario.findUnique({
      where: { id: operadorId },
      select: { nombres: true, apellidos: true },
    });
    const recintoNombre = recintoId
      ? (await this.prisma.recinto.findUnique({ where: { id: recintoId }, select: { nombre: true } }))?.nombre ?? null
      : null;

    await this.notifications.encolarSalidaRecinto({
      operadorId,
      eventoId: evento.id,
      payload: {
        operadorId,
        operadorNombre: operador ? `${operador.nombres} ${operador.apellidos}` : null,
        recintoNombre,
        ocurridoEn: ocurridoEn.toISOString(),
      },
    });

    return { id, ocurridoEn: ocurridoEn.toISOString() };
  }

  /**
   * HU4-CA3: ingesta de un lote de posiciones GPS capturadas por el móvil durante
   * el tramo de retorno al DPI. Solo se aceptan puntos mientras el operador esté
   * en retorno (registró SALIDA_RECINTO y aún no LLEGADA_DPI).
   */
  async ingestarPosiciones(
    operadorId: string,
    input: IngestaPosicionesRequest,
  ): Promise<IngestaPosicionesResponse> {
    const parsed = ingestaPosicionesSchema.parse(input);

    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
      select: { id: true },
    });
    if (!evento) throw new NotFoundException('No hay un evento electoral activo');

    const [salidaRecinto, llegadaDpi] = await this.prisma.$transaction([
      this.prisma.eventoTracking.findFirst({
        where: { eventoId: evento.id, operadorId, tipo: 'SALIDA_RECINTO' },
        select: { id: true },
      }),
      this.prisma.eventoTracking.findFirst({
        where: { eventoId: evento.id, operadorId, tipo: 'LLEGADA_DPI' },
        select: { id: true },
      }),
    ]);
    if (!salidaRecinto) {
      throw new BadRequestException('Aún no has registrado la salida del recinto');
    }
    if (llegadaDpi) {
      throw new BadRequestException('Ya registraste tu llegada al DPI; el rastreo finalizó');
    }

    for (const p of parsed.posiciones) {
      await this.prisma.$executeRaw`
        INSERT INTO posiciones_gps (operador_id, evento_id, ubicacion, capturado_en, recibido_en)
        VALUES (
          ${operadorId}::uuid,
          ${evento.id}::uuid,
          ST_SetSRID(ST_MakePoint(${p.longitud}, ${p.latitud}), 4326)::geography,
          ${new Date(p.capturadoEn)}::timestamptz,
          now()
        );
      `;
    }

    return { recibidas: parsed.posiciones.length };
  }

  /**
   * HU4-CA4 / HU6: operadores actualmente en su tramo de retorno (registraron
   * SALIDA_RECINTO y aún no LLEGADA_DPI) con su última posición GPS conocida.
   * Los supervisores solo ven a sus operadores asignados; los administradores
   * los ven a todos.
   */
  async operadoresEnRetorno(
    viewerId: string,
    roles: RoleName[],
  ): Promise<OperadorEnRetorno[]> {
    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
      select: { id: true },
    });
    if (!evento) return [];

    const esAdmin = roles.includes('ADMINISTRADOR');

    // Operadores con SALIDA_RECINTO y sin LLEGADA_DPI en el evento activo.
    const [salidas, llegadas] = await this.prisma.$transaction([
      this.prisma.eventoTracking.findMany({
        where: { eventoId: evento.id, tipo: 'SALIDA_RECINTO' },
        select: { operadorId: true },
      }),
      this.prisma.eventoTracking.findMany({
        where: { eventoId: evento.id, tipo: 'LLEGADA_DPI' },
        select: { operadorId: true },
      }),
    ]);
    const retornados = new Set(llegadas.map((l) => l.operadorId));
    let operadorIds = Array.from(new Set(salidas.map((s) => s.operadorId))).filter(
      (id) => !retornados.has(id),
    );

    if (!esAdmin) {
      const asignados = await this.prisma.asignacionSupervisor.findMany({
        where: { eventoId: evento.id, supervisorId: viewerId },
        select: { operadorId: true },
      });
      const permitidos = new Set(asignados.map((a) => a.operadorId));
      operadorIds = operadorIds.filter((id) => permitidos.has(id));
    }

    if (operadorIds.length === 0) return [];

    const operadores = await this.prisma.usuario.findMany({
      where: { id: { in: operadorIds } },
      select: { id: true, nombres: true, apellidos: true },
    });
    const nombrePorId = new Map(
      operadores.map((o) => [o.id, `${o.nombres} ${o.apellidos}`]),
    );

    const kitsRows = await this.prisma.kitElectoral.findMany({
      where: { eventoId: evento.id, operadorId: { in: operadorIds } },
      select: { id: true, codigoUnico: true, nombre: true, operadorId: true },
      orderBy: { codigoUnico: 'asc' },
    });
    const kitsPorId = new Map<string, OperadorEnRetornoKit[]>();
    for (const k of kitsRows) {
      if (!k.operadorId) continue;
      const arr = kitsPorId.get(k.operadorId) ?? [];
      arr.push({ id: k.id, codigoUnico: k.codigoUnico, nombre: k.nombre });
      kitsPorId.set(k.operadorId, arr);
    }

    const resultado: OperadorEnRetorno[] = [];
    for (const id of operadorIds) {
      const ultima = await this.prisma.$queryRaw<
        { lat: number; lng: number; capturado_en: Date }[]
      >`
        SELECT ST_Y(ubicacion::geometry) AS lat,
               ST_X(ubicacion::geometry) AS lng,
               capturado_en
        FROM posiciones_gps
        WHERE operador_id = ${id}::uuid AND evento_id = ${evento.id}::uuid
        ORDER BY capturado_en DESC
        LIMIT 1;
      `;
      if (ultima.length === 0) continue; // sin posiciones todavía
      const pos = ultima[0];
      resultado.push({
        operadorId: id,
        operadorNombre: nombrePorId.get(id) ?? 'Operador',
        latitud: pos.lat,
        longitud: pos.lng,
        capturadoEn: pos.capturado_en.toISOString(),
        kits: kitsPorId.get(id) ?? [],
      });
    }

    return resultado;
  }

  /**
   * Estado en vivo de los CDAs del evento activo: para cada recinto tipo CDA
   * con operador asignado (vía kits), deriva su estado a partir del último
   * EventoTracking registrado y su última ubicación conocida (posiciones_gps
   * durante el retorno, o el punto del último EventoTracking en otros tramos).
   * Los supervisores solo ven sus operadores asignados; los administradores
   * ven todos.
   */
  async estadoCdas(viewerId: string, roles: RoleName[]): Promise<CdaEstadoDto[]> {
    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
      select: { id: true },
    });
    if (!evento) return [];

    const esAdmin = roles.includes('ADMINISTRADOR');

    const kits = await this.prisma.kitElectoral.findMany({
      where: { eventoId: evento.id, recintoId: { not: null }, operadorId: { not: null } },
      select: { recintoId: true, operadorId: true },
    });
    const operadorPorRecinto = new Map<string, string>();
    for (const k of kits) {
      if (k.recintoId && k.operadorId) operadorPorRecinto.set(k.recintoId, k.operadorId);
    }

    let recintoIds = Array.from(operadorPorRecinto.keys());

    if (!esAdmin) {
      const asignados = await this.prisma.asignacionSupervisor.findMany({
        where: { eventoId: evento.id, supervisorId: viewerId },
        select: { operadorId: true },
      });
      const permitidos = new Set(asignados.map((a) => a.operadorId));
      recintoIds = recintoIds.filter((rid) => permitidos.has(operadorPorRecinto.get(rid)!));
    }

    if (recintoIds.length === 0) return [];

    const recintos = await this.prisma.recinto.findMany({
      where: { id: { in: recintoIds }, tipo: 'CDA' },
      include: { canton: true },
      orderBy: { codigoRecinto: 'asc' },
    });
    if (recintos.length === 0) return [];

    const operadorIds = Array.from(
      new Set(recintos.map((r) => operadorPorRecinto.get(r.id)!)),
    );

    const usuarios = await this.prisma.usuario.findMany({
      where: { id: { in: operadorIds } },
      select: { id: true, nombres: true, apellidos: true },
    });
    const nombrePorId = new Map(usuarios.map((u) => [u.id, `${u.nombres} ${u.apellidos}`]));

    const trackingRows = await this.prisma.eventoTracking.findMany({
      where: { eventoId: evento.id, operadorId: { in: operadorIds } },
      select: { operadorId: true, tipo: true },
    });
    const tiposPorOperador = new Map<string, Set<string>>();
    for (const t of trackingRows) {
      const set = tiposPorOperador.get(t.operadorId) ?? new Set<string>();
      set.add(t.tipo);
      tiposPorOperador.set(t.operadorId, set);
    }

    const recepcionesConFoto = await this.prisma.recepcionKit.findMany({
      where: { operadorId: { in: operadorIds }, fotoMilitarUrl: { not: null } },
      select: { operadorId: true },
    });
    const operadoresConFoto = new Set(recepcionesConFoto.map((r) => r.operadorId));

    const ultimasGps = await this.prisma.$queryRaw<
      { operador_id: string; lat: number; lng: number; capturado_en: Date }[]
    >`
      SELECT DISTINCT ON (operador_id) operador_id,
             ST_Y(ubicacion::geometry) AS lat,
             ST_X(ubicacion::geometry) AS lng,
             capturado_en
      FROM posiciones_gps
      WHERE operador_id = ANY(${operadorIds}::uuid[]) AND evento_id = ${evento.id}::uuid
      ORDER BY operador_id, capturado_en DESC;
    `;
    const ultimasTracking = await this.prisma.$queryRaw<
      { operador_id: string; lat: number; lng: number; ocurrido_en: Date }[]
    >`
      SELECT DISTINCT ON (operador_id) operador_id,
             ST_Y(ubicacion::geometry) AS lat,
             ST_X(ubicacion::geometry) AS lng,
             ocurrido_en
      FROM eventos_tracking
      WHERE operador_id = ANY(${operadorIds}::uuid[]) AND evento_id = ${evento.id}::uuid
        AND ubicacion IS NOT NULL
      ORDER BY operador_id, ocurrido_en DESC;
    `;
    const gpsPorOperador = new Map(ultimasGps.map((g) => [g.operador_id, g]));
    const trackingPorOperador = new Map(ultimasTracking.map((t) => [t.operador_id, t]));

    function deriveEstado(tipos: Set<string> | undefined): EstadoOperadorCda {
      if (!tipos) return 'EN_DPI';
      if (tipos.has('LLEGADA_DPI')) return 'RETORNADO';
      if (tipos.has('SALIDA_RECINTO')) return 'EN_RETORNO';
      if (tipos.has('LLEGADA_RECINTO')) return 'EN_RECINTO';
      if (tipos.has('SALIDA_DPI')) return 'EN_TRANSITO';
      return 'EN_DPI';
    }

    return recintos.map((recinto) => {
      const operadorId = operadorPorRecinto.get(recinto.id)!;
      const gps = gpsPorOperador.get(operadorId);
      const trk = trackingPorOperador.get(operadorId);
      const ubicacion = gps
        ? { latitud: gps.lat, longitud: gps.lng, capturadoEn: gps.capturado_en.toISOString() }
        : trk
          ? { latitud: trk.lat, longitud: trk.lng, capturadoEn: trk.ocurrido_en.toISOString() }
          : null;

      return {
        recintoId: recinto.id,
        codigoRecinto: recinto.codigoRecinto,
        nombreRecinto: recinto.nombre,
        cantonId: recinto.cantonId,
        cantonNombre: recinto.canton?.nombre ?? null,
        operadorId,
        operadorNombre: nombrePorId.get(operadorId) ?? 'Operador',
        estado: deriveEstado(tiposPorOperador.get(operadorId)),
        ubicacion,
        tieneFotoMilitar: operadoresConFoto.has(operadorId),
      };
    });
  }

  /**
   * Reporte admin: por cada CDA con operador asignado, total de NO-CDAs
   * visitados vs. pendientes, para seguimiento manual/impresión.
   */
  async reporteNoCdas(): Promise<ReporteNoCdaItem[]> {
    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
      select: { id: true },
    });
    if (!evento) return [];

    const kits = await this.prisma.kitElectoral.findMany({
      where: { eventoId: evento.id, recintoId: { not: null }, operadorId: { not: null } },
      select: { recintoId: true, operadorId: true, codigoUnico: true },
    });
    const operadorPorRecinto = new Map<string, string>();
    const kitsPorRecinto = new Map<string, string[]>();
    for (const k of kits) {
      if (!k.recintoId || !k.operadorId) continue;
      operadorPorRecinto.set(k.recintoId, k.operadorId);
      const codigos = kitsPorRecinto.get(k.recintoId) ?? [];
      codigos.push(k.codigoUnico);
      kitsPorRecinto.set(k.recintoId, codigos);
    }

    const cdaIds = Array.from(operadorPorRecinto.keys());
    if (cdaIds.length === 0) return [];

    const cdas = await this.prisma.recinto.findMany({
      where: { id: { in: cdaIds }, tipo: 'CDA' },
      orderBy: { codigoRecinto: 'asc' },
    });
    if (cdas.length === 0) return [];

    const operadorIds = Array.from(new Set(cdas.map((c) => operadorPorRecinto.get(c.id)!)));
    const usuarios = await this.prisma.usuario.findMany({
      where: { id: { in: operadorIds } },
      select: { id: true, nombres: true, apellidos: true, cedula: true },
    });
    const usuarioPorId = new Map(usuarios.map((u) => [u.id, u]));

    const noCdas = await this.prisma.recinto.findMany({
      where: { cdaDestinoId: { in: cdaIds } },
      orderBy: { nombre: 'asc' },
    });
    const noCdasPorCda = new Map<string, typeof noCdas>();
    for (const nc of noCdas) {
      const lista = noCdasPorCda.get(nc.cdaDestinoId!) ?? [];
      lista.push(nc);
      noCdasPorCda.set(nc.cdaDestinoId!, lista);
    }

    const llegadas = await this.prisma.eventoTracking.findMany({
      where: {
        eventoId: evento.id,
        tipo: 'LLEGADA_NO_CDA',
        recintoId: { in: noCdas.map((nc) => nc.id) },
        operadorId: { in: operadorIds },
      },
      select: { recintoId: true },
    });
    const recintosConLlegada = new Set(llegadas.map((l) => l.recintoId));

    return cdas.map((cda) => {
      const operadorId = operadorPorRecinto.get(cda.id)!;
      const usuario = usuarioPorId.get(operadorId);
      const hijos = noCdasPorCda.get(cda.id) ?? [];
      const totalLlegados = hijos.filter((nc) => recintosConLlegada.has(nc.id)).length;

      return {
        cdaId: cda.id,
        cdaCodigo: cda.codigoRecinto,
        cdaNombre: cda.nombre,
        operadorNombre: usuario ? `${usuario.nombres} ${usuario.apellidos}` : 'Operador',
        operadorCedula: usuario?.cedula ?? '—',
        kitsCodigos: kitsPorRecinto.get(cda.id) ?? [],
        totalNoCdas: hijos.length,
        totalLlegados,
        noCdas: hijos.map((nc) => ({
          id: nc.id,
          codigoRecinto: nc.codigoRecinto,
          nombre: nc.nombre,
          llegado: recintosConLlegada.has(nc.id),
        })),
      };
    });
  }

  /**
   * Reporte admin: hitos del flujo (Salida DPI / Llegada Recinto / Salida
   * Recinto / Llegada DPI) por CDA del evento activo, con su hora.
   */
  async reporteFlujoCdas(): Promise<ReporteFlujoItem[]> {
    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
      select: { id: true },
    });
    if (!evento) return [];

    const kits = await this.prisma.kitElectoral.findMany({
      where: { eventoId: evento.id, recintoId: { not: null }, operadorId: { not: null } },
      select: { recintoId: true, operadorId: true, codigoUnico: true },
    });
    const operadorPorRecinto = new Map<string, string>();
    const kitsPorRecinto = new Map<string, string[]>();
    for (const k of kits) {
      if (!k.recintoId || !k.operadorId) continue;
      operadorPorRecinto.set(k.recintoId, k.operadorId);
      const codigos = kitsPorRecinto.get(k.recintoId) ?? [];
      codigos.push(k.codigoUnico);
      kitsPorRecinto.set(k.recintoId, codigos);
    }

    const cdaIds = Array.from(operadorPorRecinto.keys());
    if (cdaIds.length === 0) return [];

    const cdas = await this.prisma.recinto.findMany({
      where: { id: { in: cdaIds }, tipo: 'CDA' },
      orderBy: { codigoRecinto: 'asc' },
    });
    if (cdas.length === 0) return [];

    const operadorIds = Array.from(new Set(cdas.map((c) => operadorPorRecinto.get(c.id)!)));
    const usuarios = await this.prisma.usuario.findMany({
      where: { id: { in: operadorIds } },
      select: { id: true, nombres: true, apellidos: true, cedula: true },
    });
    const usuarioPorId = new Map(usuarios.map((u) => [u.id, u]));

    const hitos = await this.prisma.eventoTracking.findMany({
      where: {
        eventoId: evento.id,
        operadorId: { in: operadorIds },
        tipo: { in: ['SALIDA_DPI', 'LLEGADA_RECINTO', 'SALIDA_RECINTO', 'LLEGADA_DPI'] },
      },
      select: { operadorId: true, tipo: true, ocurridoEn: true },
    });
    const hitosPorOperador = new Map<string, Map<string, Date>>();
    for (const h of hitos) {
      const mapa = hitosPorOperador.get(h.operadorId) ?? new Map<string, Date>();
      mapa.set(h.tipo, h.ocurridoEn);
      hitosPorOperador.set(h.operadorId, mapa);
    }

    return cdas.map((cda) => {
      const operadorId = operadorPorRecinto.get(cda.id)!;
      const usuario = usuarioPorId.get(operadorId);
      const mapa = hitosPorOperador.get(operadorId);

      return {
        cdaId: cda.id,
        cdaCodigo: cda.codigoRecinto,
        cdaNombre: cda.nombre,
        operadorNombre: usuario ? `${usuario.nombres} ${usuario.apellidos}` : 'Operador',
        operadorCedula: usuario?.cedula ?? '—',
        kitsCodigos: kitsPorRecinto.get(cda.id) ?? [],
        salidaDpiEn: mapa?.get('SALIDA_DPI')?.toISOString() ?? null,
        llegadaRecintoEn: mapa?.get('LLEGADA_RECINTO')?.toISOString() ?? null,
        salidaRecintoEn: mapa?.get('SALIDA_RECINTO')?.toISOString() ?? null,
        llegadaDpiEn: mapa?.get('LLEGADA_DPI')?.toISOString() ?? null,
      };
    });
  }

  /**
   * Devuelve la foto del militar (cifrada en disco) descifrada para el CDA
   * del recinto indicado. Reutiliza el mismo control de acceso que
   * estadoCdas: administradores ven cualquier CDA, supervisores solo los de
   * sus operadores asignados.
   */
  async obtenerFotoMilitar(
    recintoId: string,
    viewerId: string,
    roles: RoleName[],
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
      select: { id: true },
    });
    if (!evento) throw new NotFoundException('No hay un evento electoral activo');

    const kit = await this.prisma.kitElectoral.findFirst({
      where: { eventoId: evento.id, recintoId, operadorId: { not: null } },
      select: { operadorId: true },
    });
    if (!kit?.operadorId) throw new NotFoundException('CDA no encontrado');

    const esAdmin = roles.includes('ADMINISTRADOR');
    if (!esAdmin) {
      const asignado = await this.prisma.asignacionSupervisor.findFirst({
        where: { eventoId: evento.id, supervisorId: viewerId, operadorId: kit.operadorId },
        select: { id: true },
      });
      if (!asignado) throw new NotFoundException('CDA no encontrado');
    }

    const recepcion = await this.prisma.recepcionKit.findFirst({
      where: { operadorId: kit.operadorId, fotoMilitarUrl: { not: null } },
      select: { fotoMilitarUrl: true },
      orderBy: { confirmadoEn: 'desc' },
    });
    if (!recepcion?.fotoMilitarUrl) {
      throw new NotFoundException('No hay foto del militar registrada para este CDA');
    }

    const buffer = await this.storage.readDecrypted(recepcion.fotoMilitarUrl);
    return { buffer, contentType: detectarContentTypeImagen(buffer) };
  }

  /**
   * HU5-CA2/CA3: registra EventoTracking LLEGADA_DPI con GPS, valida que la
   * salida del recinto se haya registrado antes, marca los kits como RETORNADO
   * y notifica a supervisor y administradores. Con este evento finaliza el
   * monitoreo en tiempo real (operadoresEnRetorno excluye a quienes ya llegaron).
   * Rechaza segundo POST con 409.
   */
  async registrarLlegadaDpi(
    operadorId: string,
    input: LlegadaDpiRequest,
  ): Promise<LlegadaDpiResponse> {
    const parsed = llegadaDpiSchema.parse(input);

    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
    });
    if (!evento) throw new NotFoundException('No hay un evento electoral activo');

    const existente = await this.prisma.eventoTracking.findFirst({
      where: { eventoId: evento.id, operadorId, tipo: 'LLEGADA_DPI' },
      select: { id: true },
    });
    if (existente) throw new ConflictException('Ya registraste tu llegada al DPI');

    const salidaRecintoPrevia = await this.prisma.eventoTracking.findFirst({
      where: { eventoId: evento.id, operadorId, tipo: 'SALIDA_RECINTO' },
      select: { id: true },
    });
    if (!salidaRecintoPrevia) {
      throw new BadRequestException(
        'Debes registrar la salida del recinto antes de la llegada al DPI',
      );
    }

    const kit = await this.prisma.kitElectoral.findFirst({
      where: { eventoId: evento.id, operadorId },
      select: { recintoId: true },
    });
    const recintoId = kit?.recintoId ?? null;
    const ocurridoEn = new Date(parsed.ocurridoEn);

    const id: string = (await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO eventos_tracking (id, evento_id, operador_id, tipo, recinto_id, ubicacion, ocurrido_en, desde_offline, registrado_en)
      VALUES (
        uuid_generate_v4(),
        ${evento.id}::uuid,
        ${operadorId}::uuid,
        'LLEGADA_DPI'::tipo_tracking,
        ${recintoId}::uuid,
        ST_SetSRID(ST_MakePoint(${parsed.longitud}, ${parsed.latitud}), 4326)::geography,
        ${ocurridoEn}::timestamptz,
        false,
        now()
      )
      RETURNING id;
    `)[0].id;

    await this.prisma.kitElectoral.updateMany({
      where: { eventoId: evento.id, operadorId, estado: 'EN_RETORNO' },
      data: { estado: 'RETORNADO' },
    });

    const operador = await this.prisma.usuario.findUnique({
      where: { id: operadorId },
      select: { nombres: true, apellidos: true },
    });
    const recintoNombre = recintoId
      ? (await this.prisma.recinto.findUnique({ where: { id: recintoId }, select: { nombre: true } }))?.nombre ?? null
      : null;

    await this.notifications.encolarLlegadaDpi({
      operadorId,
      eventoId: evento.id,
      payload: {
        operadorId,
        operadorNombre: operador ? `${operador.nombres} ${operador.apellidos}` : null,
        recintoNombre,
        ocurridoEn: ocurridoEn.toISOString(),
      },
    });

    return { id, ocurridoEn: ocurridoEn.toISOString() };
  }

  async resetEstadoOperador(operadorId: string): Promise<{ kitsReseteados: number }> {
    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
    });
    if (!evento) throw new NotFoundException('No hay un evento electoral activo');

    const kits = await this.prisma.kitElectoral.findMany({
      where: { eventoId: evento.id, operadorId },
      select: { id: true },
    });
    const kitIds = kits.map((k) => k.id);

    await this.prisma.$transaction([
      this.prisma.eventoTracking.deleteMany({ where: { eventoId: evento.id, operadorId } }),
      this.prisma.posicionGps.deleteMany({ where: { eventoId: evento.id, operadorId } }),
      this.prisma.recepcionKit.deleteMany({ where: { kitId: { in: kitIds } } }),
      this.prisma.recepcionDpiKit.deleteMany({ where: { kitId: { in: kitIds } } }),
      this.prisma.kitElectoral.updateMany({
        where: { id: { in: kitIds } },
        data: { estado: 'ASIGNADO' },
      }),
    ]);

    return { kitsReseteados: kitIds.length };
  }
}

/** Detecta el content-type de una imagen a partir de sus magic bytes. */
function detectarContentTypeImagen(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'GIF8') {
    return 'image/gif';
  }
  return 'image/jpeg';
}

function parseContenidos(contenidos: string | null): string[] {
  if (!contenidos?.trim()) return [];
  const porLinea = contenidos.split('\n').map((s) => s.trim()).filter(Boolean);
  if (porLinea.length > 1) return porLinea;
  return contenidos.split(',').map((s) => s.trim()).filter(Boolean);
}
// ponytail: heurística simple (salto de línea, si no hay, coma). Si en el futuro
// los admins necesitan listas más ricas, migrar `contenidos` a una tabla real.
