import { escapeHtml } from '../../auth/notifier';
import { hora, lineaPersonas, type Jornada, type MomentoJornada, type UnidadJornada } from './jornada';

/**
 * Avisos con sonido del grupo Jornada (lógica pura, sin base ni Telegram):
 * retraso de ida o de vuelta según el tiempo de viaje del recinto (y luego
 * "✅ llegó"), sin GPS en el camino y las alertas del sistema reenviadas una
 * vez. Cada aviso tiene una clave: el servicio guarda las enviadas y no repite.
 */

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
  const llegada = u.registros[t.llega];
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
    // "Llegó" solo cerrando un retraso avisado.
    const claveLlego = `LLEGO_${t.id}:${u.operadorId}`;
    if (llegada && enviados.has(claveRetraso) && !enviados.has(claveLlego)) {
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

/** Los avisos que todavía no se mandaron: primero las alertas del sistema (por hora), luego retrasos y GPS. */
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
  return [...deAlertas, ...deTramos];
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
