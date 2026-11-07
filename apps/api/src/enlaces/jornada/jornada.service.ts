import { Injectable, Logger } from '@nestjs/common';
import { MINUTOS_RESUMEN_JORNADA_POR_DEFECTO } from '@cne/shared-validation';
import { PrismaService } from '../../db/prisma.service';
import { DistributivoTecnicosClient, type AsignacionTecnico } from '../distributivo-tecnicos.client';
import { escapeHtml } from '../../auth/notifier';
import { buscarRecintosDetalle } from '../asistente/buscar-recintos';
import { TelegramNotifier } from '../telegram-notifier';
import {
  BOTON_CONSULTAR_CDA,
  MOMENTOS_JORNADA,
  callbackFichaCda,
  consultablesDe,
  formatearFichaCda,
  formatearResumenJornada,
  gruposDe,
  leerCallbackFichaCda,
  leerCallbackFrecuencia,
  leerCallbackJornada,
  mensajeFrecuencia,
  paginasDetalleJornada,
  tecladoFichaCda,
  tecladoFrecuencia,
  tecladoFijoJornada,
  tecladoJornada,
  vistaDeTexto,
  type AgrupacionJornada,
  type BotonJornada,
  type ActasJornada,
  type CantonJornada,
  type Jornada,
  type KitEscaneadoJornada,
  type MomentoJornada,
  type PersonaJornada,
  type RegistroJornada,
  type TecnicoJornada,
  type UnidadJornada,
  type VistaJornada,
} from './jornada';

/** Toques más seguidos que esto sobre el mismo botón se ignoran (cada uno son consultas a la base). */
const PAUSA_ENTRE_TOQUES_MS = 1500;

const SIN_TECNICO: TecnicoJornada = { numero: null, nombre: '' };
const SIN_CANTON: CantonJornada = { codigo: null, nombre: 'Sin cantón' };

/** "Consultar CDA": cuánto espera el bot el código o nombre después de tocar el botón. */
const ESPERA_CONSULTA_MS = 5 * 60_000;
/** Varios resultados: hasta tantos botones para elegir. */
const MAX_BOTONES_CONSULTA = 8;
/** Lo escrito se usa y se repite hasta este largo. */
const MAX_LARGO_CONSULTA = 60;

function cantonDe(c: { codigo: string; nombre: string } | null | undefined): CantonJornada {
  const codigo = Number(c?.codigo);
  return c && Number.isInteger(codigo) && codigo > 0 ? { codigo, nombre: c.nombre } : SIN_CANTON;
}

/** "/cda 1133" (con o sin @bot): consulta directa sin tocar el botón. */
function consultaDeComando(texto: string): string | null {
  const m = /^\/cda(?:@\w+)?(?:\s+(.+))?$/is.exec(texto.trim());
  return m ? (m[1] ?? '').trim() : null;
}

/** true si el chat es el grupo Jornada (TELEGRAM_CHAT_ID_JORNADA). Sin la variable, el grupo está apagado. */
export function esChatJornada(chatId: number | string | undefined): boolean {
  const jornada = process.env.TELEGRAM_CHAT_ID_JORNADA?.trim();
  if (!jornada || chatId === undefined || String(chatId) !== jornada) return false;
  // Con teléfonos de por medio, nunca en el grupo de enlaces ni en uno de consulta.
  const otros = [process.env.TELEGRAM_CHAT_ID, ...(process.env.TELEGRAM_CHAT_IDS_CONSULTA ?? '').split(',')].map((c) => c?.trim());
  return !otros.includes(jornada);
}

/** La jornada cambia de día a las 04:00 de Ecuador: quien vuelve al DPEI pasada la medianoche sigue en el mismo día. */
const CAMBIO_DE_DIA_H = 4;
const ECUADOR_UTC_H = -5;

/** Inicio del día de jornada (04:00 de Ecuador) y su fecha "YYYY-MM-DD". */
export function diaDeJornada(ahora: Date): { desde: Date; fecha: string } {
  const local = new Date(ahora.getTime() + (ECUADOR_UTC_H - CAMBIO_DE_DIA_H) * 3_600_000);
  const fecha = local.toISOString().slice(0, 10);
  const desde = new Date(`${fecha}T00:00:00Z`);
  desde.setUTCHours(CAMBIO_DE_DIA_H - ECUADOR_UTC_H);
  return { desde, fecha };
}

