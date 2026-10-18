import { Injectable, Logger } from '@nestjs/common';
import { HERRAMIENTAS_MODELO, HERRAMIENTAS_MODELO_SQL, INSTRUCCIONES_MODELO, INSTRUCCIONES_MODELO_SQL } from './herramientas';

/** Ningún proveedor respondió (sin llaves, caídos, límite de uso o sin respuesta a tiempo). */
export class AsistenteNoDisponible extends Error {
  constructor() {
    super('Ningún proveedor del asistente respondió');
  }
}

/** La consulta que eligió el modelo, todavía sin validar. */
export interface LlamadaModelo {
  nombre: string;
  argumentos: unknown;
}

interface Proveedor {
  nombre: string;
  url: string;
  apiKey: string;
  modelo: string;
}

/** Más llamadas en una sola pregunta no son una consulta razonable (y cuidan la cuota). */
export const MAX_CONSULTAS = 3;

/** Si un proveedor tarda más, se pasa al siguiente: la persona está esperando en el chat. */
const TIMEOUT_MS = 8_000;

/** Groq primero y Gemini de respaldo, los que tengan llave. Los dos exponen la API
 * de chat compatible con OpenAI, así que se llaman igual. */
export function proveedoresConfigurados(env: NodeJS.ProcessEnv = process.env): Proveedor[] {
  const lista: Proveedor[] = [];
  const groq = env.GROQ_API_KEY?.trim();
  if (groq) {
    lista.push({
      nombre: 'Groq',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      apiKey: groq,
      modelo: env.GROQ_MODEL?.trim() || 'openai/gpt-oss-120b',
    });
  }
  const gemini = env.GEMINI_API_KEY?.trim();
  if (gemini) {
    lista.push({
      nombre: 'Gemini',
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      apiKey: gemini,
      modelo: env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash',
    });
  }
  return lista;
}

/** Modo de las consultas: filtros fijos (consultar_recintos) o SQL libre (consultar_datos). */
export type ModoConsultas = 'filtros' | 'sql';

/** El modo SQL se enciende aparte (ASISTENTE_SQL_ENABLED): apagado, el bot responde como siempre. */
export function asistenteSqlHabilitado(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ASISTENTE_SQL_ENABLED === 'true';
}

/** El asistente solo se ofrece si está activado y hay al menos un proveedor con llave. */
export function asistenteHabilitado(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ASISTENTE_ENABLED === 'true' && proveedoresConfigurados(env).length > 0;
}

interface RespuestaChat {
  choices?: { message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[];
}

@Injectable()
export class LlmClient {
  private readonly log = new Logger('AsistenteLlm');

  /**
   * Manda SOLO la pregunta al modelo para que elija consultas (hasta MAX_CONSULTAS).
   * [] = no eligió ninguna (pregunta fuera de lo que el bot sabe). Si un proveedor falla,
   * prueba el siguiente; si fallan todos, lanza AsistenteNoDisponible.
   */
  async elegirConsultas(pregunta: string, modo: ModoConsultas = 'filtros'): Promise<LlamadaModelo[]> {
    for (const proveedor of proveedoresConfigurados()) {
      try {
        return await this.consultar(proveedor, pregunta, modo);
      } catch (e) {
        // Sin la pregunta ni la llave en el log: solo quién falló y por qué.
        this.log.warn(`${proveedor.nombre} no respondió (${causa(e)})`);
      }
    }
    throw new AsistenteNoDisponible();
  }

  private async consultar(p: Proveedor, pregunta: string, modo: ModoConsultas): Promise<LlamadaModelo[]> {
    const sql = modo === 'sql';
    const res = await fetch(p.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` },
      body: JSON.stringify({
        model: p.modelo,
        temperature: 0,
        // El SQL (y el razonamiento del modelo antes de escribirlo) necesita más espacio.
        max_tokens: sql ? 2048 : 1024,
        messages: [
          { role: 'system', content: sql ? INSTRUCCIONES_MODELO_SQL : INSTRUCCIONES_MODELO },
          { role: 'user', content: pregunta },
        ],
        tools: sql ? HERRAMIENTAS_MODELO_SQL : HERRAMIENTAS_MODELO,
        tool_choice: 'auto',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const datos = (await res.json()) as RespuestaChat;
    // Sin herramientas = el modelo contestó con texto: ese texto nunca se muestra.
    const llamadas = (datos?.choices?.[0]?.message?.tool_calls ?? [])
      .map((t) => t?.function)
      .filter((f): f is { name: string; arguments?: string } => !!f?.name)
      .slice(0, MAX_CONSULTAS);
    return llamadas.map((llamada) => {
      try {
        return { nombre: llamada.name, argumentos: JSON.parse(llamada.arguments || '{}') as unknown };
      } catch {
        throw new Error('argumentos que no son JSON');
      }
    });
  }
}

function causa(e: unknown): string {
  const err = e as Error;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return `sin respuesta en ${TIMEOUT_MS / 1000} s`;
  return err?.message?.startsWith('HTTP ') || err?.message === 'argumentos que no son JSON'
    ? err.message
    : `error de red (${err?.name ?? 'desconocido'})`;
}
