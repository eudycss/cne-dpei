import { BadRequestException } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { StorageService } from './storage.service';

/**
 * Cliente Supabase Storage falso, en memoria, que implementa solo la
 * superficie que StorageService usa (`from(bucket).upload/download/list`).
 * Evita depender de red o de un proyecto Supabase real en los tests.
 */
function buildFakeSupabaseClient() {
  const objects = new Map<string, Buffer>();

  const from = (_bucket: string) => ({
    upload: async (path: string, body: Buffer) => {
      if (objects.has(path)) {
        return { data: null, error: { message: 'ya existe' } };
      }
      objects.set(path, Buffer.from(body));
      return { data: { path }, error: null };
    },
    download: async (path: string) => {
      const buf = objects.get(path);
      if (!buf) return { data: null, error: { message: 'no encontrado' } };
      return { data: new Blob([buf]), error: null };
    },
    list: async (prefix: string, opts?: { search?: string }) => {
      const matches = [...objects.keys()]
        .filter((k) => k.startsWith(`${prefix}/`))
        .map((k) => k.slice(prefix.length + 1))
        .filter((name) => !opts?.search || name === opts.search)
        .map((name) => ({ name }));
      return { data: matches, error: null };
    },
  });

  return { client: { from } as any, objects };
}

describe('StorageService', () => {
  let service: StorageService;
  let objects: Map<string, Buffer>;
  const keyHex = crypto.randomBytes(32).toString('hex'); // 64 hex chars válidos

  function buildConfig(overrides: Record<string, string | undefined> = {}) {
    const values: Record<string, string | undefined> = {
      STORAGE_ENCRYPTION_KEY: keyHex,
      SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
      ...overrides,
    };
    return {
      getOrThrow: (k: string) => {
        const v = values[k];
        if (v == null) throw new Error(`missing ${k}`);
        return v;
      },
      get: (k: string) => values[k],
    } as any;
  }

  beforeEach(async () => {
    service = new StorageService(buildConfig());
    await service.onModuleInit();
    const fake = buildFakeSupabaseClient();
    service.client = fake.client; // reemplaza el cliente real por el falso
    objects = fake.objects;
  });

  describe('onModuleInit', () => {
    it('rechaza una clave que no sea hex de 64 caracteres', async () => {
      const bad = new StorageService(buildConfig({ STORAGE_ENCRYPTION_KEY: 'demasiado-corta' }));
      await expect(bad.onModuleInit()).rejects.toThrow();
    });
  });

  describe('saveEncrypted + readDecrypted', () => {
    it('cifra y luego descifra devolviendo el contenido original (round-trip)', async () => {
      const plaintext = Buffer.from('foto-del-militar-contenido-binario', 'utf8');

      const fileId = await service.saveEncrypted({ categoria: 'militares', buffer: plaintext });

      expect(fileId).toMatch(/^militares\/[a-f0-9-]+\.bin$/);
      const recovered = await service.readDecrypted(fileId);
      expect(recovered.equals(plaintext)).toBe(true);
    });

    it('sube el objeto cifrado (no el plaintext) al bucket', async () => {
      const plaintext = Buffer.from('texto-secreto-en-claro', 'utf8');
      const fileId = await service.saveEncrypted({ categoria: 'militares', buffer: plaintext });

      const stored = objects.get(fileId);
      expect(stored).toBeDefined();
      expect(stored!.includes(plaintext)).toBe(false); // el plaintext no aparece tal cual
      expect(stored!.length).toBeGreaterThan(plaintext.length); // IV + authTag + ciphertext
    });

    it('detecta manipulación del archivo (auth tag GCM)', async () => {
      const fileId = await service.saveEncrypted({
        categoria: 'militares',
        buffer: Buffer.from('contenido-a-proteger', 'utf8'),
      });
      const stored = objects.get(fileId)!;
      stored[stored.length - 1] ^= 0xff; // corrompe el último byte del ciphertext

      await expect(service.readDecrypted(fileId)).rejects.toThrow();
    });
  });

  describe('validaciones de saveEncrypted', () => {
    it('rechaza una categoría inválida', async () => {
      await expect(
        service.saveEncrypted({ categoria: '../escape', buffer: Buffer.from('x') }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza un archivo vacío', async () => {
      await expect(
        service.saveEncrypted({ categoria: 'militares', buffer: Buffer.alloc(0) }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza un archivo que excede el tamaño máximo', async () => {
      await expect(
        service.saveEncrypted({
          categoria: 'militares',
          buffer: Buffer.alloc(10),
          maxBytes: 5,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('readDecrypted / exists', () => {
    it('readDecrypted rechaza un identificador con formato inválido', async () => {
      await expect(service.readDecrypted('ruta/invalida.txt')).rejects.toThrow(BadRequestException);
    });

    it('exists devuelve true para un archivo guardado y false si no existe', async () => {
      const fileId = await service.saveEncrypted({
        categoria: 'militares',
        buffer: Buffer.from('x'),
      });
      expect(await service.exists(fileId)).toBe(true);
      expect(await service.exists('militares/00000000-0000-0000-0000-000000000000.bin')).toBe(false);
    });

    it('exists devuelve false ante un identificador con formato inválido', async () => {
      expect(await service.exists('formato/invalido.txt')).toBe(false);
    });
  });
});
