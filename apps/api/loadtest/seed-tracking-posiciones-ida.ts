/**
 * Seed de datos para el load test COMBINADO (ida + retorno) de
 * POST /tracking/posiciones. Complementa seed-tracking-posiciones.ts: usa el
 * mismo evento ACTIVO (lo reusa si ya corriste ese script antes) pero crea un
 * segundo operador, en estado "ida" (solo SALIDA_DPI, sin LLEGADA_RECINTO) —
 * el estado exacto que ahora ingestarPosiciones() acepta para el tramo de ida.
 *
 * NO es parte del seed de la app — utilidad de un solo uso para medir
 * capacidad de la API (ver loadtest/README.md).
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import * as path from 'node:path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const prisma = new PrismaClient();

const OPERADOR_EMAIL = 'loadtest.ida@cne-imbabura.gob.ec';
const OPERADOR_PASSWORD = 'LoadT3s!';
const OPERADOR_CEDULA = '1799999998';

// Delegación de Imbabura (ver memoria cne_dpei_delegacion_coordenadas).
const DPI_LAT = 0.35849;
const DPI_LNG = -78.11886;

async function main() {
  const { hostname } = new URL(process.env.DATABASE_URL ?? '');
  if (!['localhost', '127.0.0.1'].includes(hostname)) {
    throw new Error(
      `DATABASE_URL apunta a "${hostname}", no a localhost. Aborta: este script es solo para DB local.`,
    );
  }

  const evento = await prisma.eventoElectoral.findFirst({ where: { estado: 'ACTIVO' } });
  if (!evento) {
    throw new Error(
      'No hay evento ACTIVO local. Corré primero seed-tracking-posiciones.ts (crea el evento sintético).',
    );
  }
  console.log(`✓ Evento activo: ${evento.id}`);

  const rolOperador = await prisma.rol.findUniqueOrThrow({ where: { nombre: 'OPERADOR_CDA' } });

  let operador = await prisma.usuario.findUnique({ where: { email: OPERADOR_EMAIL } });
  if (!operador) {
    const passwordHash = await argon2.hash(OPERADOR_PASSWORD);
    operador = await prisma.usuario.create({
      data: {
        email: OPERADOR_EMAIL,
        cedula: OPERADOR_CEDULA,
        nombres: 'Operador',
        apellidos: 'Load Test Ida',
        passwordHash,
        debeCambiarPwd: false,
        activo: true,
        roles: { create: [{ rolId: rolOperador.id }] },
      },
    });
  }
  console.log(`✓ Operador: ${operador.email}`);

  const existente = await prisma.eventoTracking.findFirst({
    where: { eventoId: evento.id, operadorId: operador.id, tipo: 'SALIDA_DPI' },
  });
  if (!existente) {
    await prisma.$executeRaw`
      INSERT INTO eventos_tracking (id, evento_id, operador_id, tipo, recinto_id, ubicacion, ocurrido_en, desde_offline, registrado_en)
      VALUES (
        uuid_generate_v4(), ${evento.id}::uuid, ${operador.id}::uuid, 'SALIDA_DPI'::tipo_tracking,
        NULL,
        ST_SetSRID(ST_MakePoint(${DPI_LNG}, ${DPI_LAT}), 4326)::geography,
        now(), false, now()
      );
    `;
    console.log('✓ EventoTracking SALIDA_DPI registrado (sin LLEGADA_RECINTO → estado EN_TRANSITO)');
  }

  console.log('\n--- Listo para el load test de ida ---');
  console.log(`EMAIL:    ${OPERADOR_EMAIL}`);
  console.log(`PASSWORD: ${OPERADOR_PASSWORD}`);
  console.log(`EVENTO:   ${evento.id}`);
}

main()
  .catch((e) => {
    console.error('✗ Error en loadtest-seed-ida:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
