/**
 * Crea (idempotente) el fixture fijo que consume test/tracking-flow.e2e-spec.ts:
 * un recinto, evento, kit y operador de prueba con IDs literales conocidos.
 * `pnpm db:seed` no lo crea (solo siembra catálogo real + admin), así que este
 * flujo e2e requiere correr este script una vez por base de datos.
 *
 * Uso: pnpm --filter @cne/api exec ts-node --transpile-only test/fixtures/ensure-tracking-e2e-fixtures.ts
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import * as path from 'node:path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const EVENTO_ID = '00000000-0000-0000-0000-00000000e001';
const OPERADOR_ID = '00000000-0000-0000-0000-0000000000a1';
const KIT_ID = '00000000-0000-0000-0000-0000000000c1';
const RECINTO_ID = 'eb6b1982-f5e1-4d6c-a4a8-b851561607c6';
const RECINTO_CODIGO = 'TEST-E2E-A';
const OPERADOR_EMAIL = 'test.operador.a@cne-imbabura.gob.ec';
const OPERADOR_CEDULA = '1799999991';
// Placeholder — el beforeAll del spec la vuelve a fijar en cada corrida.
const OPERADOR_PASSWORD_PLACEHOLDER = 'Test*OperadorA2026';
// Coincide con RECINTO en tracking-flow.e2e-spec.ts (lat, lng).
const RECINTO_COORDS = { latitud: 0.2960868, longitud: -78.2672478 };

async function main() {
  const prisma = new PrismaClient();

  const canton = await prisma.canton.findUniqueOrThrow({ where: { codigo: '30' } }); // IBARRA

  const recintoExiste = await prisma.recinto.findUnique({ where: { id: RECINTO_ID } });
  if (!recintoExiste) {
    await prisma.$executeRaw`
      INSERT INTO recintos (id, codigo_recinto, nombre, canton_id, tipo, ubicacion, tiene_internet, cobertura_movil)
      VALUES (
        ${RECINTO_ID}::uuid,
        ${RECINTO_CODIGO},
        'Escuela Manuela Cañizares (fixture E2E)',
        ${canton.id},
        'CDA',
        ST_SetSRID(ST_MakePoint(${RECINTO_COORDS.longitud}, ${RECINTO_COORDS.latitud}), 4326)::geography,
        TRUE,
        TRUE
      )
    `;
    console.log('✓ Recinto de prueba creado');
  } else {
    console.log('✓ Recinto de prueba ya existía');
  }

  await prisma.eventoElectoral.upsert({
    where: { id: EVENTO_ID },
    update: { estado: 'ACTIVO' },
    create: {
      id: EVENTO_ID,
      nombre: 'TEST E2E',
      tipo: 'GENERAL',
      fechaJornada: new Date(),
      estado: 'ACTIVO',
    },
  });
  console.log('✓ Evento de prueba listo');

  const rolOperador = await prisma.rol.findUniqueOrThrow({ where: { nombre: 'OPERADOR_CDA' } });
  const passwordHash = await argon2.hash(OPERADOR_PASSWORD_PLACEHOLDER);
  const operadorExiste = await prisma.usuario.findUnique({ where: { id: OPERADOR_ID } });
  if (!operadorExiste) {
    await prisma.usuario.create({
      data: {
        id: OPERADOR_ID,
        cedula: OPERADOR_CEDULA,
        email: OPERADOR_EMAIL,
        nombres: 'Operador',
        apellidos: 'Prueba E2E',
        passwordHash,
        debeCambiarPwd: false,
        activo: true,
        roles: { create: [{ rolId: rolOperador.id }] },
      },
    });
    console.log('✓ Operador de prueba creado');
  } else {
    console.log('✓ Operador de prueba ya existía');
  }

  await prisma.kitElectoral.upsert({
    where: { id: KIT_ID },
    update: { estado: 'ASIGNADO', recintoId: RECINTO_ID, operadorId: OPERADOR_ID },
    create: {
      id: KIT_ID,
      eventoId: EVENTO_ID,
      codigoUnico: 'TEST-KIT-A',
      qrPayload: 'TEST-KIT-A',
      nombre: 'Kit de prueba E2E',
      recintoId: RECINTO_ID,
      operadorId: OPERADOR_ID,
      estado: 'ASIGNADO',
      esPrueba: true,
    },
  });
  console.log('✓ Kit de prueba listo');

  console.log('✓ Fixtures de tracking-flow.e2e-spec.ts listos');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
