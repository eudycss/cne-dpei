/**
 * Seed inicial — Fase 1
 *
 * Crea:
 *  - Roles base (ADMINISTRADOR, TECNICO_SUPERVISOR, OPERADOR_CDA)
 *  - Cantones de Imbabura
 *  - Recintos electorales (carga seed_recintos.sql)
 *  - Usuario administrador inicial (variables ADMIN_* del .env)
 *
 * Idempotente: se puede ejecutar múltiples veces sin duplicar.
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as argon2 from 'argon2';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const prisma = new PrismaClient();

const ROLES = ['ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'OPERADOR_CDA'] as const;

const CANTONES = [
  { codigo: '30', nombre: 'IBARRA' },
  { codigo: '35', nombre: 'OTAVALO' },
  { codigo: '40', nombre: 'COTACACHI' },
  { codigo: '45', nombre: 'ANTONIO ANTE' },
  { codigo: '50', nombre: 'PIMAMPIRO' },
  { codigo: '55', nombre: 'URCUQUI' },
];

async function ensureRoles() {
  for (const nombre of ROLES) {
    await prisma.rol.upsert({
      where: { nombre },
      update: {},
      create: { nombre },
    });
  }
  console.log(`✓ ${ROLES.length} roles asegurados`);
}

async function ensureCantones() {
  for (const c of CANTONES) {
    await prisma.canton.upsert({
      where: { codigo: c.codigo },
      update: { nombre: c.nombre },
      create: c,
    });
  }
  console.log(`✓ ${CANTONES.length} cantones asegurados`);
}

async function ensureRecintos() {
  const existentes = await prisma.recinto.count();
  if (existentes > 0) {
    console.log(`✓ Recintos ya cargados (${existentes}), se omite`);
    return;
  }

  // Carga el SQL original sin alterarlo
  const seedSql = fs.readFileSync(
    path.resolve(__dirname, '../../../seed_recintos.sql'),
    'utf8',
  );

  // El archivo contiene múltiples sentencias separadas por ";\n".
  // Removemos comentarios de línea y filtramos las que quedan vacías.
  const stripComments = (s: string) =>
    s
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .trim();

  const statements = seedSql
    .split(/;\s*\n/)
    .map(stripComments)
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    await prisma.$executeRawUnsafe(stmt);
  }
  const total = await prisma.recinto.count();
  console.log(`✓ ${total} recintos cargados desde seed_recintos.sql`);
}

async function ensureAdminInicial() {
  const email = process.env.ADMIN_EMAIL ?? 'admin@cne-imbabura.gob.ec';
  const cedula = process.env.ADMIN_CEDULA ?? '1000000000';
  const nombres = process.env.ADMIN_NOMBRES ?? 'Administrador';
  const apellidos = process.env.ADMIN_APELLIDOS ?? 'del Sistema';
  const password = process.env.ADMIN_INITIAL_PASSWORD;

  if (!password || password.length < 12) {
    throw new Error(
      'ADMIN_INITIAL_PASSWORD no está definida o es muy corta (>=12). ' +
        'Configúrala en .env antes de ejecutar el seed.',
    );
  }

  const existing = await prisma.usuario.findUnique({ where: { email } });
  if (existing) {
    console.log(`✓ Admin inicial ya existe (${email})`);
    return;
  }

  const passwordHash = await argon2.hash(password);
  const rolAdmin = await prisma.rol.findUniqueOrThrow({
    where: { nombre: 'ADMINISTRADOR' },
  });

  const user = await prisma.usuario.create({
    data: {
      email,
      cedula,
      nombres,
      apellidos,
      passwordHash,
      debeCambiarPwd: true,
      activo: true,
      roles: {
        create: [{ rolId: rolAdmin.id }],
      },
    },
  });
  console.log(`✓ Admin inicial creado: ${user.email}  (contraseña: ${password})`);
  console.log('  ⚠ Cámbiala en el primer login (HU1-CA3)');
}

async function main() {
  console.log('→ Iniciando seed...');
  await ensureRoles();
  await ensureCantones();
  await ensureRecintos();
  await ensureAdminInicial();
  console.log('✓ Seed completo');
}

main()
  .catch((e) => {
    console.error('✗ Error en seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
