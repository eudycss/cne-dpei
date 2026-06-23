import { BadRequestException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { StorageService } from './storage.service';

// Tests de integración ligera: cifrado/descifrado real (AES-256-GCM) sobre un
// directorio temporal real. Sin Prisma. Verifica el round-trip, la integridad
// (auth tag GCM) y las validaciones de entrada.
describe('StorageService', () => {
  let service: StorageService;
  let rootDir: string;
  const keyHex = crypto.randomBytes(32).toString('hex'); // 64 hex chars válidos

  function buildConfig(overrides: Record<string, string | undefined> = {}) {
    const values: Record<string, string | undefined> = {
      STORAGE_ENCRYPTION_KEY: keyHex,
      STORAGE_DIR: rootDir,
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
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cne-storage-'));
    service = new StorageService(buildConfig());
    await service.onModuleInit();
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
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

    it('escribe el archivo cifrado en disco (no en claro)', async () => {
      const plaintext = Buffer.from('texto-secreto-en-claro', 'utf8');
      const fileId = await service.saveEncrypted({ categoria: 'militares', buffer: plaintext });

      const onDisk = await fs.readFile(path.join(rootDir, fileId));
      expect(onDisk.includes(plaintext)).toBe(false); // el plaintext no aparece tal cual
      expect(onDisk.length).toBeGreaterThan(plaintext.length); // IV + authTag + ciphertext
    });

    it('detecta manipulación del archivo (auth tag GCM)', async () => {
      const fileId = await service.saveEncrypted({
        categoria: 'militares',
        buffer: Buffer.from('contenido-a-proteger', 'utf8'),
      });
      const fullPath = path.join(rootDir, fileId);
      const data = await fs.readFile(fullPath);
      data[data.length - 1] ^= 0xff; // corrompe el último byte del ciphertext
      await fs.writeFile(fullPath, data);

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
