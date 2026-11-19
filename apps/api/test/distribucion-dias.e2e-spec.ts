import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import type { PrismaService } from '../src/db/prisma.service';
import type { DistributivoTecnicosClient } from '../src/enlaces/distributivo-tecnicos.client';
import { DistribucionDiasService } from '../src/operadores-cda/distribucion-dias.service';

/**
 * Distribución por días contra PostgreSQL real: el SQL de "última pareja"
 * (ANY(uuid[])), la cédula única por distribución, los CHECK de la migración y
 * el borrado en cascada. Requiere postgres levantado (pnpm db:up), migrado y
 * sembrado (cargos OPERADOR y DIGITADOR, recintos).
 */
function exigirBaseLocal(): void {
  const host = new URL(process.env.DATABASE_URL ?? '').hostname;
  if (!['localhost', '127.0.0.1', 'postgres', '::1'].includes(host)) {
    throw new Error(`distribucion-dias.e2e: DATABASE_URL apunta a "${host}", no a una base local. Abortado.`);
  }
}
exigirBaseLocal();

describe('distribución por días (PostgreSQL real)', () => {
  const prisma = new PrismaClient();
  const sufijo = String(Date.now()).slice(-6);
  const DIAS = ['2030-01-04', '2030-01-05', '2030-01-06'];
  const ids: { cda?: string; cpe?: string; pareja?: string; distribucion?: string } = {};
  let recinto: { id: string; codigoRecinto: string; canton: { nombre: string } };
  let service: DistribucionDiasService;

  beforeAll(async () => {
    recinto = await prisma.recinto.findFirstOrThrow({ select: { id: true, codigoRecinto: true, canton: { select: { nombre: true } } } });
    const cda = await prisma.operadorCda.create({
      data: { apellidosNombres: 'PRUEBA E2E CDA', cedula: `92${sufijo}01`, cargo: 'OPERADOR (e2e)', grupo: 'OPERADOR', sexo: 'M' },
    });
    const cpe = await prisma.operadorCda.create({
      data: { apellidosNombres: 'PRUEBA E2E CPE', cedula: `92${sufijo}02`, cargo: 'DIGITADOR (e2e)', grupo: 'DIGITADOR', sexo: 'F' },
    });
    ids.cda = cda.id;
    ids.cpe = cpe.id;
    // Dos parejas: cuenta la más reciente.
    await prisma.parejaCda.create({ data: { fecha: new Date('2029-12-01T00:00:00Z'), operadorCdaId: cda.id } });
    ids.pareja = (await prisma.parejaCda.create({ data: { fecha: new Date('2029-12-02T00:00:00Z'), recintoId: recinto.id, operadorCdaId: cda.id } })).id;
    const distributivo = {
      asignaciones: async () => [{ codigoRecinto: recinto.codigoRecinto, localidad: '', parroquia: '', numeroTecnico: 1, tecnico: 'Técnico E2E' }],
    };
    service = new DistribucionDiasService(prisma as unknown as PrismaService, distributivo as unknown as DistributivoTecnicosClient);
  });

  afterAll(async () => {
    if (ids.distribucion) await prisma.distribucionDias.deleteMany({ where: { id: ids.distribucion } });
    await prisma.parejaCda.deleteMany({ where: { operadorCdaId: ids.cda } });
    await prisma.operadorCda.deleteMany({ where: { id: { in: [ids.cda, ids.cpe].filter((x): x is string => !!x) } } });
    await prisma.$disconnect();
  });

  it('crea y reparte: el CDA toma cantón y técnico de su última pareja; el CPE, los de la distribución', async () => {
    const d = await service.crear(
      { nombre: 'E2E fin de semana', fechas: DIAS, excluirCargos: ['SUPERVISOR'], cantonCpe: 'IBARRA', encargadoCpe: 'Encargado CPE E2E' },
      undefined as unknown as string,
    );
    ids.distribucion = d.id;
    const cda = d.personas.find((p) => p.operadorId === ids.cda);
    const cpe = d.personas.find((p) => p.operadorId === ids.cpe);
    expect(cda).toMatchObject({ canton: recinto.canton.nombre, encargado: 'Técnico E2E', sexo: 'M', cargo: expect.any(String) });
    expect(cpe).toMatchObject({ canton: 'IBARRA', encargado: 'Encargado CPE E2E', sexo: 'F' });
    expect(DIAS).toContain(cda?.fecha);
    // Cada persona activa, una sola vez; los totales cuadran con las filas.
    expect(new Set(d.personas.map((p) => p.cedula)).size).toBe(d.personas.length);
    expect(d.totales.reduce((a, t) => a + t.total, 0)).toBe(d.personas.length);
  });

  it('no deja repetir una cédula; sí agrega a un externo y lo edita', async () => {
    const id = ids.distribucion as string;
    await expect(service.agregar(id, { tipo: 'REGISTRADA', fecha: DIAS[0], operadorId: ids.cda as string })).rejects.toBeInstanceOf(ConflictException);
    const ext = await service.agregar(id, {
      tipo: 'EXTERNA',
      fecha: DIAS[2],
      nombres: 'EXTERNA E2E',
      cedula: '1003456785',
      sexo: 'F',
      cargo: 'Apoyo',
      canton: undefined,
      encargado: 'Willy',
    });
    expect(ext).toMatchObject({ operadorId: null, nombres: 'EXTERNA E2E', canton: null, encargado: 'Willy' });
    const movida = await service.editar(id, ext.id, { fecha: DIAS[1], canton: 'OTAVALO' });
    expect(movida).toMatchObject({ fecha: DIAS[1], canton: 'OTAVALO' });
  });

  it('la base rechaza un externo sin nombre o sin sexo, y un sexo inválido', async () => {
    const base = { distribucionId: ids.distribucion as string, fecha: new Date(`${DIAS[0]}T00:00:00Z`) };
    await expect(prisma.distribucionDiasPersona.create({ data: { ...base, cedula: `93${sufijo}01`, sexo: 'F' } })).rejects.toThrow();
    await expect(prisma.distribucionDiasPersona.create({ data: { ...base, cedula: `93${sufijo}02`, nombres: 'X', sexo: 'Z' } })).rejects.toThrow();
  });

  it('el Excel y el PDF se generan con datos reales', async () => {
    const xlsx = await service.reporte(ids.distribucion as string, {}, 'xlsx');
    const pdf = await service.reporte(ids.distribucion as string, { fecha: DIAS[0] }, 'pdf');
    expect(xlsx.contenido.subarray(0, 2).toString()).toBe('PK');
    expect(pdf.contenido.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('borrar la distribución borra sus filas (cascada) y no toca al personal', async () => {
    const id = ids.distribucion as string;
    await service.eliminar(id);
    ids.distribucion = undefined;
    expect(await prisma.distribucionDiasPersona.count({ where: { distribucionId: id } })).toBe(0);
    expect(await prisma.operadorCda.count({ where: { id: { in: [ids.cda as string, ids.cpe as string] } } })).toBe(2);
  });
});