/** Cuánto se reutiliza una carga: varios toques seguidos no repiten las consultas. */
const CACHE_CARGA_MS = 5_000;

/** Fila única de config_enlaces (la misma de la frecuencia de avisos de enlaces). */
const CONFIG_ID = 1;

/** "/frecuencia" (con o sin @bot): muestra cada cuánto llega el resumen automático. */
function esComandoFrecuencia(texto: string): boolean {
  return /^\/frecuencia(@\w+)?$/i.test(texto.trim());
}

/** "/jornada", "/start" o "/menu" (con o sin @bot): manda el teclado de la Jornada. */
function esComandoMenu(texto: string): boolean {
  return /^\/(jornada|start|menu)(@\w+)?$/i.test(texto.trim());
}

@Injectable()
export class JornadaService {
  private readonly log = new Logger('JornadaTelegram');
  private readonly ultimoToque = new Map<string, number>();
  /** "chat:usuario" → cuándo tocó "Consultar CDA" (espera el código o nombre). */
  private readonly esperandoConsulta = new Map<string, number>();
  private cache: { en: number; carga: Promise<Jornada | null> } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly distributivo: DistributivoTecnicosClient,
    private readonly telegram: TelegramNotifier,
  ) {}

  /** Un mensaje del grupo Jornada. Devuelve false si no es de la Jornada (lo atiende el bot de enlaces). */
  async atenderMensaje(chatId: number | string, texto: string, userId?: number | string): Promise<boolean> {
    if (!esChatJornada(chatId)) return false;
    const chat = String(chatId);
    // Sin remitente identificable (administrador anónimo o un canal) no se puede aislar la espera de cada persona.
    const claveEspera = userId !== undefined ? `${chat}:${userId}` : undefined;
    const comando = consultaDeComando(texto);
    // El botón o "/cda" solo: se pide el código o nombre.
    if (texto.trim().toLowerCase() === BOTON_CONSULTAR_CDA.toLowerCase() || comando === '') {
      await this.telegram.responderEn(chat, () => this.pedirConsulta(claveEspera));
      return true;
    }
    if (comando !== null) {
      if (claveEspera) this.esperandoConsulta.delete(claveEspera);
      await this.telegram.responderEn(chat, () => this.conAvisoError(() => this.consultarCda(comando)));
      return true;
    }
    if (esComandoFrecuencia(texto)) {
      await this.telegram.responderEn(chat, () => this.conAvisoError(() => this.enviarFrecuencia()));
      return true;
    }
    if (esComandoMenu(texto)) {
      await this.telegram.responderEn(String(chatId), () =>
        this.telegram.enviarHtml(
          '<b>📋 Jornada</b>\nToque un botón para ver quién falta y quién ya cumplió, por técnico o por cantón.\n' +
            'Con 🔎 Consultar CDA vea un CDA puntual (también escribiendo /cda y su código o nombre).',
          'el menú de la jornada',
          tecladoFijoJornada(),
        ),
      );
      return true;
    }
    const vista = vistaDeTexto(texto);
    if (vista) {
      if (claveEspera) this.esperandoConsulta.delete(claveEspera);
      await this.telegram.responderEn(chat, () => this.conAvisoError(() => this.enviarResumen(vista)));
      return true;
    }
    // Otro comando ("/preguntar", "/caidos"…) no se toma como el código que se esperaba.
    if (claveEspera && !texto.trim().startsWith('/') && this.esperaVigente(claveEspera)) {
      this.esperandoConsulta.delete(claveEspera);
      await this.telegram.responderEn(chat, () => this.conAvisoError(() => this.consultarCda(texto)));
      return true;
    }
    return false;
  }

  private async pedirConsulta(claveEspera: string | undefined): Promise<void> {
    if (!claveEspera) {
      await this.telegram.enviarHtml(
        'Escriba <code>/cda</code> seguido del código o nombre del CDA (por ejemplo <code>/cda 1133</code>).',
        'el aviso de consulta sin remitente',
        tecladoFijoJornada(),
      );
      return;
    }
    this.limpiarEsperas();
    this.esperandoConsulta.set(claveEspera, Date.now());
    // "Responder" en vez del teclado fijo: aunque el bot tenga la privacidad de grupos activada,
    // la respuesta a su mensaje le llega.
    await this.telegram.enviarHtml(
      '✏️ Escriba el código o el nombre del CDA (o de un NO CDA para ver su CDA).',
      'el pedido de consulta de CDA',
      { force_reply: true, input_field_placeholder: 'Código o nombre del CDA' },
    );
  }

  private esperaVigente(clave: string, ahora = Date.now()): boolean {
    const desde = this.esperandoConsulta.get(clave);
    return desde !== undefined && ahora - desde <= ESPERA_CONSULTA_MS;
  }

  /** Las esperas viejas se borran: el mapa no crece sin límite. */
  private limpiarEsperas(ahora = Date.now()): void {
    for (const [clave, desde] of this.esperandoConsulta) {
      if (ahora - desde > ESPERA_CONSULTA_MS) this.esperandoConsulta.delete(clave);
    }
  }

  /** Busca un CDA (o un NO CDA, que lleva a su CDA) por código o nombre y manda su ficha. */
  private async consultarCda(escrito: string): Promise<void> {
    const texto = Array.from(escrito.trim()).slice(0, MAX_LARGO_CONSULTA).join('');
    if (!texto) {
      await this.telegram.enviarHtml('Escriba el código o el nombre del CDA.', 'el aviso de consulta vacía', tecladoFijoJornada());
      return;
    }
    const jornada = await this.cargar();
    if (!jornada) {
      await this.telegram.enviarHtml('No hay un evento electoral activo.', 'el aviso sin evento', tecladoFijoJornada());
      return;
    }
    const { recintos } = buscarRecintosDetalle(texto, consultablesDe(jornada));
    const cdas = [...new Set(recintos.map((r) => r.codigoCda))];
    if (cdas.length === 0) {
      await this.telegram.enviarHtml(
        `⚠️ No encontré un CDA o NO CDA con "${escapeHtml(texto)}". Pruebe con el código o con otra parte del nombre.`,
        'el aviso de CDA no encontrado',
        tecladoFijoJornada(),
      );
      return;
    }
    if (cdas.length === 1) {
      const desde = recintos.find((r) => r.esNoCda && r.codigoCda === cdas[0]);
      const aviso =
        desde && recintos.length === 1
          ? `🏫 ${escapeHtml(desde.codigoRecinto)} · ${escapeHtml(desde.nombreRecinto)} es un NO CDA de este CDA:\n\n`
          : '';
      await this.enviarFicha(jornada, cdas[0], aviso);
      return;
    }
    const elegibles = recintos.slice(0, MAX_BOTONES_CONSULTA);
    await this.telegram.enviarHtml(
      `🔎 Encontré ${recintos.length} recintos para "${escapeHtml(texto)}". Toque uno para ver su CDA.` +
        (recintos.length > elegibles.length ? `\nSe muestran ${elegibles.length}: escriba más detalle o use el código.` : ''),
      'la lista de CDA encontrados',
      {
        inline_keyboard: elegibles.map((r) => [
          {
            text: `${r.codigoRecinto} · ${r.nombreRecinto}${r.esNoCda ? ` (NO CDA de ${r.codigoCda})` : ''}`.slice(0, 60),
            callback_data: callbackFichaCda(r.codigoCda),
          },
        ]),
      },
    );
  }

  private async enviarFicha(jornada: Jornada, codigo: string, prefijo = ''): Promise<void> {
    const ficha = formatearFichaCda(jornada, codigo, new Date());
    if (!ficha) {
      await this.telegram.enviarHtml(`El CDA ${escapeHtml(codigo)} no está en este evento.`, 'el aviso de CDA fuera del evento', tecladoFijoJornada());
      return;
    }
    await this.telegram.enviarHtml(`${prefijo}${ficha}`, 'la ficha del CDA', tecladoFichaCda(jornada, codigo));
  }

  /** Un botón bajo un mensaje de la Jornada. Devuelve false si el botón no es de la Jornada. */
  async atenderBoton(
    chatId: number | string | undefined,
    callbackId: string,
    data: string | undefined,
    messageId: number | undefined,
    userId?: number | string,
  ): Promise<boolean> {
    const frecuencia = leerCallbackFrecuencia(data);
    if (frecuencia) {
      if (!esChatJornada(chatId)) return false;
      await this.telegram.responderEn(String(chatId), () => this.atenderFrecuencia(callbackId, frecuencia.minutos, messageId, userId));
      return true;
    }
    const boton = leerCallbackJornada(data);
    const fichaCda = boton ? null : leerCallbackFichaCda(data);
    if ((!boton && !fichaCda) || !esChatJornada(chatId)) return false;
    await this.telegram.responderEn(String(chatId), async () => {
      // Primero se contesta el toque, para que el botón no quede "cargando".
      await this.telegram.responderBoton(callbackId);
      if (typeof messageId !== 'number') return;
      if (this.toqueDemasiadoSeguido(`${chatId}:${messageId}:${data}`)) return;
      await this.conAvisoError(() => (boton ? this.mostrar(messageId, boton) : this.mostrarFicha(messageId, fichaCda!)));
    });
    return true;
  }

  /** Cada cuánto manda el bot el resumen automático (guardado desde la web o el bot). */
  async minutosResumen(): Promise<number> {
    const config = await this.prisma.configEnlaces.findUnique({
      where: { id: CONFIG_ID },
      select: { minutosResumenJornada: true },
    });
    return config?.minutosResumenJornada ?? MINUTOS_RESUMEN_JORNADA_POR_DEFECTO;
  }

  /** Quien llama valida que sea una de MINUTOS_RESUMEN_JORNADA. */
  async guardarMinutosResumen(minutos: number): Promise<void> {
    await this.prisma.configEnlaces.upsert({
      where: { id: CONFIG_ID },
      create: { id: CONFIG_ID, minutosResumenJornada: minutos },
      update: { minutosResumenJornada: minutos },
    });
  }

  private async enviarFrecuencia(): Promise<void> {
    const minutos = await this.minutosResumen();
    await this.telegram.enviarHtml(mensajeFrecuencia(minutos), 'la frecuencia del resumen', tecladoFrecuencia(minutos));
  }

  /**
   * "⏱ Frecuencia del resumen" (sin minutos) manda las opciones; una opción la
   * cambia, solo si quien toca es administrador del grupo.
   */
  private async atenderFrecuencia(
    callbackId: string,
    minutos: number | null,
    messageId: number | undefined,
    userId: number | string | undefined,
  ): Promise<void> {
    if (minutos === null) {
      await this.telegram.responderBoton(callbackId);
      await this.conAvisoError(() => this.enviarFrecuencia());
      return;
    }
    // Sin remitente (administrador anónimo) no se puede confirmar quién es.
    if (userId === undefined || !(await this.telegram.esAdministrador(userId))) {
      await this.telegram.responderBoton(callbackId, 'Solo los administradores del grupo pueden cambiar la frecuencia.');
      return;
    }
    await this.telegram.responderBoton(callbackId);
    await this.conAvisoError(async () => {
      await this.guardarMinutosResumen(minutos);
      this.log.log(`Frecuencia del resumen de la jornada cambiada a ${minutos} min por el usuario de Telegram ${userId}`);
      if (typeof messageId === 'number') {
        await this.telegram.editarHtml(messageId, mensajeFrecuencia(minutos, true), 'la frecuencia del resumen', tecladoFrecuencia(minutos));
      }
    });
  }

  private async enviarResumen(vista: VistaJornada): Promise<void> {
    const jornada = await this.cargar();
    if (!jornada) {
      await this.telegram.enviarHtml('No hay un evento electoral activo.', 'el aviso sin evento', tecladoFijoJornada());
      return;
    }
    const ahora = new Date();
    // Llegada NO CDA abre por CDA: lo que se busca es qué CDA tienen todos sus NO CDA.
    const agrupacion: AgrupacionJornada = vista === 'NO_CDA' ? 'cda' : 'tec';
    await this.telegram.enviarHtml(
      formatearResumenJornada(jornada, vista, ahora, agrupacion),
      'el resumen de la jornada',
      tecladoJornada(jornada, vista, 'res', 0, 1, agrupacion),
    );
  }

  /** Botón de una ficha (elegir CDA o ↻): cambia ese mensaje a la ficha al día. */
  private async mostrarFicha(messageId: number, codigo: string): Promise<void> {
    const jornada = await this.cargar();
    const ficha = jornada ? formatearFichaCda(jornada, codigo, new Date()) : null;
    await this.telegram.editarHtml(
      messageId,
      ficha ?? (jornada ? `El CDA ${escapeHtml(codigo)} no está en este evento.` : 'No hay un evento electoral activo.'),
      'la ficha del CDA',
      ficha && jornada ? tecladoFichaCda(jornada, codigo) : { inline_keyboard: [] },
    );
  }

  private async mostrar(messageId: number, { vista, agrupacion, seleccion, pagina }: BotonJornada): Promise<void> {
    const jornada = await this.cargar();
    if (!jornada) {
      await this.telegram.editarHtml(messageId, 'No hay un evento electoral activo.', 'el aviso sin evento', { inline_keyboard: [] });
      return;
    }
    const ahora = new Date();
    // Un técnico o cantón que ya no está vuelve al resumen.
    const existe =
      seleccion === 'res' || seleccion === 'tod' || gruposDe(jornada, agrupacion).some((g) => g.clave === seleccion);
    if (seleccion === 'res' || !existe) {
      await this.telegram.editarHtml(
        messageId,
        formatearResumenJornada(jornada, vista, ahora, agrupacion),
        'el resumen de la jornada',
        tecladoJornada(jornada, vista, 'res', 0, 1, agrupacion),
      );
      return;
    }
    const paginas = paginasDetalleJornada(jornada, vista, seleccion, ahora, agrupacion);
    // Si la lista se acortó desde que se tocó, se muestra la última página que queda.
    const actual = Math.min(pagina, paginas.length - 1);
    await this.telegram.editarHtml(
      messageId,
      paginas[actual],
      'el detalle de la jornada',
      tecladoJornada(jornada, vista, seleccion, actual, paginas.length, agrupacion),
    );
  }

  /** Si la base falla, lo dice en el grupo en vez de callar. */
  private async conAvisoError(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.log.error(`No se pudo armar la jornada para Telegram: ${(e as Error)?.message ?? e}`);
      await this.telegram.enviarHtml(
        '⚠️ No se pudo consultar la jornada en este momento. Intente de nuevo en unos minutos.',
        'el aviso de error de la jornada',
        tecladoFijoJornada(),
      );
    }
  }

  /** true si ese botón se tocó hace menos de PAUSA_ENTRE_TOQUES_MS (y si no, lo registra). */
  private toqueDemasiadoSeguido(clave: string, ahora = Date.now()): boolean {
    const anterior = this.ultimoToque.get(clave);
    if (anterior !== undefined && ahora - anterior < PAUSA_ENTRE_TOQUES_MS) return true;
    for (const [id, t] of this.ultimoToque) if (ahora - t >= PAUSA_ENTRE_TOQUES_MS) this.ultimoToque.delete(id);
    this.ultimoToque.set(clave, ahora);
    return false;
  }

  /** Estado del evento activo (reutilizado unos segundos); null si no hay ninguno. */
  cargar(ahora = Date.now()): Promise<Jornada | null> {
    if (this.cache && ahora - this.cache.en < CACHE_CARGA_MS) return this.cache.carga;
    const carga = this.consultar(new Date(ahora));
    this.cache = { en: ahora, carga };
    // Si falla, la próxima vez se vuelve a consultar.
    carga.catch(() => {
      if (this.cache?.carga === carga) this.cache = null;
    });
    return carga;
  }

  private async consultar(ahora: Date): Promise<Jornada | null> {
    const dia = diaDeJornada(ahora);
    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
      select: { id: true, nombre: true },
    });
    if (!evento) return null;

    const [kits, cdas, asignaciones] = await Promise.all([
      this.prisma.kitElectoral.findMany({
        where: { eventoId: evento.id, esPrueba: false, operadorId: { not: null }, recintoId: { not: null } },
        orderBy: [{ recinto: { codigoRecinto: 'asc' } }, { id: 'asc' }],
        select: {
          id: true,
          operadorId: true,
          recinto: {
            select: { id: true, codigoRecinto: true, nombre: true, tiempoDpiMin: true, canton: { select: { codigo: true, nombre: true } } },
          },
          operador: { select: { nombres: true, apellidos: true, telefono: true } },
        },
      }),
      this.prisma.recinto.findMany({
        where: { tipo: 'CDA', activo: true },
        select: { id: true, codigoRecinto: true, nombre: true, canton: { select: { codigo: true, nombre: true } } },
      }),
      this.leerDistributivo(),
    ]);
    const kitIds = kits.map((k) => k.id);
    const operadorIds = [...new Set(kits.map((k) => k.operadorId!))];

    const [parejas, tracking, recepciones, escaneos, noCdas] = await Promise.all([
      // La pareja más reciente que lleva cada kit (un kit puede repetirse en varios días).
      this.prisma.parejaCda.findMany({
        where: { kitId: { in: kitIds } },
        orderBy: { fecha: 'desc' },
        select: {
          kitId: true,
          fecha: true,
          operador: { select: { apellidosNombres: true, telefono: true } },
          asistente: { select: { apellidosNombres: true, telefono: true } },
        },
      }),
      this.prisma.eventoTracking.findMany({
        where: {
          eventoId: evento.id,
          operadorId: { in: operadorIds },
          tipo: { in: MOMENTOS_JORNADA },
          ocurridoEn: { gte: dia.desde },
        },
        orderBy: { ocurridoEn: 'asc' },
        select: {
          operadorId: true,
          tipo: true,
          ocurridoEn: true,
          desdeOffline: true,
          // Solo vienen llenos en la SALIDA_RECINTO (Cumplimiento).
          actaInstalacionUrl: true,
          actaEscrutinioUrl: true,
        },
      }),
      this.prisma.recepcionDpiKit.findMany({
        where: { kitId: { in: kitIds }, confirmadoEn: { gte: dia.desde } },
        select: { kitId: true, confirmadoEn: true },
      }),
      // El operador escanea su kit (con la foto del militar) en la llegada al recinto.
      this.prisma.recepcionKit.findMany({
        where: { kitId: { in: kitIds }, operadorId: { in: operadorIds }, confirmadoEn: { gte: dia.desde } },
        select: { kitId: true, operadorId: true, confirmadoEn: true, desdeOffline: true, fotoMilitarUrl: true },
      }),
      this.prisma.recinto.findMany({
        where: { tipo: 'NO_CDA', activo: true, cdaDestinoId: { not: null } },
        select: {
          id: true,
          codigoRecinto: true,
          nombre: true,
          cdaDestinoId: true,
          canton: { select: { codigo: true, nombre: true } },
        },
      }),
    ]);
    const gpsPorOperador = await this.ultimoGpsEnCamino(evento.id, tracking, dia.desde);
    const visitas = await this.prisma.eventoTracking.findMany({
      where: {
        eventoId: evento.id,
        tipo: 'LLEGADA_NO_CDA',
        recintoId: { in: noCdas.map((n) => n.id) },
        ocurridoEn: { gte: dia.desde },
      },
      orderBy: { ocurridoEn: 'asc' },
      select: { recintoId: true, ocurridoEn: true, desdeOffline: true },
    });

    // Genéricos explícitos: sin ellos la CI (sin `prisma generate`) infiere Map<unknown, unknown>.
    const tecnicoPorCodigo = new Map<string, TecnicoJornada>();
    for (const a of [...(asignaciones ?? [])].sort((x, y) => x.numeroTecnico - y.numeroTecnico)) {
      if (!tecnicoPorCodigo.has(a.codigoRecinto)) {
        tecnicoPorCodigo.set(a.codigoRecinto, { numero: a.numeroTecnico, nombre: a.tecnico });
      }
    }
    const tecnicoDe = (codigo: string) => tecnicoPorCodigo.get(codigo) ?? SIN_TECNICO;

    // La pareja de hoy o la más reciente anterior; una de una prueba futura solo si no hay otra (la más próxima).
    const parejaPorKit = new Map<string, (typeof parejas)[number]>();
    const yaPaso = (p: (typeof parejas)[number]) => p.fecha.toISOString().slice(0, 10) <= dia.fecha;
    for (const p of parejas) {
      if (!p.kitId) continue;
      const previa = parejaPorKit.get(p.kitId);
      // Vienen de la fecha más nueva a la más vieja.
      if (!previa || !yaPaso(previa)) parejaPorKit.set(p.kitId, p);
    }

    // El primer registro de cada momento (por operador): repetir una marca no cambia la hora.
    const registrosPorOperador = new Map<string, Partial<Record<MomentoJornada, RegistroJornada>>>();
    const actasPorOperador = new Map<string, ActasJornada>();
    for (const t of tracking) {
      const registros = registrosPorOperador.get(t.operadorId) ?? {};
      const momento = t.tipo as MomentoJornada;
      registros[momento] ??= { en: t.ocurridoEn, sinSenal: t.desdeOffline };
      registrosPorOperador.set(t.operadorId, registros);
      // Reportes de sus salidas del recinto del día: vale cualquiera que los traiga.
      if (momento === 'SALIDA_RECINTO') {
        const previas = actasPorOperador.get(t.operadorId);
        actasPorOperador.set(t.operadorId, {
          instalacion: !!previas?.instalacion || !!t.actaInstalacionUrl,
          escrutinio: !!previas?.escrutinio || !!t.actaEscrutinioUrl,
        });
      }
    }
    const recibidoPorKit = new Map<string, Date>();
    for (const r of recepciones) {
      const previo = recibidoPorKit.get(r.kitId);
      if (!previo || r.confirmadoEn < previo) recibidoPorKit.set(r.kitId, r.confirmadoEn);
    }

    // Con dos kits, el operador entregó cuando se recibieron todos (la hora es la del último).
    const kitsPorOperador = new Map<string, string[]>();
    for (const k of kits) kitsPorOperador.set(k.operadorId!, [...(kitsPorOperador.get(k.operadorId!) ?? []), k.id]);
    const recibidoDelOperador = (operadorId: string): Date | null => {
      const fechas = kitsPorOperador.get(operadorId)!.map((id) => recibidoPorKit.get(id));
      if (fechas.some((f) => !f)) return null;
      return new Date(Math.max(...fechas.map((f) => f!.getTime())));
    };

    // Escaneo de cada kit por su operador actual (uno de un operador anterior, si se reasignó el kit, no cuenta); vale el primero.
    const operadorDelKit = new Map<string, string>(kits.map((k) => [k.id, k.operadorId!]));
    const escaneoPorKit = new Map<string, (typeof escaneos)[number]>();
    for (const e of escaneos) {
      if (operadorDelKit.get(e.kitId) !== e.operadorId) continue;
      const previo = escaneoPorKit.get(e.kitId);
      if (!previo || e.confirmadoEn < previo.confirmadoEn) escaneoPorKit.set(e.kitId, e);
    }
    // Con dos kits, escaneó cuando escaneó todos (la hora es la del último).
    const escaneoDelOperador = (operadorId: string): KitEscaneadoJornada | null => {
      const suyos = kitsPorOperador.get(operadorId)!.map((id) => escaneoPorKit.get(id));
      if (suyos.some((e) => !e)) return null;
      const hechos = suyos as (typeof escaneos)[number][];
      return {
        en: new Date(Math.max(...hechos.map((e) => e.confirmadoEn.getTime()))),
        sinSenal: hechos.some((e) => e.desdeOffline),
        conFoto: hechos.every((e) => !!e.fotoMilitarUrl),
      };
    };

    const personasPorRecinto = new Map<string, PersonaJornada[]>();
    const unidades: UnidadJornada[] = [];
    const operadoresVistos = new Set<string>();
    for (const k of kits) {
      // El seguimiento es por quien lleva el celular: dos kits del mismo operador son una sola fila.
      if (operadoresVistos.has(k.operadorId!)) continue;
      operadoresVistos.add(k.operadorId!);
      const personas = personasDelKit(k, parejaPorKit.get(k.id));
      personasPorRecinto.set(k.recinto!.id, [...(personasPorRecinto.get(k.recinto!.id) ?? []), ...personas]);
      unidades.push({
        operadorId: k.operadorId!,
        codigoRecinto: k.recinto!.codigoRecinto,
        nombreRecinto: k.recinto!.nombre,
        tecnico: tecnicoDe(k.recinto!.codigoRecinto),
        canton: cantonDe(k.recinto!.canton),
        personas,
        registros: registrosPorOperador.get(k.operadorId!) ?? {},
        kitRecibido: recibidoDelOperador(k.operadorId!),
        kitEscaneado: escaneoDelOperador(k.operadorId!),
        actas: actasPorOperador.get(k.operadorId!) ?? null,
        tiempoViajeMin: k.recinto!.tiempoDpiMin ?? null,
        ultimoGps: gpsPorOperador.get(k.operadorId!) ?? null,
      });
    }

    const cdaPorId = new Map<string, (typeof cdas)[number]>(cdas.map((c) => [c.id, c]));
    const conKit = new Set(kits.map((k) => k.recinto!.id));
    const visitaPorRecinto = new Map<string, RegistroJornada>();
    for (const v of visitas) {
      if (v.recintoId && !visitaPorRecinto.has(v.recintoId)) {
        visitaPorRecinto.set(v.recintoId, { en: v.ocurridoEn, sinSenal: v.desdeOffline });
      }
    }
    const noCdasJornada = noCdas
      .filter((n) => cdaPorId.has(n.cdaDestinoId!))
      .map((n) => {
        const cda = cdaPorId.get(n.cdaDestinoId!)!;
        return {
          codigoRecinto: n.codigoRecinto,
          nombreRecinto: n.nombre,
          codigoCda: cda.codigoRecinto,
          nombreCda: cda.nombre,
          canton: cantonDe(n.canton),
          // Si el distributivo no trae el NO CDA, va con el técnico de su CDA.
          tecnico: tecnicoPorCodigo.get(n.codigoRecinto) ?? tecnicoDe(cda.codigoRecinto),
          personas: personasPorRecinto.get(cda.id) ?? [],
          visita: visitaPorRecinto.get(n.id) ?? null,
          cdaConKit: conKit.has(cda.id),
        };
      });

    const sinKit = cdas
      .filter((c) => !conKit.has(c.id))
      .map((c) => ({
        codigoRecinto: c.codigoRecinto,
        nombreRecinto: c.nombre,
        tecnico: tecnicoDe(c.codigoRecinto),
        canton: cantonDe(c.canton),
      }));

    return {
      eventoId: evento.id,
      evento: evento.nombre,
      unidades,
      noCdas: noCdasJornada,
      sinKit,
      sinDistributivo: asignaciones === null,
    };
  }

  /**
   * Último GPS del día solo de quienes van en camino (salió y no llegó, de ida o
   * de vuelta): son pocos, y así la consulta de cada minuto no recorre las
   * posiciones de todo el día de todos los operadores.
   */
  private async ultimoGpsEnCamino(
    eventoId: string,
    tracking: { operadorId: string; tipo: string }[],
    desde: Date,
  ): Promise<Map<string, Date | null>> {
    const momentos = new Map<string, Set<string>>();
    for (const t of tracking) momentos.set(t.operadorId, (momentos.get(t.operadorId) ?? new Set()).add(t.tipo));
    const enCamino = [...momentos]
      .filter(([, m]) => (m.has('SALIDA_DPI') && !m.has('LLEGADA_RECINTO')) || (m.has('SALIDA_RECINTO') && !m.has('LLEGADA_DPI')))
      .map(([id]) => id);
    if (enCamino.length === 0) return new Map();
    const gps = await this.prisma.posicionGps.groupBy({
      by: ['operadorId'],
      where: { eventoId, operadorId: { in: enCamino }, capturadoEn: { gte: desde } },
      _max: { capturadoEn: true },
    });
    return new Map<string, Date | null>(gps.map((g) => [g.operadorId, g._max.capturadoEn]));
  }

  /** null si el distributivo no está configurado o no se pudo leer: la jornada sigue, sin técnicos. */
  private async leerDistributivo(): Promise<AsignacionTecnico[] | null> {
    try {
      return await this.distributivo.asignaciones();
    } catch (e) {
      this.log.warn(`Jornada sin distributivo de técnicos: ${(e as Error)?.message ?? e}`);
      return null;
    }
  }
}

/** Operador y asistente de la pareja del kit; sin pareja, quien tiene el kit en la app. */
function personasDelKit(
  kit: { operador: { nombres: string; apellidos: string; telefono: string | null } | null },
  pareja:
    | {
        operador: { apellidosNombres: string; telefono: string | null } | null;
        asistente: { apellidosNombres: string; telefono: string | null } | null;
      }
    | undefined,
): PersonaJornada[] {
  if (pareja) {
    const personas: PersonaJornada[] = [];
    if (pareja.operador) {
      personas.push({ nombre: pareja.operador.apellidosNombres, telefono: pareja.operador.telefono, rol: 'Op.' });
    }
    if (pareja.asistente) {
      personas.push({ nombre: pareja.asistente.apellidosNombres, telefono: pareja.asistente.telefono, rol: 'Asis.' });
    }
    return personas;
  }
  if (!kit.operador) return [];
  return [{ nombre: `${kit.operador.apellidos} ${kit.operador.nombres}`, telefono: kit.operador.telefono, rol: 'Op.' }];
}
