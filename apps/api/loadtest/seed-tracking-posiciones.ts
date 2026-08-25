/**
 * Seed de datos para el load test de POST /tracking/posiciones.
 * NO es parte del seed de la app — es una utilidad de un solo uso para
 * medir capacidad de la API (ver conversación / loadtest/README).
 *
 * Crea (idempotente, prefijo LOADTEST):
 *  - Un EventoElectoral ACTIVO propio (falla si ya hay otro ACTIVO real,
 *    para no romper la regla de "un solo evento activo" del sistema).
 *  - Un Recinto CDA con ubicación.
 *  - Un Usuario OPERADOR_CDA con contraseña conocida.
 *  - Un KitElectoral ENTREGADO + RecepcionKit para ese operador.
 *  - EventoTracking: SALIDA_DPI, LLEGADA_RECINTO, SALIDA_RECINTO
 *    (sin LLEGADA_DPI) — el estado exacto que exige ingestarPosiciones().
 *
 * Imprime al final el email/password del operador y el eventoId para
 * poder loguearse y correr el load test.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import * as path from 'node:path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const prisma = new PrismaClient();

const OPERADOR_EMAIL = 'loadtest.operador@cne-imbabura.gob.ec';
const OPERADOR_PASSWORD = 'LoadT3s!';
const OPERADOR_CEDULA = '1799999999';
const RECINTO_CODIGO = 'LOADTEST-CDA-01';
const KIT_CODIGO = 'LOADTEST-KIT-01';

// Delegación de Imbabura (ver memoria cne_dpei_delegacion_coordenadas) con un
// pequeño offset para que el recinto no coincida exactamente con el DPI real.
const RECINTO_LAT = 0.361;
const RECINTO_LNG = -78.115;

async function main() {
  // Salvaguarda: este script inserta filas sintéticas (kit LOADTEST, tracking
  // falso) — solo debe correr contra la DB local de pruebas (docker
  // cne_postgres), nunca contra Supabase/producción.
  const { hostname } = new URL(process.env.DATABASE_URL ?? '');
  if (!['localhost', '127.0.0.1'].includes(hostname)) {
    throw new Error(
      `DATABASE_URL apunta a "${hostname}", no a localhost. Aborta: este script es solo para DB local.`,
    );
  }

  const eventoExistenteActivo = await prisma.eventoElectoral.findFirst({
    where: { estado: 'ACTIVO' },
  });

  const canton = await prisma.canton.findFirstOrThrow();
  const rolOperador = await prisma.rol.findUniqueOrThrow({ where: { nombre: 'OPERADOR_CDA' } });

  const evento =
    eventoExistenteActivo ??
    (await prisma.eventoElectoral.create({
      data: {
        nombre: 'LOADTEST - evento sintético',
        tipo: 'ELECCIONES_SECCIONALES',
        fechaJornada: new Date(),
        estado: 'ACTIVO',
      },
    }));
  console.log(`✓ Evento activo: ${evento.id}`);

  let recinto = await prisma.recinto.findUnique({ where: { codigoRecinto: RECINTO_CODIGO } });
  if (!recinto) {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO recintos (id, codigo_recinto, nombre, canton_id, tipo, ubicacion, tiene_internet, cobertura_movil, es_dificil_acceso)
      VALUES (
        uuid_generate_v4(), ${RECINTO_CODIGO}, 'CDA Load Test', ${canton.id}, 'CDA'::tipo_recinto,
        ST_SetSRID(ST_MakePoint(${RECINTO_LNG}, ${RECINTO_LAT}), 4326)::geography,
        true, true, false
      )
      RETURNING id;
    `;
    recinto = await prisma.recinto.findUniqueOrThrow({ where: { id: rows[0].id } });
  }
  console.log(`✓ Recinto CDA: ${recinto.id}`);

  let operador = await prisma.usuario.findUnique({ where: { email: OPERADOR_EMAIL } });
  if (!operador) {
    const passwordHash = await argon2.hash(OPERADOR_PASSWORD);
    operador = await prisma.usuario.create({
      data: {
        email: OPERADOR_EMAIL,
        cedula: OPERADOR_CEDULA,
        nombres: 'Operador',
        apellidos: 'Load Test',
        passwordHash,
        debeCambiarPwd: false,
        activo: true,
        roles: { create: [{ rolId: rolOperador.id }] },
      },
    });
  }
  console.log(`✓ Operador: ${operador.email}`);

  let kit = await prisma.kitElectoral.findUnique({
    where: { eventoId_codigoUnico: { eventoId: evento.id, codigoUnico: KIT_CODIGO } },
  });
  if (!kit) {
    kit = await prisma.kitElectoral.create({
      data: {
        eventoId: evento.id,
        codigoUnico: KIT_CODIGO,
        qrPayload: KIT_CODIGO,
        nombre: 'Kit Load Test',
        recintoId: recinto.id,
        operadorId: operador.id,
        estado: 'ENTREGADO',
      },
    });
  } else if (kit.estado !== 'ENTREGADO' || kit.operadorId !== operador.id) {
    kit = await prisma.kitElectoral.update({
      where: { id: kit.id },
      data: { estado: 'ENTREGADO', operadorId: operador.id, recintoId: recinto.id },
    });
  }
  console.log(`✓ Kit entregado: ${kit.codigoUnico}`);

  const yaRecibido = await prisma.recepcionKit.findFirst({
    where: { kitId: kit.id, operadorId: operador.id },
  });
  if (!yaRecibido) {
    await prisma.$executeRaw`
      INSERT INTO recepciones_kit (id, kit_id, operador_id, ubicacion, confirmado_en, desde_offline)
      VALUES (
        uuid_generate_v4(), ${kit.id}::uuid, ${operador.id}::uuid,
        ST_SetSRID(ST_MakePoint(${RECINTO_LNG}, ${RECINTO_LAT}), 4326)::geography,
        now(), false
      );
    `;
    console.log('✓ RecepcionKit registrada');
  }

  const tiposNecesarios = ['SALIDA_DPI', 'LLEGADA_RECINTO', 'SALIDA_RECINTO'] as const;
  for (const tipo of tiposNecesarios) {
    const existente = await prisma.eventoTracking.findFirst({
      where: { eventoId: evento.id, operadorId: operador.id, tipo },
    });
    if (existente) continue;
    await prisma.$executeRaw`
      INSERT INTO eventos_tracking (id, evento_id, operador_id, tipo, recinto_id, ubicacion, ocurrido_en, desde_offline, registrado_en)
      VALUES (
        uuid_generate_v4(), ${evento.id}::uuid, ${operador.id}::uuid, ${tipo}::tipo_tracking,
        ${recinto.id}::uuid,
        ST_SetSRID(ST_MakePoint(${RECINTO_LNG}, ${RECINTO_LAT}), 4326)::geography,
        now(), false, now()
      );
    `;
    console.log(`✓ EventoTracking ${tipo} registrado`);
  }

  console.log('\n--- Listo para el load test ---');
  console.log(`EMAIL:    ${OPERADOR_EMAIL}`);
  console.log(`PASSWORD: ${OPERADOR_PASSWORD}`);
  console.log(`EVENTO:   ${evento.id}`);
  console.log(`RECINTO:  lat=${RECINTO_LAT} lng=${RECINTO_LNG}`);
}

main()
  .catch((e) => {
    console.error('✗ Error en loadtest-seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
