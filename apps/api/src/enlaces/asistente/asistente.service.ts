import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { escapeHtml, type EnlaceCaido } from '../../auth/notifier';
import { DistributivoTecnicosClient, type AsignacionTecnico } from '../distributivo-tecnicos.client';
import { EncargadosRecintosClient, type EncargadoRecinto } from '../encargados-recintos.client';
import {
  abreviarCanton,
  PREFIJO_CALLBACK_RECINTO,
  TelegramNotifier,
  type GrupoAsignacion,
} from '../telegram-notifier';
import { buscarRecintos, normalizarTexto, palabrasClave } from './buscar-recintos';
import { validarConsulta, type Consulta } from './herramientas';
import { AsistenteNoDisponible, LlmClient } from './llm.client';

/** Preguntas más largas no son una consulta al bot; además acota lo que se manda al modelo. */
export const MAX_LARGO_PREGUNTA = 300;
/** Por persona: cuida la cuota gratuita de Groq/Gemini. */
const MAX_PREGUNTAS_POR_PERSONA = 10;
/** Entre todos (por si alguien con el secreto del webhook simula muchas personas). */
const MAX_PREGUNTAS_TOTAL = 60;
const VENTANA_MS = 10 * 60 * 1000;
/** Con más resultados se pide más detalle en vez de llenar el chat de botones. */
const MAX_BOTONES = 5;
const MAX_LISTA = 10;

export const AYUDA_ASISTENTE =
  'Solo puedo ayudar con recintos, encargados, enlaces caídos y técnicos asignados. Por ejemplo:\n' +
  '• "número del encargado del colegio Ibarra"\n' +
  '• "¿qué está caído en Cotacachi?"\n' +
  '• "¿qué recintos tiene Juan Pérez?"\n' +
  '• "¿qué técnico está en Cotacachi?"\n' +
  '• "¿cómo está el 1008?"';

type Enlace = { codigoRecinto: string; nombreRecinto: string; canton: string | null; estado: 'ACTIVO' | 'FALLO' };

/**
 * Chat del bot: el modelo (Groq, con Gemini de respaldo) solo elige una consulta
 * de una lista cerrada; la respuesta se arma aquí con los datos de la base y de
 * los Excel de Drive. Así no inventa datos y los teléfonos nunca salen al modelo.
 */
