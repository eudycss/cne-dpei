import { escapeHtml } from '../../auth/notifier';
import { hora, lineaPersonas, llegadaDpeiDe, type Jornada, type MomentoJornada, type RegistroJornada, type UnidadJornada } from './jornada';

/**
 * Avisos con sonido del grupo Jornada (lógica pura, sin base ni Telegram):
 * retraso de ida o de vuelta según el tiempo de viaje del recinto (y luego
 * "✅ llegó"), sin GPS en el camino y las alertas del sistema reenviadas una
 * vez. Cada aviso tiene una clave: el servicio guarda las enviadas y no repite.
 * Además, cada llegada a la Delegación con el conteo de recintos CDA que faltan.
 */

/**
 * Llegadas a la DPEI marcadas con señal: solo se anuncian las de esta ventana
 * (al desplegar no llueven las viejas). Las marcadas sin señal o con retraso
 * avisado se anuncian siempre: llegan tarde al servidor y el grupo las espera.
 */
export const VENTANA_LLEGADA_DPEI_MIN = 120;

/** Sin GPS en el camino desde hace al menos esto: se avisa (una vez por tramo). */
export const SIN_GPS_MIN = 20;

/** Alertas del sistema que se reenvían al grupo, una sola vez cada una. */
export const ALERTAS_REENVIADAS = [
  'KIT_NO_CORRESPONDE',
  'LLEGADA_RECINTO_FUERA_DE_RANGO',
  'LLEGADA_DPI_FUERA_DE_RANGO',
  'ENTREGA_MILITAR_NO_REGISTRADA',
  'NO_LLEGO_RECINTO',
  'NO_LLEGO_DPI',
  'SIN_SINCRONIZAR',
] as const;
export type TipoAlertaReenviada = (typeof ALERTAS_REENVIADAS)[number];

const NOMBRE_ALERTA: Record<TipoAlertaReenviada, string> = {
  KIT_NO_CORRESPONDE: 'Kit que no corresponde',
  LLEGADA_RECINTO_FUERA_DE_RANGO: 'Llegada al recinto fuera del lugar',
  LLEGADA_DPI_FUERA_DE_RANGO: 'Llegada al DPEI fuera del lugar',
  ENTREGA_MILITAR_NO_REGISTRADA: 'Entrega del militar no registrada',
  NO_LLEGO_RECINTO: 'No llegó al recinto',
  NO_LLEGO_DPI: 'No llegó al DPEI',
  SIN_SINCRONIZAR: 'Sin sincronizar',
};

export interface AlertaParaAviso {
  id: string;
  tipo: TipoAlertaReenviada;
  mensaje: string;
  generadaEn: Date;
  operadorId: string | null;
}

export interface AvisoJornada {
  clave: string;
  texto: string;
}

interface Tramo {
  id: 'IDA' | 'VUELTA';
  sale: MomentoJornada;
  llega: MomentoJornada;
  /** "al recinto" / "al DPEI". */
  destino: string;
  /** "del DPEI" / "del recinto". */
  origen: string;
}

const TRAMOS: Tramo[] = [
  { id: 'IDA', sale: 'SALIDA_DPI', llega: 'LLEGADA_RECINTO', destino: 'al recinto', origen: 'del DPEI' },
  { id: 'VUELTA', sale: 'SALIDA_RECINTO', llega: 'LLEGADA_DPI', destino: 'al DPEI', origen: 'del recinto' },
];

const MINUTO = 60_000;
const minutosEntre = (desde: Date, hasta: Date) => Math.floor((hasta.getTime() - desde.getTime()) / MINUTO);

function cabecera(u: UnidadJornada): string {
  return `<b>${escapeHtml(u.codigoRecinto)} · ${escapeHtml(u.nombreRecinto)}</b> · ${escapeHtml(u.tecnico.nombre)}`;
}

