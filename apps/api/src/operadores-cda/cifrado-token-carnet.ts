import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

const ALGORITMO = 'aes-256-gcm';
const VERSION = 'v1:';
const IV = 12;
const TAG = 16;
// Rotar CARNET_TOKEN_KEY deja sin reimprimir todo lo emitido antes (hay que reemitirlo): no se pierde
// ningún carnet, solo la reimpresión. Custodiarla como STORAGE_ENCRYPTION_KEY.

/**
 * Cifra el token del carnet QR para poder reimprimirlo sin anularlo. La clave
 * (CARNET_TOKEN_KEY, 64 hex) vive solo en el servidor, separada de la BD: con
 * la base filtrada sin la clave no se puede fabricar un carnet válido. El id
 * del operador va como dato autenticado, así un token cifrado no sirve si se
 * copia a la fila de otra persona.
 *
 * Sin clave configurada, emitir sigue funcionando (solo hash) y reimprimir no.
 */
@Injectable()
export class CifradoTokenCarnet {
  private readonly logger = new Logger(CifradoTokenCarnet.name);
  private readonly clave: Buffer | null;

  constructor(config: ConfigService) {
    const hex = config.get<string>('CARNET_TOKEN_KEY');
    if (!hex) {
      this.logger.warn('CARNET_TOKEN_KEY no configurada: los carnets nuevos no se podrán reimprimir sin anularlos');
      this.clave = null;
      return;
    }
    // Una clave mal puesta debe notarse al arrancar, no al reimprimir.
    if (!/^[0-9a-f]{64}$/i.test(hex)) {
      throw new Error('CARNET_TOKEN_KEY debe ser un hex de 64 caracteres (32 bytes). Genere con: openssl rand -hex 32');
    }
    this.clave = Buffer.from(hex, 'hex');
  }

  get disponible(): boolean {
    return this.clave !== null;
  }

  /** null si no hay clave (el carnet se emite igual, pero no se podrá reimprimir). */
  cifrar(token: string, operadorId: string): string | null {
    if (!this.clave) return null;
    const iv = crypto.randomBytes(IV);
    const cifrador = crypto.createCipheriv(ALGORITMO, this.clave, iv);
    cifrador.setAAD(Buffer.from(operadorId));
    const cuerpo = Buffer.concat([cifrador.update(token, 'utf8'), cifrador.final()]);
    return VERSION + Buffer.concat([iv, cifrador.getAuthTag(), cuerpo]).toString('base64');
  }

  /** null si no hay clave, si la clave cambió o si el dato fue alterado o es de otra persona. */
  descifrar(cifrado: string, operadorId: string): string | null {
    if (!this.clave || !cifrado.startsWith(VERSION)) return null;
    const datos = Buffer.from(cifrado.slice(VERSION.length), 'base64');
    if (datos.length <= IV + TAG) return null;
    try {
      const descifrador = crypto.createDecipheriv(ALGORITMO, this.clave, datos.subarray(0, IV), { authTagLength: TAG });
      descifrador.setAAD(Buffer.from(operadorId));
      descifrador.setAuthTag(datos.subarray(IV, IV + TAG));
      return Buffer.concat([descifrador.update(datos.subarray(IV + TAG)), descifrador.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
}
