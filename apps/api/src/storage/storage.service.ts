import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM recomienda 96 bits
const AUTH_TAG_LENGTH = 16;
const DEFAULT_BUCKET = 'archivos-cifrados';

/**
 * Almacena archivos cifrados con AES-256-GCM en Supabase Storage (bucket
 * privado). Formato del objeto: [IV (12B)][AUTH_TAG (16B)][CIPHERTEXT]. El
 * contenido en claro nunca sale del proceso de la API: se cifra antes de
 * subirse y se descifra después de descargarse.
 *
 * Antes se guardaba en el filesystem local del contenedor, lo que perdía los
 * archivos en cada redeploy/restart (Render Free no tiene disco persistente).
 * Supabase Storage es persistente y ya es el proveedor usado para la BD.
 *
 * HU3-CA2: la fotografía del militar debe almacenarse cifrada como respaldo
 * de la cadena de custodia. La descarga (con descifrado) llegará cuando se
 * implemente la vista de evidencia en HU17.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly log = new Logger(StorageService.name);
  private key!: Buffer;
  private bucket!: string;
  /** Público (no `private`) para poder inyectar un cliente falso en tests. */
  client!: SupabaseClient;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const keyHex = this.config.getOrThrow<string>('STORAGE_ENCRYPTION_KEY');
    if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
      throw new Error(
        'STORAGE_ENCRYPTION_KEY debe ser un hex de 64 caracteres (32 bytes). Genera con: openssl rand -hex 32',
      );
    }
    this.key = Buffer.from(keyHex, 'hex');
    this.bucket = this.config.get<string>('SUPABASE_STORAGE_BUCKET') ?? DEFAULT_BUCKET;
    const url = this.config.getOrThrow<string>('SUPABASE_URL');
    const serviceRoleKey = this.config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY');
    this.client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
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
    const fileId = `${opts.categoria}/${filename}`;
    const payload = Buffer.concat([iv, authTag, ciphertext]);
    const { error } = await this.client.storage.from(this.bucket).upload(fileId, payload, {
      contentType: 'application/octet-stream',
      upsert: false,
    });
    if (error) {
      throw new Error(`No se pudo guardar el archivo en Supabase Storage: ${error.message}`);
    }

    this.log.debug?.(`Stored encrypted file ${fileId} (${opts.buffer.length}B plaintext)`);
    return fileId;
  }

  /**
   * Descarga y descifra un archivo por su identificador relativo. Reservado
   * para vistas de evidencia (HU17); no usado por HU3 directamente.
   */
  async readDecrypted(fileId: string): Promise<Buffer> {
    if (!/^[a-z0-9_-]+\/[a-f0-9-]+\.bin$/i.test(fileId)) {
      throw new BadRequestException('Identificador de archivo inválido');
    }
    const { data: blob, error } = await this.client.storage.from(this.bucket).download(fileId);
    if (error || !blob) {
      throw new BadRequestException('Archivo no encontrado');
    }
    const data = Buffer.from(await blob.arrayBuffer());
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

  /** Verifica que el archivo identificado existe en el bucket. */
  async exists(fileId: string): Promise<boolean> {
    if (!/^[a-z0-9_-]+\/[a-f0-9-]+\.bin$/i.test(fileId)) return false;
    const [categoria, filename] = fileId.split('/');
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .list(categoria, { search: filename });
    if (error || !data) return false;
    return data.some((entry) => entry.name === filename);
  }
}
