import { Injectable, Logger } from '@nestjs/common';
import { HERRAMIENTAS_MODELO, INSTRUCCIONES_MODELO } from './herramientas';

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
   * Manda SOLO la pregunta al modelo para que elija una consulta. null = el modelo
   * no eligió ninguna (pregunta fuera de lo que el bot sabe). Si un proveedor falla,
   * prueba el siguiente; si fallan todos, lanza AsistenteNoDisponible.
   */
  async elegirConsulta(pregunta: string): Promise<LlamadaModelo | null> {
    for (const proveedor of proveedoresConfigurados()) {
      try {
        return await this.consultar(proveedor, pregunta);
      } catch (e) {
        // Sin la pregunta ni la llave en el log: solo quién falló y por qué.
        this.log.warn(`${proveedor.nombre} no respondió (${causa(e)})`);
      }
    }
    throw new AsistenteNoDisponible();
  }

  private async consultar(p: Proveedor, pregunta: string): Promise<LlamadaModelo | null> {
    const res = await fetch(p.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` },
      body: JSON.stringify({
        model: p.modelo,
        temperature: 0,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: INSTRUCCIONES_MODELO },
          { role: 'user', content: pregunta },
        ],
        tools: HERRAMIENTAS_MODELO,
        tool_choice: 'auto',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const datos = (await res.json()) as RespuestaChat;
    const llamada = datos?.choices?.[0]?.message?.tool_calls?.[0]?.function;
    // Sin herramienta = el modelo contestó con texto: ese texto nunca se muestra.
    if (!llamada?.name) return null;
    let argumentos: unknown;
    try {
      argumentos = JSON.parse(llamada.arguments || '{}');
    } catch {
      throw new Error('argumentos que no son JSON');
    }
    return { nombre: llamada.name, argumentos };
  }
}

function causa(e: unknown): string {
  const err = e as Error;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return `sin respuesta en ${TIMEOUT_MS / 1000} s`;
  return err?.message?.startsWith('HTTP ') || err?.message === 'argumentos que no son JSON'
    ? err.message
    : `error de red (${err?.name ?? 'desconocido'})`;
}
