import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { escapeHtml } from '../../auth/notifier';
import { DistributivoTecnicosClient, type AsignacionTecnico } from '../distributivo-tecnicos.client';
import { EncargadosRecintosClient, type EncargadoRecinto } from '../encargados-recintos.client';
import { EnlacesEstadisticasService } from '../enlaces-estadisticas.service';
import { abreviarCanton, formatearDuracion, PREFIJO_CALLBACK_RECINTO, TelegramNotifier } from '../telegram-notifier';
import { buscarRecintosDetalle, normalizarTexto } from './buscar-recintos';
import { responderConsulta, textoEncargado, type FilaRecinto } from './consulta-recintos';
import { validarConsulta, type Consulta, type FiltrosRecintos } from './herramientas';
import { asistenteSqlHabilitado, AsistenteNoDisponible, LlmClient, type ModoConsultas } from './llm.client';
import { formatearResultadoSql } from './respuesta-sql';
import { ejecutarSql, horaEcuadorSql, type DatosSql, type FilaCaidaSql, type FilaSql } from './sql/motor-sql';
import { ErrorSql } from './sql/validar-sql';
import { codigosExcluidos } from '../codigos-excluidos';

/** Preguntas más largas no son una consulta al bot; además acota lo que se manda al modelo. */
export const MAX_LARGO_PREGUNTA = 300;
/** Por persona: cuida la cuota gratuita de Groq/Gemini. */
const MAX_PREGUNTAS_POR_PERSONA = 10;
/** Entre todos (por si alguien con el secreto del webhook simula muchas personas). */
const MAX_PREGUNTAS_TOTAL = 60;
const VENTANA_MS = 10 * 60 * 1000;
/** Telegram corta en 4096; se deja margen para el encabezado y el pie. */
const MAX_LARGO_LISTA = 3500;
/** Con más resultados se pide más detalle en vez de llenar el chat de botones. */
const MAX_BOTONES = 5;
const MAX_LISTA = 15;
/** Historial de caídas que ve el modo SQL: lo reciente basta para "esta semana" o "este mes". */
const DIAS_HISTORIAL_SQL = 31;
const MAX_CAIDAS_SQL = 5_000;
const MS_MINUTO = 60_000;

type Caida = { codigoRecinto: string; inicio: Date; fin: Date | null };

/**
 * Desde cuándo está caído cada recinto. Si por un error quedaron dos caídas abiertas
 * del mismo recinto, vale la más antigua: es el tiempo que realmente lleva caído.
 * `caidas` debe venir de la más antigua a la más reciente.
 */
function inicioCaidaAbierta(caidas: Caida[]): Map<string, Date> {
  const abiertas = new Map<string, Date>();
  for (const c of caidas) if (!c.fin && !abiertas.has(c.codigoRecinto)) abiertas.set(c.codigoRecinto, c.inicio);
  return abiertas;
}

/** "🔴 caído hace 2 h 15 min" si se sabe desde cuándo; "🔴 caído" si no. */
function textoCaido(desde: Date | undefined, ahora = Date.now()): string {
  return desde ? `🔴 caído hace ${formatearDuracion((ahora - desde.getTime()) / MS_MINUTO)}` : '🔴 caído';
}
/** Códigos que se muestran por técnico cuando la pregunta es "quién es el técnico de…". */
const MAX_CODIGOS_POR_TECNICO = 20;

/** "quién es el técnico de Ilumán", "técnicos de…": piden compañeros, no rectores ni conserjes. */
export function preguntaPorTecnico(pregunta: string): boolean {
  return normalizarTexto(pregunta).split(' ').some((p) => /^tecnic[oa]s?$/.test(p));
}

export const AYUDA_ASISTENTE =
  'Puedo responder sobre recintos, encargados, técnicos, enlaces caídos y estadísticas. Por ejemplo:\n' +
  '• "número del encargado del colegio Ibarra" o "contacto de Ilumán"\n' +
  '• "recintos de Pimampiro y Urcuquí"\n' +
  '• "¿qué técnicos tienen recintos caídos?"\n' +
  '• "¿qué recintos no tienen técnico?" o "…no tienen contacto?"\n' +
  '• "¿cuántos caídos hay en Ibarra?"\n' +
  '• "estadísticas de la semana"';

type ConsultaDatos = Extract<Consulta, { tipo: 'consultar_datos' }>;

/** Lo que se lleva por pregunta: a lo más 1 corrección de SQL, 1 respaldo y 1 aviso. */
interface EstadoPregunta {
  correccionUsada: boolean;
  sqlFallido: boolean;
  avisoDistributivo: boolean;
}

