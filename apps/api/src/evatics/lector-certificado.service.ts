import { Injectable, Logger } from '@nestjs/common';
import { GeminiCertificadoClient } from './gemini-certificado.client';
import { GroqCertificadoClient } from './groq-certificado.client';
import {
  LectorError,
  LectorNoConfigurado,
  LectorRespuestaInvalida,
  LectorTransitorio,
  type LecturaCertificado,
  type LectorCertificado,
} from './lector-certificado';

export type ProveedorVision = 'gemini' | 'groq';

/** Tras un 429 sin retry-after, el proveedor se salta este tiempo. */
export const ENFRIAMIENTO_429_MS = 5 * 60_000;

/**
 * Orden de preferencia: VISION_PROVEEDOR=groq pone Groq primero; vacío o
 * cualquier otro valor, Gemini primero. Siempre se prueban los dos.
 */
export function ordenProveedores(valor = process.env.VISION_PROVEEDOR): ProveedorVision[] {
  return valor?.trim().toLowerCase() === 'groq' ? ['groq', 'gemini'] : ['gemini', 'groq'];
}

export interface LecturaConProveedor {
  lectura: LecturaCertificado;
  /** Quién hizo el análisis (se guarda en el certificado y lo ve el supervisor). */
  proveedor: string;
}

/**
 * Lee el certificado con el primer proveedor que tenga llave y responda bien;
 * si uno falla (429, 5xx, tiempo, red, respuesta fuera de formato, 400 o llave
 * inválida) pasa al siguiente. Un proveedor que dio 429 se salta unos minutos.
 * Si fallan todos: LectorTransitorio si alguno falló por algo pasajero (se
 * reintenta en cola) o LectorRespuestaInvalida si todos fallaron sin remedio
 * (400, 401, formato: reintentar no sirve, se revisa a ojo).
 */
@Injectable()
export class LectorCertificadoService {
  private readonly log = new Logger('LectorEvatics');
  /** Hasta cuándo se salta cada proveedor (en memoria: un reinicio lo limpia). */
  private readonly enfriadoHasta = new Map<string, number>();

  constructor(
    private readonly gemini: GeminiCertificadoClient,
    private readonly groq: GroqCertificadoClient,
  ) {}

  /** false si ningún proveedor tiene llave: el certificado se revisa a ojo. */
  disponible(): boolean {
    return this.conLlave().length > 0;
  }

  async leer(imagen: Buffer, mime: string, ahora = Date.now()): Promise<LecturaConProveedor> {
    const lectores = this.conLlave();
    if (lectores.length === 0) throw new LectorNoConfigurado('Ningún proveedor de visión tiene llave');
    const listos = lectores.filter((l) => (this.enfriadoHasta.get(l.nombre) ?? 0) <= ahora);
    // Todos enfriándose: se prueba igual el primero (la cuota pudo volver antes).
    const aProbar = listos.length > 0 ? listos : lectores.slice(0, 1);

    const fallos: string[] = [];
    let algunoPasajero = false;
    for (const lector of aProbar) {
      try {
        const lectura = await lector.leer(imagen, mime);
        this.enfriadoHasta.delete(lector.nombre);
        return { lectura, proveedor: lector.nombre };
      } catch (e) {
        const error = e as Error;
        fallos.push(error.message);
        if (!(error instanceof LectorRespuestaInvalida)) algunoPasajero = true;
        if (error instanceof LectorError && error.status === 429) {
          this.enfriadoHasta.set(lector.nombre, ahora + (error.retryAfterMs ?? ENFRIAMIENTO_429_MS));
        }
        if (error instanceof LectorError && (error.status === 400 || error.status === 401 || error.status === 403)) {
          // No se arregla reintentando: hay que revisar la llave o el modelo en Render.
          this.log.error(
            `${lector.nombre} rechazó la petición (${error.status}): revise su llave o el nombre del modelo en Render`,
          );
        } else {
          this.log.warn(`${lector.nombre} no pudo leer el certificado, se prueba el siguiente: ${error.message}`);
        }
      }
    }
    const mensaje = `Ningún proveedor pudo leer el certificado (${fallos.join('; ')})`;
    throw algunoPasajero ? new LectorTransitorio(mensaje) : new LectorRespuestaInvalida(mensaje);
  }

  /** Los que tienen llave, en el orden de VISION_PROVEEDOR. */
  private conLlave(): LectorCertificado[] {
    const por: Record<ProveedorVision, LectorCertificado> = {
      gemini: this.gemini,
      groq: this.groq,
    };
    return ordenProveedores()
      .map((p) => por[p])
      .filter((l) => l.disponible());
  }
}