@Injectable()
export class AsistenteService {
  private readonly log = new Logger('AsistenteTelegram');
  /** Momentos de las preguntas recientes por persona ("chatId:userId"). */
  private readonly preguntas = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramNotifier,
    private readonly distributivo: DistributivoTecnicosClient,
    private readonly encargados: EncargadosRecintosClient,
    private readonly llm: LlmClient,
  ) {}

  /** Responde una pregunta en lenguaje natural de esa persona. Nunca lanza. */
  async responder(pregunta: string, clavePersona: string): Promise<void> {
    const limpia = pregunta.trim();
    if (!limpia) {
      await this.telegram.enviarTexto(AYUDA_ASISTENTE, 'la ayuda del asistente');
      return;
    }
    if (limpia.length > MAX_LARGO_PREGUNTA) {
      await this.telegram.enviarTexto(
        `La pregunta es muy larga (máx. ${MAX_LARGO_PREGUNTA} caracteres). Escríbala más corta.`,
        'el aviso de pregunta larga',
      );
      return;
    }
    if (this.superaLimite(clavePersona)) {
      await this.telegram.enviarTexto(
        '⏳ Se hicieron muchas preguntas seguidas. Espere unos minutos e intente de nuevo.',
        'el aviso de límite del asistente',
      );
      return;
    }

    await this.telegram.indicarEscribiendo();
    let consulta: Consulta | null;
    try {
      const llamada = await this.llm.elegirConsulta(limpia);
      consulta = llamada ? validarConsulta(llamada.nombre, llamada.argumentos) : null;
    } catch (e) {
      if (!(e instanceof AsistenteNoDisponible)) this.log.error(`Error del asistente: ${(e as Error)?.message ?? e}`);
      await this.telegram.enviarTexto(
        '⚠️ El asistente no está disponible en este momento. Use los botones de abajo.',
        'el aviso de asistente no disponible',
      );
      return;
    }
    if (!consulta) {
      await this.telegram.enviarTexto(AYUDA_ASISTENTE, 'la ayuda del asistente');
      return;
    }

    try {
      await this.ejecutar(consulta);
    } catch (e) {
      this.log.error(`No se pudo ejecutar la consulta ${consulta.tipo}: ${(e as Error)?.message ?? e}`);
      await this.telegram.enviarTexto(
        '⚠️ No se pudo consultar en este momento. Intente de nuevo en unos minutos.',
        'el aviso de error del asistente',
      );
    }
  }

  /** Botón de un recinto elegido entre varios resultados. Nunca lanza. */
  async responderRecintoElegido(codigo: string): Promise<void> {
    try {
      const enlace = await this.prisma.enlaceRecinto.findUnique({
        where: { codigoRecinto: codigo },
        select: { codigoRecinto: true, nombreRecinto: true, canton: true, estado: true },
      });
      if (!enlace) {
        await this.telegram.enviarTexto(`⚠️ El recinto ${codigo} ya no está en la lista.`, 'el recinto elegido (no existe)');
        return;
      }
      const [asignaciones, encargados] = await Promise.all([this.asignaciones(), this.mapaEncargados()]);
      await this.enviarFicha(enlace as Enlace, asignaciones, encargados);
    } catch (e) {
      this.log.error(`No se pudo mostrar el recinto elegido: ${(e as Error)?.message ?? e}`);
      await this.telegram.enviarTexto(
        '⚠️ No se pudo consultar en este momento. Intente de nuevo en unos minutos.',
        'el aviso de error del asistente',
      );
    }
  }

  private async ejecutar(consulta: Consulta): Promise<void> {
    switch (consulta.tipo) {
      case 'buscar_recinto':
        return this.buscarRecinto(consulta.texto);
      case 'recintos_caidos':
        return this.recintosCaidos(consulta.canton);
      case 'recintos_de_tecnico':
        return this.recintosDeTecnico(consulta.nombre);
      case 'tecnicos_de_canton':
        return this.tecnicosDeCanton(consulta.canton);
    }
  }

  private async buscarRecinto(texto: string): Promise<void> {
    const [enlaces, asignaciones] = await Promise.all([this.enlaces(), this.asignaciones()]);
    const parroquias = new Map<string, string>(asignaciones.map((a) => [a.codigoRecinto, a.parroquia]));
    const encontrados = buscarRecintos(
      texto,
      enlaces.map((e) => ({ ...e, parroquia: parroquias.get(e.codigoRecinto) ?? '' })),
    );
    const buscado = escapeHtml(texto);

    if (encontrados.length === 0) {
      await this.telegram.enviarHtml(
        `🔍 No encontré recintos para "${buscado}". Pruebe con otra parte del nombre o con el código.`,
        'el resultado del asistente (sin recintos)',
      );
      return;
    }
    if (encontrados.length === 1) {
      await this.enviarFicha(encontrados[0], asignaciones, await this.mapaEncargados());
      return;
    }
    if (encontrados.length <= MAX_BOTONES) {
      await this.telegram.enviarHtml(
        `🔍 Encontré ${encontrados.length} recintos para "${buscado}". ¿Cuál?`,
        'la lista de recintos para elegir',
        {
          inline_keyboard: encontrados.map((e) => [
            {
              text: `${e.codigoRecinto} · ${e.nombreRecinto}`.slice(0, 60),
              callback_data: `${PREFIJO_CALLBACK_RECINTO}${e.codigoRecinto}`,
            },
          ]),
        },
      );
      return;
    }
    const lineas = encontrados.slice(0, MAX_LISTA).map((e) => `• ${escapeHtml(e.codigoRecinto)} · ${escapeHtml(e.nombreRecinto)}`);
    const resto = encontrados.length - MAX_LISTA;
    await this.telegram.enviarHtml(
      `🔍 Encontré ${encontrados.length} recintos para "${buscado}":\n${lineas.join('\n')}` +
        (resto > 0 ? `\n… y ${resto} más` : '') +
        '\n\nPregunte con más detalle (p. ej. agregue la parroquia) o use el código.',
      'la lista larga de recintos',
    );
  }

  private async enviarFicha(
    enlace: Enlace,
    asignaciones: AsignacionTecnico[],
    encargados: Map<string, EncargadoRecinto> | null,
  ): Promise<void> {
    const asignacion = asignaciones.find((a) => a.codigoRecinto === enlace.codigoRecinto);
    const sector = [abreviarCanton(enlace.canton), asignacion?.parroquia].filter(Boolean).map((v) => escapeHtml(v!)).join(' · ');
    const encargado = encargados?.get(enlace.codigoRecinto);
    const textoEncargado = encargados
      ? encargado
        ? [encargado.nombre, encargado.telefono].filter(Boolean).map(escapeHtml).join(' · ') || 'sin registrar'
        : 'sin registrar'
      : 'no se pudo consultar ahora';
    const lineas = [
      `📍 <b>${escapeHtml(enlace.codigoRecinto)} · ${escapeHtml(enlace.nombreRecinto)}</b>${sector ? ` (${sector})` : ''}`,
      `Enlace: ${enlace.estado === 'FALLO' ? '🔴 caído' : '✅ activo'}`,
      `📞 Encargado: ${textoEncargado}`,
      `👷 Técnico: ${asignacion ? escapeHtml(asignacion.tecnico) : 'sin técnico asignado'}`,
    ];
    await this.telegram.enviarHtml(lineas.join('\n'), 'la ficha de recinto del asistente');
  }

  private async recintosCaidos(canton: string | null): Promise<void> {
    const enlaces = await this.enlaces();
    const caidos = enlaces.filter((e) => e.estado === 'FALLO');
    const aLista = (lista: Enlace[]): EnlaceCaido[] =>
      lista.map((e) => ({ codigoRecinto: e.codigoRecinto, nombreRecinto: e.nombreRecinto, canton: e.canton }));
    if (!canton) {
      await this.telegram.enviarListaActual(aLista(caidos));
      return;
    }

    // Solo cantones que existen en la lista: con uno inventado o mal escrito,
    // "no hay caídos en X" sería una falsa tranquilidad.
    const elegido = await this.resolverCanton(canton, enlaces, 'Le muestro todos los caídos de la provincia:');
    if (!elegido) {
      await this.telegram.enviarListaActual(aLista(caidos));
      return;
    }
    await this.telegram.enviarListaActual(aLista(caidos.filter((e) => e.canton === elegido)), undefined, elegido);
  }

  private async recintosDeTecnico(nombre: string): Promise<void> {
    const asignaciones = await this.asignaciones();
    if (asignaciones.length === 0) {
      await this.telegram.enviarTexto('El distributivo de técnicos no está disponible ahora.', 'el aviso de distributivo');
      return;
    }
    const palabras = palabrasClave(nombre);
    const tecnicos = new Map<number, string>();
    for (const a of asignaciones) {
      const del = normalizarTexto(a.tecnico).split(' ');
      if (palabras.length > 0 && palabras.every((p) => del.some((d) => d.startsWith(p)))) tecnicos.set(a.numeroTecnico, a.tecnico);
    }
    if (tecnicos.size === 0) {
      await this.telegram.enviarHtml(
        `🔍 No encontré a ningún técnico "${escapeHtml(nombre)}" en el distributivo.`,
        'el resultado del asistente (sin técnico)',
      );
      return;
    }
    if (tecnicos.size > 1) {
      const nombres = [...tecnicos.values()].map((t) => `• ${escapeHtml(t)}`).join('\n');
      await this.telegram.enviarHtml(
        `🔍 Hay varios técnicos con ese nombre:\n${nombres}\n\nPregunte con el nombre completo.`,
        'la lista de técnicos para elegir',
      );
      return;
    }

    const [numeroTecnico, tecnico] = [...tecnicos.entries()][0];
    const enlaces = new Map<string, Enlace>((await this.enlaces()).map((e) => [e.codigoRecinto, e]));
    const grupo: GrupoAsignacion = {
      numeroTecnico,
      tecnico,
      recintos: asignaciones
        .filter((a) => a.numeroTecnico === numeroTecnico)
        .map((a) => {
          const enlace = enlaces.get(a.codigoRecinto);
          return {
            codigoRecinto: a.codigoRecinto,
            nombreRecinto: enlace?.nombreRecinto ?? (a.localidad || 'Sin enlace monitoreado'),
            canton: enlace?.canton ?? null,
            estado: enlace?.estado ?? null,
          };
        }),
    };
    await this.telegram.enviarAsignaciones([grupo]);
  }

  private async tecnicosDeCanton(canton: string): Promise<void> {
    const [enlaces, asignaciones] = await Promise.all([this.enlaces(), this.asignaciones()]);
    if (asignaciones.length === 0) {
      await this.telegram.enviarTexto('El distributivo de técnicos no está disponible ahora.', 'el aviso de distributivo');
      return;
    }
    const elegido = await this.resolverCanton(canton, enlaces);
    if (!elegido) return;

    // El distributivo no trae el cantón: sale del enlace monitoreado de cada recinto.
    const delCanton = new Set(enlaces.filter((e) => e.canton === elegido).map((e) => e.codigoRecinto));
    // numeroTecnico sale del nombre (uno por técnico en el archivo); el Set evita
    // contar dos veces un recinto repetido en el Excel.
    const tecnicos = new Map<number, { tecnico: string; recintos: Set<string> }>();
    for (const a of asignaciones) {
      if (!delCanton.has(a.codigoRecinto)) continue;
      const t = tecnicos.get(a.numeroTecnico) ?? { tecnico: a.tecnico, recintos: new Set<string>() };
      t.recintos.add(a.codigoRecinto);
      tecnicos.set(a.numeroTecnico, t);
    }
    if (tecnicos.size === 0) {
      await this.telegram.enviarHtml(
        `👷 No hay técnicos asignados a recintos de ${escapeHtml(elegido)} en el distributivo.`,
        'el resultado del asistente (cantón sin técnicos)',
      );
      return;
    }
    const lineas = [...tecnicos.values()]
      .map((t) => ({ tecnico: t.tecnico, recintos: t.recintos.size }))
      .sort((a, b) => b.recintos - a.recintos || a.tecnico.localeCompare(b.tecnico))
      .map((t) => `• ${escapeHtml(t.tecnico)}: ${t.recintos} ${t.recintos === 1 ? 'recinto' : 'recintos'}`);
    await this.telegram.enviarHtml(
      `👷 <b>Técnicos en ${escapeHtml(elegido)}</b>\n${lineas.join('\n')}\n\n` +
        'Para ver los recintos de uno, pregunte: "recintos de" y su nombre.',
      'los técnicos del cantón',
    );
  }

  /**
   * El cantón tal como está en la lista de enlaces, o null tras avisar que no se
   * reconoce (con `siguiente`, lo que se hará en su lugar).
   */
  private async resolverCanton(canton: string, enlaces: Enlace[], siguiente?: string): Promise<string | null> {
    const clave = normalizarTexto(canton);
    const cantones = [...new Set(enlaces.map((e) => e.canton).filter((c): c is string => !!c))];
    // Por parte del nombre solo si apunta a un único cantón ("o" no debe elegir Otavalo).
    const parecidos = cantones.filter((c) => normalizarTexto(c).includes(clave));
    const elegido = cantones.find((c) => normalizarTexto(c) === clave) ?? (parecidos.length === 1 ? parecidos[0] : undefined);
    if (clave && elegido) return elegido;
    await this.telegram.enviarHtml(
      `No reconozco el cantón "${escapeHtml(canton)}". Cantones con recintos: ${cantones.map(escapeHtml).join(', ')}.` +
        (siguiente ? `\n${siguiente}` : ''),
      'el aviso de cantón desconocido',
    );
    return null;
  }

  private async enlaces(): Promise<Enlace[]> {
    return (await this.prisma.enlaceRecinto.findMany({
      select: { codigoRecinto: true, nombreRecinto: true, canton: true, estado: true },
      orderBy: { codigoRecinto: 'asc' },
    })) as Enlace[];
  }

  /** [] si el distributivo no está configurado o no se pudo leer: la ficha sale sin técnico. */
  private async asignaciones(): Promise<AsignacionTecnico[]> {
    try {
      return await this.distributivo.asignaciones();
    } catch (e) {
      this.log.warn(`Distributivo no disponible para el asistente: ${(e as Error)?.message ?? e}`);
      return [];
    }
  }

  /** null si el archivo de encargados no se pudo leer (distinto de "sin registrar"). */
  private async mapaEncargados(): Promise<Map<string, EncargadoRecinto> | null> {
    try {
      return await this.encargados.encargados();
    } catch (e) {
      this.log.warn(`Encargados no disponibles para el asistente: ${(e as Error)?.message ?? e}`);
      return null;
    }
  }

  /** true si esa persona (o el total) ya hizo demasiadas preguntas en la ventana; si no, la cuenta. */
  private superaLimite(clavePersona: string, ahora = Date.now()): boolean {
    let total = 0;
    for (const [clave, momentos] of this.preguntas) {
      const recientes = momentos.filter((t) => ahora - t < VENTANA_MS);
      if (recientes.length === 0) this.preguntas.delete(clave);
      else this.preguntas.set(clave, recientes);
      total += recientes.length;
    }
    const propias = this.preguntas.get(clavePersona) ?? [];
    if (propias.length >= MAX_PREGUNTAS_POR_PERSONA || total >= MAX_PREGUNTAS_TOTAL) return true;
    this.preguntas.set(clavePersona, [...propias, ahora]);
    return false;
  }
}