type Enlace = { codigoRecinto: string; nombreRecinto: string; canton: string | null; estado: 'ACTIVO' | 'FALLO' };

/**
 * Chat del bot: el modelo (Groq, con Gemini de respaldo) solo traduce la pregunta
 * a consultas de una lista cerrada (con filtros combinables); la respuesta se arma
 * aquí con los datos de la base y de los Excel de Drive. Así no inventa datos y
 * los teléfonos nunca salen al modelo.
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
    private readonly estadisticas: EnlacesEstadisticasService,
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
    await this.resolver(limpia, asistenteSqlHabilitado() ? 'sql' : 'filtros');
  }

  /** Pide las consultas al modelo en ese modo y las ejecuta. Nunca lanza. */
  private async resolver(limpia: string, modo: ModoConsultas): Promise<void> {
    let consultas: Consulta[];
    try {
      consultas = await this.elegirConsultas(limpia, modo);
    } catch (e) {
      if (!(e instanceof AsistenteNoDisponible)) this.log.error(`Error del asistente: ${(e as Error)?.message ?? e}`);
      await this.telegram.enviarTexto(
        '⚠️ El asistente no está disponible en este momento. Use los botones de abajo.',
        'el aviso de asistente no disponible',
      );
      return;
    }
    if (consultas.length === 0) {
      await this.telegram.enviarTexto(AYUDA_ASISTENTE, 'la ayuda del asistente');
      return;
    }

    // Una pregunta puede pedir varias cosas ("recintos de Pimampiro y estadísticas de hoy").
    const pideTecnico = preguntaPorTecnico(limpia);
    const estado: EstadoPregunta = { correccionUsada: false, sqlFallido: false, avisoDistributivo: false };
    for (const consulta of consultas) {
      try {
        await this.ejecutar(consulta, pideTecnico, limpia, estado);
      } catch (e) {
        this.log.error(`No se pudo ejecutar la consulta ${consulta.tipo}: ${(e as Error)?.message ?? e}`);
        await this.telegram.enviarTexto(
          '⚠️ No se pudo consultar en este momento. Intente de nuevo en unos minutos.',
          'el aviso de error del asistente',
        );
      }
    }
    // Una sola vez por pregunta, aunque hayan fallado varias consultas SQL.
    if (estado.sqlFallido) await this.respaldoFiltros(limpia);
  }

  /**
   * El SQL no funcionó: se pregunta de nuevo en el modo de filtros, pero solo se
   * ejecutan sus listas (consultar_recintos). Lo demás (fichas, estadísticas) ya
   * se respondió en el primer intento y no debe salir repetido.
   */
  private async respaldoFiltros(limpia: string): Promise<void> {
    let consultas: Consulta[] = [];
    try {
      consultas = (await this.elegirConsultas(limpia, 'filtros')).filter((c) => c.tipo === 'consultar_recintos');
    } catch (e) {
      if (!(e instanceof AsistenteNoDisponible)) this.log.error(`Error del asistente: ${(e as Error)?.message ?? e}`);
    }
    if (consultas.length === 0) {
      await this.telegram.enviarTexto(
        'No pude responder esa pregunta. Pruebe con otras palabras o use los botones de abajo.',
        'el aviso de pregunta sin respuesta',
      );
      return;
    }
    for (const consulta of consultas) {
      try {
        await this.consultarRecintos(consulta as FiltrosRecintos);
      } catch (e) {
        this.log.error(`No se pudo ejecutar el respaldo del asistente: ${(e as Error)?.message ?? e}`);
        await this.telegram.enviarTexto(
          '⚠️ No se pudo consultar en este momento. Intente de nuevo en unos minutos.',
          'el aviso de error del asistente',
        );
      }
    }
  }

  /** Consultas válidas y sin repetir que eligió el modelo (el modo filtros nunca ejecuta SQL). */
  private async elegirConsultas(pregunta: string, modo: ModoConsultas): Promise<Consulta[]> {
    const llamadas = await this.llm.elegirConsultas(pregunta, modo);
    // Sin repetidas: el modelo a veces pide lo mismo dos veces.
    const vistas = new Set<string>();
    return llamadas
      .map((l) => validarConsulta(l.nombre, l.argumentos))
      .filter((c): c is Consulta => c !== null && (modo === 'sql' || c.tipo !== 'consultar_datos'))
      .filter((c) => {
        const clave = JSON.stringify(c);
        if (vistas.has(clave)) return false;
        vistas.add(clave);
        return true;
      });
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
      const [asignaciones, encargados, abiertas] = await Promise.all([
        this.asignaciones(),
        this.mapaEncargados(),
        this.caidasAbiertas(),
      ]);
      await this.enviarFicha(enlace as Enlace, asignaciones ?? [], encargados, abiertas);
    } catch (e) {
      this.log.error(`No se pudo mostrar el recinto elegido: ${(e as Error)?.message ?? e}`);
      await this.telegram.enviarTexto(
        '⚠️ No se pudo consultar en este momento. Intente de nuevo en unos minutos.',
        'el aviso de error del asistente',
      );
    }
  }

  private async ejecutar(consulta: Consulta, pideTecnico: boolean, pregunta: string, estado: EstadoPregunta): Promise<void> {
    switch (consulta.tipo) {
      case 'buscar_recinto':
        return this.buscarRecinto(consulta.texto, pideTecnico);
      case 'consultar_recintos':
        return this.consultarRecintos(consulta);
      case 'consultar_datos':
        return this.consultarDatos(consulta, pregunta, estado);
      case 'estadisticas':
        return this.estadisticas.enviarEstadisticasTelegram(new Date(), consulta.periodo);
    }
  }

  /** Lista o cuenta recintos con los filtros que eligió el modelo. */
  private async consultarRecintos(filtros: FiltrosRecintos): Promise<void> {
    const [enlaces, asignaciones, encargados] = await Promise.all([this.enlaces(), this.asignaciones(), this.mapaEncargados()]);
    const porCodigo = new Map<string, AsignacionTecnico>((asignaciones ?? []).map((a) => [a.codigoRecinto, a]));
    const filas: FilaRecinto[] = enlaces.map((e) => {
      const a = porCodigo.get(e.codigoRecinto);
      return {
        ...e,
        parroquia: a?.parroquia ?? '',
        tecnico: a?.tecnico ?? null,
        numeroTecnico: a?.numeroTecnico ?? null,
        encargado: encargados?.get(e.codigoRecinto) ?? null,
      };
    });
    const mensajes = responderConsulta(filtros, filas, {
      distributivo: asignaciones !== null,
      encargados: encargados !== null,
    });
    for (const mensaje of mensajes) await this.telegram.enviarHtml(mensaje, 'el resultado de la consulta del asistente');
  }

  /**
   * SQL del modelo sobre una copia en memoria de los recintos (sin teléfonos). Si el
   * SQL falla, el modelo lo corrige una vez por pregunta (recibe solo el error, no
   * datos); si vuelve a fallar o el motor no está disponible, se marca para que
   * `resolver` responda una vez con el modo de filtros.
   */
  private async consultarDatos(consulta: ConsultaDatos, pregunta: string, estado: EstadoPregunta): Promise<void> {
    const [enlaces, asignaciones, encargados] = await Promise.all([this.enlaces(), this.asignaciones(), this.mapaEncargados()]);
    if (asignaciones === null && !estado.avisoDistributivo) {
      estado.avisoDistributivo = true;
      await this.telegram.enviarTexto(
        '⚠️ El distributivo de técnicos no está disponible ahora: técnicos y parroquias pueden salir vacíos.',
        'el aviso de distributivo no disponible',
      );
    }
    const porCodigo = new Map<string, AsignacionTecnico>((asignaciones ?? []).map((a) => [a.codigoRecinto, a]));
    const recintos = enlaces.map((e) => {
      const a = porCodigo.get(e.codigoRecinto);
      return {
        codigo: e.codigoRecinto,
        nombre: e.nombreRecinto,
        canton: e.canton,
        parroquia: a?.parroquia || null,
        estado: e.estado === 'FALLO' ? 'caido' : 'activo',
        numero_tecnico: a?.numeroTecnico ?? null,
        tecnico: a?.tecnico ?? null,
        tiene_contacto: encargados === null ? null : encargados.get(e.codigoRecinto)?.telefono?.trim() ? 1 : 0,
      } as const;
    });

    let actual = consulta;
    for (;;) {
      try {
        const resultado = await ejecutarSql(actual.sql, await this.conTiempos(actual.sql, recintos));
        for (const mensaje of formatearResultadoSql(actual.titulo, resultado, actual.conContacto, encargados)) {
          await this.telegram.enviarHtml(mensaje, 'el resultado del SQL del asistente');
        }
        return;
      } catch (e) {
        // Solo el motivo, recortado: ni el SQL ni la pregunta van al log.
        const motivo = (e as Error)?.message ?? String(e);
        if (!(e instanceof ErrorSql)) {
          this.log.error(`Motor SQL no disponible: ${motivo.slice(0, 200)}`);
          break;
        }
        this.log.warn(`SQL del asistente rechazado: ${motivo.slice(0, 200)}`);
        if (estado.correccionUsada) break;
        estado.correccionUsada = true;
        const corregida = await this.corregirSql(pregunta, actual.sql, motivo);
        if (!corregida) break;
        actual = corregida;
      }
    }
    estado.sqlFallido = true;
  }

  /**
   * Agrega los tiempos de caída que use el SQL: el historial (tabla caidas) solo si lo
   * nombra, y minutos_caido solo con las caídas abiertas. Así una pregunta que no habla
   * de tiempos no suma lecturas a la base.
   */
  private async conTiempos(sql: string, recintos: Omit<FilaSql, 'minutos_caido'>[]): Promise<DatosSql> {
    const usaHistorial = /\bcaidas\b/i.test(sql);
    const usaMinutos = usaHistorial || /\bminutos_caido\b/i.test(sql);
    const caidas = usaHistorial ? await this.caidasRecientes() : usaMinutos ? await this.listaCaidasAbiertas() : [];
    const ahora = Date.now();
    const minutos = (desde: Date, hasta: number) => Math.max(0, Math.round((hasta - desde.getTime()) / MS_MINUTO));
    const abiertas = inicioCaidaAbierta(caidas);
    const filasCaidas: FilaCaidaSql[] = caidas
      // Una sola abierta por recinto (la más antigua), para no contar dos veces el mismo tiempo.
      .filter((c) => c.fin || abiertas.get(c.codigoRecinto) === c.inicio)
      .map((c) => ({
        codigo: c.codigoRecinto,
        inicio: horaEcuadorSql(c.inicio),
        fin: c.fin ? horaEcuadorSql(c.fin) : null,
        minutos: minutos(c.inicio, c.fin?.getTime() ?? ahora),
      }));
    return {
      recintos: recintos.map((r) => {
        const desde = r.estado === 'caido' ? abiertas.get(r.codigo) : undefined;
        return { ...r, minutos_caido: desde ? minutos(desde, ahora) : null };
      }),
      caidas: usaHistorial ? filasCaidas : [],
      ahora: horaEcuadorSql(new Date(ahora)),
    };
  }

  /** Le devuelve al modelo su SQL y el error (sin datos) para que lo corrija una vez. */
  private async corregirSql(pregunta: string, sql: string, error: string): Promise<ConsultaDatos | null> {
    const pedido =
      `${pregunta}

Tu consulta anterior para esta pregunta falló.
SQL: ${sql}
Error: ${error}
` +
      'Corrígela y vuelve a llamar a consultar_datos.';
    try {
      const consultas = await this.elegirConsultas(pedido, 'sql');
      return consultas.find((c): c is ConsultaDatos => c.tipo === 'consultar_datos') ?? null;
    } catch {
      return null;
    }
  }

  private async buscarRecinto(texto: string, pideTecnico: boolean): Promise<void> {
    const [enlaces, conTecnicos] = await Promise.all([this.enlaces(), this.asignaciones()]);
    const asignaciones = conTecnicos ?? [];
    const parroquias = new Map<string, string>(asignaciones.map((a) => [a.codigoRecinto, a.parroquia]));
    const { recintos: encontrados, aproximado } = buscarRecintosDetalle(
      texto,
      enlaces.map((e) => ({ ...e, parroquia: parroquias.get(e.codigoRecinto) ?? '' })),
    );
    const buscado = escapeHtml(texto);
    if (aproximado) await this.avisarAproximado(texto);

    if (encontrados.length === 0) {
      await this.telegram.enviarHtml(
        `🔍 No encontré recintos para "${buscado}". Pruebe con otra parte del nombre o con el código.`,
        'el resultado del asistente (sin recintos)',
      );
      return;
    }
    if (encontrados.length === 1) {
      const [encargados, abiertas] = await Promise.all([this.mapaEncargados(), this.caidasAbiertas()]);
      await this.enviarFicha(encontrados[0], asignaciones, encargados, abiertas);
      return;
    }
    if (pideTecnico) {
      await this.enviarTecnicos(buscado, encontrados, conTecnicos);
      return;
    }
    // Varios: cada uno con su encargado, para no tener que preguntar uno por uno.
    // Se corta por cantidad y por largo (nombres largos no deben pasar el límite de Telegram).
    const [encargados, abiertas] = await Promise.all([this.mapaEncargados(), this.caidasAbiertas()]);
    const lineas: string[] = [];
    let largo = 0;
    for (const e of encontrados.slice(0, MAX_LISTA)) {
      const desde = abiertas.get(e.codigoRecinto);
      const caido = e.estado === 'FALLO' ? ` 🔴${desde ? ` hace ${formatearDuracion((Date.now() - desde.getTime()) / MS_MINUTO)}` : ''}` : '';
      const linea =
        `• <b>${escapeHtml(e.codigoRecinto)} · ${escapeHtml(e.nombreRecinto)}</b>` +
        `${caido}\n   📞 ${textoEncargado(e.codigoRecinto, encargados)}`;
      if (lineas.length > 0 && largo + linea.length > MAX_LARGO_LISTA) break;
      lineas.push(linea);
      largo += linea.length + 1;
    }
    const resto = encontrados.length - lineas.length;
    const conBotones = encontrados.length <= MAX_BOTONES;
    await this.telegram.enviarHtml(
      `🔍 Encontré ${encontrados.length} recintos para "${buscado}":\n${lineas.join('\n')}` +
        (resto > 0 ? `\n… y ${resto} más. Pregunte con más detalle o use el código.` : '') +
        (conBotones ? '\n\nToque uno para ver su ficha completa.' : ''),
      'la lista de recintos del asistente',
      conBotones
        ? {
            inline_keyboard: encontrados.map((e) => [
              {
                text: `${e.codigoRecinto} · ${e.nombreRecinto}`.slice(0, 60),
                callback_data: `${PREFIJO_CALLBACK_RECINTO}${e.codigoRecinto}`,
              },
            ]),
          }
        : undefined,
    );
  }

  /** Varios recintos y preguntaron por el técnico: los técnicos con sus códigos, sin contactos. */
  private async enviarTecnicos(buscado: string, recintos: Enlace[], asignaciones: AsignacionTecnico[] | null): Promise<void> {
    if (asignaciones === null) {
      await this.telegram.enviarHtml(
        '⚠️ El distributivo de técnicos no está disponible ahora. Intente de nuevo en unos minutos.',
        'el aviso de distributivo no disponible',
      );
      return;
    }
    const porCodigo = new Map<string, AsignacionTecnico>(asignaciones.map((a) => [a.codigoRecinto, a]));
    const grupos = new Map<string, { numero: number; tecnico: string; codigos: string[] }>();
    const sinTecnico: string[] = [];
    for (const r of recintos) {
      const a = porCodigo.get(r.codigoRecinto);
      if (!a) {
        sinTecnico.push(r.codigoRecinto);
        continue;
      }
      const clave = `${a.numeroTecnico}|${a.tecnico}`;
      const grupo = grupos.get(clave) ?? { numero: a.numeroTecnico, tecnico: a.tecnico, codigos: [] };
      grupo.codigos.push(r.codigoRecinto);
      grupos.set(clave, grupo);
    }
    const codigos = (lista: string[]) =>
      escapeHtml(lista.slice(0, MAX_CODIGOS_POR_TECNICO).join(', ')) +
      (lista.length > MAX_CODIGOS_POR_TECNICO ? ` y ${lista.length - MAX_CODIGOS_POR_TECNICO} más` : '');
    const lineas = [...grupos.values()]
      .sort((a, b) => b.codigos.length - a.codigos.length || a.numero - b.numero)
      .map((g) => `• 👷 <b>${g.numero}. ${escapeHtml(g.tecnico)}</b>: ${g.codigos.length} ${g.codigos.length === 1 ? 'recinto' : 'recintos'} (${codigos(g.codigos)})`);
    if (sinTecnico.length > 0) lineas.push(`• Sin técnico asignado: ${codigos(sinTecnico)}`);
    // Una búsqueda amplia puede traer muchos técnicos: se corta por largo (Telegram corta en 4096).
    const mostradas: string[] = [];
    let largo = 0;
    for (const linea of lineas) {
      if (mostradas.length > 0 && largo + linea.length > MAX_LARGO_LISTA) break;
      mostradas.push(linea);
      largo += linea.length + 1;
    }
    const resto = lineas.length - mostradas.length;
    await this.telegram.enviarHtml(
      `👷 Técnicos de "${buscado}" (${recintos.length} recintos):\n${mostradas.join('\n')}` +
        (resto > 0 ? `\n… y ${resto} más. Pregunte con más detalle.` : ''),
      'los técnicos de los recintos del asistente',
    );
  }

  private async enviarFicha(
    enlace: Enlace,
    asignaciones: AsignacionTecnico[],
    encargados: Map<string, EncargadoRecinto> | null,
    abiertas: Map<string, Date>,
  ): Promise<void> {
    const asignacion = asignaciones.find((a) => a.codigoRecinto === enlace.codigoRecinto);
    const sector = [abreviarCanton(enlace.canton), asignacion?.parroquia].filter(Boolean).map((v) => escapeHtml(v!)).join(' · ');
    const lineas = [
      `📍 <b>${escapeHtml(enlace.codigoRecinto)} · ${escapeHtml(enlace.nombreRecinto)}</b>${sector ? ` (${sector})` : ''}`,
      `Enlace: ${enlace.estado === 'FALLO' ? textoCaido(abiertas.get(enlace.codigoRecinto)) : '✅ activo'}`,
      `📞 Encargado: ${textoEncargado(enlace.codigoRecinto, encargados)}`,
      `👷 Técnico: ${asignacion ? escapeHtml(asignacion.tecnico) : 'sin técnico asignado'}`,
    ];
    await this.telegram.enviarHtml(lineas.join('\n'), 'la ficha de recinto del asistente');
  }

  /** Aviso de que se respondió con lo más parecido, no con lo que se escribió. */
  private async avisarAproximado(buscado: string): Promise<void> {
    await this.telegram.enviarHtml(
      `🔎 No encontré "${escapeHtml(buscado)}" tal cual; le muestro lo más parecido. Revise que sea lo que busca.`,
      'el aviso de coincidencia aproximada',
    );
  }

  private async enlaces(): Promise<Enlace[]> {
    return (await this.prisma.enlaceRecinto.findMany({
      select: { codigoRecinto: true, nombreRecinto: true, canton: true, estado: true },
      orderBy: { codigoRecinto: 'asc' },
    })) as Enlace[];
  }

  /** Caídas de los últimos días y las que siguen abiertas; [] si no se pudieron leer (la respuesta sale sin tiempos). */
  private async caidasRecientes(): Promise<Caida[]> {
    try {
      // Las más recientes primero: si hubiera más del tope, se pierden las viejas, no las de hoy.
      const caidas = await this.prisma.enlaceCaida.findMany({
        where: {
          codigoRecinto: { notIn: codigosExcluidos() },
          OR: [{ fin: null }, { inicio: { gte: new Date(Date.now() - DIAS_HISTORIAL_SQL * 24 * 60 * MS_MINUTO) } }],
        },
        select: { codigoRecinto: true, inicio: true, fin: true },
        orderBy: { inicio: 'desc' },
        take: MAX_CAIDAS_SQL,
      });
      if (caidas.length >= MAX_CAIDAS_SQL) this.log.warn(`Historial de caídas recortado a las ${MAX_CAIDAS_SQL} más recientes`);
      return caidas.reverse();
    } catch (e) {
      this.log.warn(`Historial de caídas no disponible para el asistente: ${(e as Error)?.message ?? e}`);
      return [];
    }
  }

  /** Caídas que siguen abiertas, de la más antigua a la más reciente; [] si no se pudieron leer. */
  private async listaCaidasAbiertas(): Promise<Caida[]> {
    try {
      const abiertas = await this.prisma.enlaceCaida.findMany({
        where: { fin: null, codigoRecinto: { notIn: codigosExcluidos() } },
        select: { codigoRecinto: true, inicio: true },
        orderBy: { inicio: 'asc' },
      });
      return abiertas.map((c) => ({ ...c, fin: null }));
    } catch (e) {
      this.log.warn(`Caídas abiertas no disponibles para el asistente: ${(e as Error)?.message ?? e}`);
      return [];
    }
  }

  /** Desde cuándo está caído cada recinto que sigue caído; vacío si no se pudo leer. */
  private async caidasAbiertas(): Promise<Map<string, Date>> {
    return inicioCaidaAbierta(await this.listaCaidasAbiertas());
  }

  /** null si el distributivo no está configurado o no se pudo leer (distinto de "sin técnicos"). */
  private async asignaciones(): Promise<AsignacionTecnico[] | null> {
    try {
      return await this.distributivo.asignaciones();
    } catch (e) {
      this.log.warn(`Distributivo no disponible para el asistente: ${(e as Error)?.message ?? e}`);
      return null;
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
