import { Injectable } from '@nestjs/common';
import {
  INSTRUCCIONES_LECTOR,
  LectorNoConfigurado,
  LectorRespuestaInvalida,
  LectorTransitorio,
  PEDIDO_LECTOR,
  TIMEOUT_LECTOR_MS,
  errorPorEstado,
  modeloValido,
  parsearLectura,
  type LecturaCertificado,
  type LectorCertificado,
} from './lector-certificado';

/** Modelo de visión de Groq (GA); se cambia con GROQ_MODELO. */
export const MODELO_GROQ_POR_DEFECTO = 'qwen/qwen3.8-27b';
const URL_GROQ = 'https://api.groq.com/openai/v1/chat/completions';
/** Límite de Groq para imágenes en base64 (la página manda ~400 KB). */
export const MAX_IMAGEN_GROQ_BYTES = 20 * 1024 * 1024;

/**
 * Groq (chat completions compatible con OpenAI). Solo tiene modo JSON (sin
 * esquema): el formato va en las instrucciones y se valida con Zod igual.
 * Misma llave que el asistente del bot (GROQ_API_KEY).
 */
@Injectable()
export class GroqCertificadoClient implements LectorCertificado {
  readonly nombre = 'Groq';

  disponible(): boolean {
    return !!process.env.GROQ_API_KEY?.trim();
  }

  async leer(imagen: Buffer, mime: string): Promise<LecturaCertificado> {
    const clave = process.env.GROQ_API_KEY?.trim();
    if (!clave) throw new LectorNoConfigurado('Falta GROQ_API_KEY');
    const modelo = process.env.GROQ_MODELO?.trim() || MODELO_GROQ_POR_DEFECTO;
    if (!modeloValido(modelo)) throw new LectorRespuestaInvalida('GROQ_MODELO no es un nombre de modelo válido');
    if (imagen.length > MAX_IMAGEN_GROQ_BYTES) throw new LectorRespuestaInvalida('La imagen supera el límite de Groq');

    let res: Response;
    try {
      res = await fetch(URL_GROQ, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${clave}`,
        },
        body: JSON.stringify({
          model: modelo,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: INSTRUCCIONES_LECTOR },
            {
              role: 'user',
              // Una sola imagen (Groq acepta hasta 3 por petición).
              content: [
                { type: 'text', text: PEDIDO_LECTOR },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${mime};base64,${imagen.toString('base64')}`,
                  },
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(TIMEOUT_LECTOR_MS),
      });
    } catch (e) {
      throw new LectorTransitorio(`Sin respuesta de Groq: ${(e as Error).message}`);
    }
    const error = errorPorEstado('Groq', res);
    if (error) throw error;

    let texto: unknown;
    try {
      const cuerpo = (await res.json()) as {
        choices?: { message?: { content?: unknown } }[];
      };
      texto = cuerpo.choices?.[0]?.message?.content;
    } catch {
      throw new LectorRespuestaInvalida('Groq devolvió algo que no es JSON');
    }
    return parsearLectura('Groq', texto);
  }
}
