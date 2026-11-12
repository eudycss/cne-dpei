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

/** Modelo estable y barato que lee imágenes; se cambia con GEMINI_MODEL_EVATICS. */
export const MODELO_GEMINI_POR_DEFECTO = 'gemini-3.5-flash-lite';
const URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    nombreLeido: {
      type: 'STRING',
      nullable: true,
      description: 'Nombre completo de la persona certificada, o null',
    },
    esCertificadoEvatics: {
      type: 'BOOLEAN',
      description: 'true si la imagen es un certificado de la evaluación EVATICS',
    },
    legible: {
      type: 'BOOLEAN',
      description: 'true si el texto del certificado se lee con claridad',
    },
  },
  required: ['nombreLeido', 'esCertificadoEvatics', 'legible'],
} as const;

/**
 * Gemini (API REST generateContent con salida JSON y esquema). Misma llave que
 * el asistente del bot (GEMINI_API_KEY). Con la versión gratuita Google puede
 * usar la imagen para mejorar sus modelos: lo dice el aviso de la página.
 */
@Injectable()
export class GeminiCertificadoClient implements LectorCertificado {
  readonly nombre = 'Gemini';

  disponible(): boolean {
    return !!process.env.GEMINI_API_KEY?.trim();
  }

  async leer(imagen: Buffer, mime: string): Promise<LecturaCertificado> {
    const clave = process.env.GEMINI_API_KEY?.trim();
    if (!clave) throw new LectorNoConfigurado('Falta GEMINI_API_KEY');
    const modelo = process.env.GEMINI_MODEL_EVATICS?.trim() || MODELO_GEMINI_POR_DEFECTO;
    if (!modeloValido(modelo))
      throw new LectorRespuestaInvalida('GEMINI_MODEL_EVATICS no es un nombre de modelo válido');

    let res: Response;
    try {
      res = await fetch(`${URL_BASE}/${modelo}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': clave,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: INSTRUCCIONES_LECTOR }] },
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: mime,
                    data: imagen.toString('base64'),
                  },
                },
                { text: PEDIDO_LECTOR },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_LECTOR_MS),
      });
    } catch (e) {
      throw new LectorTransitorio(`Sin respuesta de Gemini: ${(e as Error).message}`);
    }
    const error = errorPorEstado('Gemini', res);
    if (error) throw error;

    let texto: unknown;
    try {
      const cuerpo = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: unknown }[] } }[];
      };
      texto = cuerpo.candidates?.[0]?.content?.parts?.[0]?.text;
    } catch {
      throw new LectorRespuestaInvalida('Gemini devolvió algo que no es JSON');
    }
    return parsearLectura('Gemini', texto);
  }
}
