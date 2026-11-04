import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { DistributivoTecnicosClient, type AsignacionTecnico } from '../distributivo-tecnicos.client';
import { TelegramNotifier } from '../telegram-notifier';
import {
  MOMENTOS_JORNADA,
  formatearResumenJornada,
  leerCallbackJornada,
  paginasDetalleJornada,
  tecnicosDe,
  tecladoFijoJornada,
  tecladoJornada,
  vistaDeTexto,
  type Jornada,
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

/** "/jornada", "/start" o "/menu" (con o sin @bot): manda el teclado de la Jornada. */
function esComandoMenu(texto: string): boolean {
  return /^\/(jornada|start|menu)(@\w+)?$/i.test(texto.trim());
}

@Injectable()
export class JornadaService {
  private readonly log = new Logger('JornadaTelegram');
  private readonly ultimoToque = new Map<string, number>();
  private cache: { en: number; carga: Promise<Jornada | null> } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly distributivo: DistributivoTecnicosClient,
    private readonly telegram: TelegramNotifier,
  ) {}

  /** Un mensaje del grupo Jornada. Devuelve false si no es de la Jornada (lo atiende el bot de enlaces). */
  async atenderMensaje(chatId: number | string, texto: string): Promise<boolean> {
    if (!esChatJornada(chatId)) return false;
    if (esComandoMenu(texto)) {
      await this.telegram.responderEn(String(chatId), () =>
        this.telegram.enviarHtml(
          '<b>📋 Jornada</b>\nToque un botón para ver quién falta y quién ya cumplió, por técnico.',
          'el menú de la jornada',
          tecladoFijoJornada(),
        ),
      );
      return true;
    }
    const vista = vistaDeTexto(texto);
    if (!vista) return false;
    await this.telegram.responderEn(String(chatId), () => this.conAvisoError(() => this.enviarResumen(vista)));
    return true;
  }

  /** Un botón bajo un mensaje de la Jornada. Devuelve false si el botón no es de la Jornada. */
  async atenderBoton(
    chatId: number | string | undefined,
    callbackId: string,
    data: string | undefined,
    messageId: number | undefined,
  ): Promise<boolean> {
    const boton = leerCallbackJornada(data);
    if (!boton || !esChatJornada(chatId)) return false;
    await this.telegram.responderEn(String(chatId), async () => {
      // Primero se contesta el toque, para que el botón no quede "cargando".
      await this.telegram.responderBoton(callbackId);
      if (typeof messageId !== 'number') return;
      if (this.toqueDemasiadoSeguido(`${chatId}:${messageId}:${data}`)) return;
      await this.conAvisoError(() => this.mostrar(messageId, boton.vista, boton.seleccion, boton.pagina));
    });
    return true;
  }

  private async enviarResumen(vista: VistaJornada): Promise<void> {
    const jornada = await this.cargar();
    if (!jornada) {
      await this.telegram.enviarHtml('No hay un evento electoral activo.', 'el aviso sin evento', tecladoFijoJornada());
      return;
    }
    const ahora = new Date();
    await this.telegram.enviarHtml(
      formatearResumenJornada(jornada, vista, ahora),
      'el resumen de la jornada',
      tecladoJornada(jornada, vista),
    );
  }

  private async mostrar(
    messageId: number,
    vista: VistaJornada,
    seleccion: number | 'sin' | 'res' | 'tod',
    pagina: number,
  ): Promise<void> {
    const jornada = await this.cargar();
    if (!jornada) {
      await this.telegram.editarHtml(messageId, 'No hay un evento electoral activo.', 'el aviso sin evento', { inline_keyboard: [] });
      return;
    }
    const ahora = new Date();
    // Un técnico que ya no está en el distributivo vuelve al resumen.
    const existe =
      seleccion === 'res' || seleccion === 'tod' || tecnicosDe(jornada).some((t) => (t.numero ?? 'sin') === seleccion);
    if (seleccion === 'res' || !existe) {
      await this.telegram.editarHtml(
        messageId,
        formatearResumenJornada(jornada, vista, ahora),
        'el resumen de la jornada',
        tecladoJornada(jornada, vista),
      );
      return;
    }
    const paginas = paginasDetalleJornada(jornada, vista, seleccion, ahora);
    // Si la lista se acortó desde que se tocó, se muestra la última página que queda.
    const actual = Math.min(pagina, paginas.length - 1);
    await this.telegram.editarHtml(
      messageId,
      paginas[actual],
      'el detalle de la jornada',
      tecladoJornada(jornada, vista, seleccion, actual, paginas.length),
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
          recinto: { select: { id: true, codigoRecinto: true, nombre: true } },
          operador: { select: { nombres: true, apellidos: true, telefono: true } },
        },
      }),
      this.prisma.recinto.findMany({
        where: { tipo: 'CDA', activo: true },
        select: { id: true, codigoRecinto: true, nombre: true },
      }),
      this.leerDistributivo(),
    ]);
    const kitIds = kits.map((k) => k.id);
    const operadorIds = [...new Set(kits.map((k) => k.operadorId!))];

    const [parejas, tracking, recepciones, noCdas] = await Promise.all([
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
        select: { operadorId: true, tipo: true, ocurridoEn: true, desdeOffline: true },
      }),
      this.prisma.recepcionDpiKit.findMany({
        where: { kitId: { in: kitIds }, confirmadoEn: { gte: dia.desde } },
        select: { kitId: true, confirmadoEn: true },
      }),
      this.prisma.recinto.findMany({
        where: { tipo: 'NO_CDA', activo: true, cdaDestinoId: { not: null } },
        select: { id: true, codigoRecinto: true, nombre: true, cdaDestinoId: true },
      }),
    ]);
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
    for (const t of tracking) {
      const registros = registrosPorOperador.get(t.operadorId) ?? {};
      const momento = t.tipo as MomentoJornada;
      registros[momento] ??= { en: t.ocurridoEn, sinSenal: t.desdeOffline };
      registrosPorOperador.set(t.operadorId, registros);
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
        codigoRecinto: k.recinto!.codigoRecinto,
        nombreRecinto: k.recinto!.nombre,
        tecnico: tecnicoDe(k.recinto!.codigoRecinto),
        personas,
        registros: registrosPorOperador.get(k.operadorId!) ?? {},
        kitRecibido: recibidoDelOperador(k.operadorId!),
      });
    }

    const cdaPorId = new Map<string, (typeof cdas)[number]>(cdas.map((c) => [c.id, c]));
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
          // Si el distributivo no trae el NO CDA, va con el técnico de su CDA.
          tecnico: tecnicoPorCodigo.get(n.codigoRecinto) ?? tecnicoDe(cda.codigoRecinto),
          personas: personasPorRecinto.get(cda.id) ?? [],
          visita: visitaPorRecinto.get(n.id) ?? null,
        };
      });

    const conKit = new Set(kits.map((k) => k.recinto!.id));
    const sinKit = cdas
      .filter((c) => !conKit.has(c.id))
      .map((c) => ({ codigoRecinto: c.codigoRecinto, nombreRecinto: c.nombre, tecnico: tecnicoDe(c.codigoRecinto) }));

    return {
      evento: evento.nombre,
      unidades,
      noCdas: noCdasJornada,
      sinKit,
      sinDistributivo: asignaciones === null,
    };
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
        operador: { apellidosNombres: string; telefono: string | null };
        asistente: { apellidosNombres: string; telefono: string | null } | null;
      }
    | undefined,
): PersonaJornada[] {
  if (pareja) {
    const personas: PersonaJornada[] = [
      { nombre: pareja.operador.apellidosNombres, telefono: pareja.operador.telefono, rol: 'Op.' },
    ];
    if (pareja.asistente) {
      personas.push({ nombre: pareja.asistente.apellidosNombres, telefono: pareja.asistente.telefono, rol: 'Asis.' });
    }
    return personas;
  }
  if (!kit.operador) return [];
  return [{ nombre: `${kit.operador.apellidos} ${kit.operador.nombres}`, telefono: kit.operador.telefono, rol: 'Op.' }];
}
