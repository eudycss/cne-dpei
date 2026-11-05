import { HttpException, HttpStatus } from '@nestjs/common';

/** Por encima de esto se barren las claves sin uso reciente (acota la memoria). */
const MAX_CLAVES = 5000;

/**
 * Límite de usos por clave (aquí: por cédula) en una ventana deslizante. El
 * límite por IP no sirve para esto: una sala entera sale por la misma IP, y
 * quien prueba cédulas ajenas puede cambiar de IP pero no de cédula. Vive en
 * memoria: la API corre en una sola instancia.
 */
export class LimitePorClave {
  private readonly usos = new Map<string, number[]>();

  constructor(
    private readonly limite: number,
    private readonly ventanaMs: number,
    private readonly mensaje: string,
  ) {}

  /** Cuenta un uso; si ya llegó al límite lanza 429 sin contarlo. */
  registrar(clave: string, ahora: number): void {
    const desde = ahora - this.ventanaMs;
    const recientes = (this.usos.get(clave) ?? []).filter((t) => t > desde);
    if (recientes.length >= this.limite) {
      this.usos.set(clave, recientes);
      throw new HttpException(this.mensaje, HttpStatus.TOO_MANY_REQUESTS);
    }
    recientes.push(ahora);
    this.usos.set(clave, recientes);
    if (this.usos.size > MAX_CLAVES) this.barrer(desde);
  }

  private barrer(desde: number): void {
    for (const [clave, tiempos] of this.usos) {
      if (!tiempos.some((t) => t > desde)) this.usos.delete(clave);
    }
  }

  get claves(): number {
    return this.usos.size;
  }
}