/** Retraso, "llegó" y sin GPS de un tramo de una unidad. */
function avisosDeTramo(u: UnidadJornada, t: Tramo, ahora: Date, enviados: ReadonlySet<string>): AvisoJornada[] {
  const salida = u.registros[t.sale];
  if (!salida) return [];
  // De vuelta, el kit entregado en la DPEI también es llegada: sin retraso ni "sin GPS" después.
  const llegada = t.id === 'VUELTA' ? (llegadaDpeiDe(u)?.registro ?? undefined) : u.registros[t.llega];
  const avisos: AvisoJornada[] = [];
  const claveRetraso = `RETRASO_${t.id}:${u.operadorId}`;

  if (u.tiempoViajeMin !== null) {
    const limite = new Date(salida.en.getTime() + u.tiempoViajeMin * MINUTO);
    if (!llegada && minutosEntre(limite, ahora) >= 1 && !enviados.has(claveRetraso)) {
      avisos.push({
        clave: claveRetraso,
        texto:
          `⏰ <b>Retraso ${t.destino}</b> · +${minutosEntre(limite, ahora)} min\n${cabecera(u)}\n` +
          `   Salió ${t.origen} ${hora(salida.en)} · debía llegar ${hora(limite)} (${u.tiempoViajeMin} min)\n` +
          lineaPersonas(u.personas),
      });
    }
    // "Llegó" solo cerrando un retraso avisado. La vuelta no: su llegada ya se
    // anuncia siempre (avisosLlegadaDpei), con los minutos tarde.
    const claveLlego = `LLEGO_${t.id}:${u.operadorId}`;
    if (t.id === 'IDA' && llegada && enviados.has(claveRetraso) && !enviados.has(claveLlego)) {
      const tarde = minutosEntre(limite, llegada.en);
      avisos.push({
        clave: claveLlego,
        texto:
          `✅ <b>Llegó ${t.destino}</b> ${hora(llegada.en)}${tarde > 0 ? ` · +${tarde} min` : ''}\n${cabecera(u)}` +
          (llegada.sinSenal ? '\n   📴 marcado sin señal' : ''),
      });
    }
  }

  // Sin GPS en el camino: desde el último GPS (o desde que salió, si fue antes de salir).
  const claveGps = `SIN_GPS_${t.id}:${u.operadorId}`;
  if (!llegada && !enviados.has(claveGps)) {
    const referencia = u.ultimoGps && u.ultimoGps > salida.en ? u.ultimoGps : salida.en;
    if (minutosEntre(referencia, ahora) >= SIN_GPS_MIN) {
      const desde = u.ultimoGps
        ? `último GPS ${hora(u.ultimoGps)} (hace ${minutosEntre(u.ultimoGps, ahora)} min)`
        : `sin GPS desde que salió ${hora(salida.en)} (hace ${minutosEntre(salida.en, ahora)} min)`;
      avisos.push({
        clave: claveGps,
        texto: `📡 <b>Sin GPS</b> camino ${t.destino} · ${desde}\n${cabecera(u)}\n${lineaPersonas(u.personas)}`,
      });
    }
  }
  return avisos;
}

function avisoAlerta(a: AlertaParaAviso, u: UnidadJornada | undefined): AvisoJornada {
  return {
    clave: `ALERTA:${a.id}`,
    texto:
      `🚨 <b>${NOMBRE_ALERTA[a.tipo]}</b> · ${hora(a.generadaEn)}\n` +
      (u ? `${cabecera(u)}\n` : '') +
      `   ${escapeHtml(a.mensaje)}` +
      (u ? `\n${lineaPersonas(u.personas)}` : ''),
  };
}

const NOTA_KIT = '\n   📦 Kit entregado al Asistente Transversal · falta marcar la llegada en la app';

/**
 * Cada pareja que llega a la Delegación, con el conteo de recintos CDA: un
 * recinto con varias parejas cuenta cuando llegaron todas. El conteo es el del
 * momento del aviso (registros sin señal que sincronizan tarde no lo atrasan).
 * Cuando llega el último recinto, un cierre "llegaron todos" (una vez).
 * Que el Asistente Transversal reciba el kit cuenta como llegada aunque el
 * operador no la haya marcado en la app (el kit no llega solo a la DPEI).
 */
