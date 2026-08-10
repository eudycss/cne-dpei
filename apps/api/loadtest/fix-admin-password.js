const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL || 'admin@cne-imbabura.gob.ec';
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!password) {
    throw new Error('ADMIN_INITIAL_PASSWORD no está definida en apps/api/.env');
  }
  const passwordHash = await argon2.hash(password);
  const user = await prisma.usuario.update({
    where: { email },
    data: { passwordHash, debeCambiarPwd: false, activo: true },
  });
  console.log(`✓ Password del admin (${user.email}) resincronizada con ADMIN_INITIAL_PASSWORD de .env`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
