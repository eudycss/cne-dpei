/**
 * Crea (o resetea la contraseña de) un usuario dedicado y aislado para pruebas de
 * carga, sin tocar el admin real ni ningún operador existente.
 * Uso: pnpm --filter @cne/api exec ts-node --transpile-only loadtest/create-loadtest-user.ts
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import * as path from 'node:path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const EMAIL = 'k6-loadtest@cne-imbabura.gob.ec';
const PASSWORD = 'LoadTest*2026Temp';
const CEDULA = '9999999999';

async function main() {
  const prisma = new PrismaClient();
  const rol = await prisma.rol.findUniqueOrThrow({ where: { nombre: 'ADMINISTRADOR' } });
  const passwordHash = await argon2.hash(PASSWORD);
  const user = await prisma.usuario.upsert({
    where: { email: EMAIL },
    update: { passwordHash, activo: true, debeCambiarPwd: false },
    create: {
      email: EMAIL,
      cedula: CEDULA,
      nombres: 'K6',
      apellidos: 'LoadTest',
      passwordHash,
      activo: true,
      debeCambiarPwd: false,
      roles: { create: [{ rolId: rol.id }] },
    },
  });
  console.log(`✓ Usuario de carga listo: ${user.email} / ${PASSWORD}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