function avisosLlegadaDpei(j: Jornada, ahora: Date, enviados: ReadonlySet<string>): AvisoJornada[] {
  const porRecinto = new Map<string, UnidadJornada[]>();
  for (const u of j.unidades) porRecinto.set(u.codigoRecinto, [...(porRecinto.get(u.codigoRecinto) ?? []), u]);
  const total = porRecinto.size;
  // Hora en que llegó la última pareja de cada recinto (null = aún falta alguna).
  const completoEn = [...porRecinto.values()].map((us) => {
    const horas = us.map((u) => llegadaDpeiDe(u)?.registro.en.getTime());
    return horas.every((h) => h !== undefined) ? new Date(Math.max(...(horas as number[]))) : null;
  });
  // Conteo con el estado actual: un registro que sincroniza tarde no repite ni baja un "faltan" ya dicho.
  const llegaron = completoEn.filter(Boolean).length;
  const desde = ahora.getTime() - VENTANA_LLEGADA_DPEI_MIN * MINUTO;
  const enVentana = (u: UnidadJornada, llegada: RegistroJornada) =>
    llegada.en.getTime() >= desde || llegada.sinSenal || enviados.has(`RETRASO_VUELTA:${u.operadorId}`);

  const avisos = j.unidades
    .filter((u) => {
      const llegada = llegadaDpeiDe(u)?.registro;
      return llegada && enVentana(u, llegada) && !enviados.has(`LLEGADA_DPEI:${u.operadorId}`);
    })
    .sort((a, b) => llegadaDpeiDe(a)!.registro.en.getTime() - llegadaDpeiDe(b)!.registro.en.getTime())
    .map((u): AvisoJornada => {
      const { registro: llegada, porKit } = llegadaDpeiDe(u)!;
      const salida = u.registros.SALIDA_RECINTO;
      // Con la hora del kit no se calcula retraso: el kit se recibe después de llegar.
      const tarde =
        !porKit && salida && u.tiempoViajeMin !== null ? minutosEntre(new Date(salida.en.getTime() + u.tiempoViajeMin * MINUTO), llegada.en) : 0;
      return {
        clave: `LLEGADA_DPEI:${u.operadorId}`,
        texto:
          `🏁 <b>Llegó a la Delegación</b> · ${hora(llegada.en)}${tarde > 0 ? ` · +${tarde} min` : ''}\n${cabecera(u)}\n` +
          lineaPersonas(u.personas) +
          (llegada.sinSenal ? '\n   📴 marcado sin señal' : '') +
          (porKit ? NOTA_KIT : '') +
          `\nRecintos CDA: llegaron <b>${llegaron} de ${total}</b>` +
          (llegaron < total ? ` · faltan ${total - llegaron}` : ''),
      };
    });

  const claveTodos = `LLEGARON_TODOS_DPEI:${j.eventoId}`;
  // El cierre acompaña a una llegada (de esta vuelta o reciente), nunca horas después de un despliegue.
  const ultimoCompleto = Math.max(0, ...completoEn.map((c) => c?.getTime() ?? 0));
  const reciente = avisos.length > 0 || ultimoCompleto >= desde;
  if (total > 0 && completoEn.every(Boolean) && reciente && !enviados.has(claveTodos)) {
    avisos.push({ clave: claveTodos, texto: `🎉 <b>Llegaron los ${total} recintos CDA a la Delegación</b>` });
  }
  return avisos;
}

/** Los avisos que todavía no se mandaron: primero las alertas del sistema (por hora), luego las llegadas a la DPEI y al final retrasos y GPS. */
export function avisosJornada(
  j: Jornada,
  ahora: Date,
  enviados: ReadonlySet<string>,
  alertas: AlertaParaAviso[] = [],
): AvisoJornada[] {
  const deTramos = j.unidades.flatMap((u) => TRAMOS.flatMap((t) => avisosDeTramo(u, t, ahora, enviados)));
  const porOperador = new Map(j.unidades.map((u) => [u.operadorId, u]));
  const deAlertas = [...alertas]
    .sort((a, b) => a.generadaEn.getTime() - b.generadaEn.getTime())
    .filter((a) => !enviados.has(`ALERTA:${a.id}`))
    .map((a) => avisoAlerta(a, a.operadorId ? porOperador.get(a.operadorId) : undefined));
  // Las llegadas van antes que retrasos y GPS: con muchos avisos en cola no se postergan.
  return [...deAlertas, ...avisosLlegadaDpei(j, ahora, enviados), ...deTramos];
}

/**
 * Junta avisos en mensajes de Telegram (límite 4096; se deja margen). Un aviso
 * nunca se corta: partir el HTML a la mitad haría que Telegram lo rechace.
 */
export function mensajesDeAvisos(avisos: AvisoJornada[], max = 3500): { claves: string[]; texto: string }[] {
  const mensajes: { claves: string[]; texto: string }[] = [];
  for (const a of avisos) {
    const ultimo = mensajes[mensajes.length - 1];
    if (ultimo && ultimo.texto.length + 2 + a.texto.length <= max) {
      ultimo.texto += `\n\n${a.texto}`;
      ultimo.claves.push(a.clave);
    } else {
      mensajes.push({ claves: [a.clave], texto: a.texto });
    }
  }
  return mensajes;
}
