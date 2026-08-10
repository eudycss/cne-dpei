const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const prisma = new PrismaClient();
(async () => {
  const usuario = await prisma.usuario.findUnique({ where: { id: '00000000-0000-0000-0000-0000000000a1' } });
  const evento = await prisma.eventoElectoral.findUnique({ where: { id: '00000000-0000-0000-0000-00000000e001' } });
  const kit = await prisma.kitElectoral.findUnique({ where: { id: '00000000-0000-0000-0000-0000000000c1' } });
  const recinto = await prisma.recinto.findUnique({ where: { id: 'eb6b1982-f5e1-4d6c-a4a8-b851561607c6' } });
  const opByEmail = await prisma.usuario.findUnique({ where: { email: 'test.operador.a@cne-imbabura.gob.ec' } });
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@cne-imbabura.gob.ec';
  const admin = await prisma.usuario.findUnique({ where: { email: adminEmail }, include: { roles: { include: { rol: true } } } });
  console.log(JSON.stringify({
    usuarioById: !!usuario,
    eventoExists: !!evento,
    kitExists: !!kit,
    recintoExists: !!recinto,
    operadorByEmailExists: !!opByEmail,
    operadorByEmailId: opByEmail?.id,
    adminExists: !!admin,
    adminRoles: admin?.roles?.map(r => r.rol.nombre),
    adminEnvEmail: adminEmail,
  }, null, 2));
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
