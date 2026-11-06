import type { PrismaService } from '../db/prisma.service';
import { diaDeFechaDb, fechaDb } from './dia-ecuador';

/**
 * Quién está convocado cada día. Una persona del personal CDA o CPE está
 * convocada si se la marcó en la Convocatoria de esa fecha o si está en
 * Parejas ese día (operador, asistente o reserva). Solo los convocados
 * pueden tener falta; un día sin nadie convocado no tiene faltas.
 */
export class Convocados {
  constructor(
    private readonly porPareja: Map<string, Set<string>>,
    private readonly aMano: Map<string, Set<string>>,
  ) {}

  /** ¿`operadorId` estaba convocado el `dia` (AAAA-MM-DD)? */
  es(dia: string, operadorId: string): boolean {
    return this.esPorPareja(dia, operadorId) || !!this.aMano.get(dia)?.has(operadorId);
  }

  /** Todos los convocados de ese día (Parejas y a mano). */
  delDia(dia: string): Set<string> {
    return new Set([...(this.porPareja.get(dia) ?? []), ...(this.aMano.get(dia) ?? [])]);
  }

  /** Convocado a mano (en la Convocatoria) ese día. */
  esAMano(dia: string, operadorId: string): boolean {
    return !!this.aMano.get(dia)?.has(operadorId);
  }

  /** Convocado por estar en Parejas ese día (no se quita desde la Convocatoria). */
  esPorPareja(dia: string, operadorId: string): boolean {
    return !!this.porPareja.get(dia)?.has(operadorId);
  }
}

function agregar(mapa: Map<string, Set<string>>, dia: string, id: string | null) {
  if (!id) return;
  const ids = mapa.get(dia) ?? new Set<string>();
  ids.add(id);
  mapa.set(dia, ids);
}

/** Convocados de los días [desde, hasta] (AAAA-MM-DD, ambos incluidos). */
export async function convocadosEntre(prisma: PrismaService, desde: string, hasta: string): Promise<Convocados> {
  const fecha = { gte: fechaDb(desde), lte: fechaDb(hasta) };
  const [parejas, aMano] = await Promise.all([
    prisma.parejaCda.findMany({ where: { fecha }, select: { fecha: true, operadorCdaId: true, asistenteCdaId: true } }),
    prisma.convocatoriaCda.findMany({ where: { fecha }, select: { fecha: true, operadorId: true } }),
  ]);
  const porPareja = new Map<string, Set<string>>();
  for (const p of parejas) {
    const dia = diaDeFechaDb(p.fecha);
    agregar(porPareja, dia, p.operadorCdaId);
    agregar(porPareja, dia, p.asistenteCdaId);
  }
  const manual = new Map<string, Set<string>>();
  for (const c of aMano) agregar(manual, diaDeFechaDb(c.fecha), c.operadorId);
  return new Convocados(porPareja, manual);
}
