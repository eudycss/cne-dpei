import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM recomienda 96 bits
const AUTH_TAG_LENGTH = 16;

/**
 * Almacena archivos cifrados con AES-256-GCM en el filesystem local.
 * Formato del archivo en disco: [IV (12B)][AUTH_TAG (16B)][CIPHERTEXT].
 *
 * HU3-CA2: la fotografía del militar debe almacenarse cifrada como respaldo
 * de la cadena de custodia. La descarga (con descifrado) llegará cuando se
 * implemente la vista de evidencia en HU17.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly log = new Logger(StorageService.name);
  private key!: Buffer;
  private rootDir!: string;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const keyHex = this.config.getOrThrow<string>('STORAGE_ENCRYPTION_KEY');
    if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
      throw new Error(
        'STORAGE_ENCRYPTION_KEY debe ser un hex de 64 caracteres (32 bytes). Genera con: openssl rand -hex 32',
      );
    }
    this.key = Buffer.from(keyHex, 'hex');
    const dir = this.config.get<string>('STORAGE_DIR') ?? 'storage';
    this.rootDir = path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir);
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  /**
   * Guarda un buffer cifrado bajo `categoria/`. Devuelve el identificador
   * relativo (categoría/uuid.bin) que debe almacenarse en BD.
   */
  async saveEncrypted(opts: {
    categoria: string;
    buffer: Buffer;
    maxBytes?: number;
  }): Promise<string> {
    if (!/^[a-z0-9_-]+$/i.test(opts.categoria)) {
      throw new BadRequestException('Categoría de almacenamiento inválida');
    }
    const maxBytes = opts.maxBytes ?? 8 * 1024 * 1024; // 8 MB por defecto
    if (opts.buffer.length === 0) {
      throw new BadRequestException('Archivo vacío');
    }
    if (opts.buffer.length > maxBytes) {
      throw new BadRequestException(`Archivo excede el tamaño máximo (${maxBytes} bytes)`);
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(opts.buffer), cipher.final()]);
    const authTag = cipher.getAuthTag();
    if (authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error('Auth tag de longitud inesperada');
    }

    const filename = `${crypto.randomUUID()}.bin`;
    const dir = path.join(this.rootDir, opts.categoria);
    await fs.mkdir(dir, { recursive: true });
    const fullPath = path.join(dir, filename);
    await fs.writeFile(fullPath, Buffer.concat([iv, authTag, ciphertext]));

    const fileId = `${opts.categoria}/${filename}`;
    this.log.debug?.(`Stored encrypted file ${fileId} (${opts.buffer.length}B plaintext)`);
    return fileId;
  }

  /**
   * Lee y descifra un archivo por su identificador relativo. Reservado para
   * vistas de evidencia (HU17); no usado por HU3 directamente.
   */
  async readDecrypted(fileId: string): Promise<Buffer> {
    if (!/^[a-z0-9_-]+\/[a-f0-9-]+\.bin$/i.test(fileId)) {
      throw new BadRequestException('Identificador de archivo inválido');
    }
    const fullPath = path.join(this.rootDir, fileId);
    const data = await fs.readFile(fullPath);
    if (data.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new BadRequestException('Archivo corrupto');
    }
    const iv = data.subarray(0, IV_LENGTH);
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  /** Verifica que el archivo identificado existe físicamente. */
  async exists(fileId: string): Promise<boolean> {
    if (!/^[a-z0-9_-]+\/[a-f0-9-]+\.bin$/i.test(fileId)) return false;
    try {
      await fs.access(path.join(this.rootDir, fileId));
      return true;
    } catch {
      return false;
    }
  }
}
