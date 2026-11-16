import { Injectable } from '@nestjs/common';
import type { CoordenadasRecintos } from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';
import {
  MIN_MARCAS_COORDENADA,
  UMBRAL_COORDENADA_METROS,
  analizarCoordenadas,
  type MarcaRecinto,
} from './coordenadas-recintos';

/**
 * Compara la coordenada guardada de cada recinto con dónde marcó realmente el
 * personal la llegada y la salida del recinto. Solo lectura: sirve para ver qué
 * coordenadas del distributivo están desplazadas y corregirlas en el Excel.
 */
@Injectable()
export class CoordenadasRecintosService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(umbralMetros = UMBRAL_COORDENADA_METROS): Promise<CoordenadasRecintos> {
    const [recintos, filas] = await Promise.all([
      this.prisma.$queryRaw<
        { id: string; codigo: string; nombre: string; canton: string; lat: number; lng: number }[]
      >`
        SELECT r.id::text AS id, r.codigo_recinto AS codigo, r.nombre, c.nombre AS canton,
               ST_Y(r.ubicacion::geometry) AS lat, ST_X(r.ubicacion::geometry) AS lng
        FROM recintos r JOIN cantones c ON c.id = r.canton_id
        WHERE r.activo AND r.ubicacion IS NOT NULL;
      `,
      // Registros manuales (motivo_manual) llevan la ubicación de quien los capturó en la web, no la del recinto.
      this.prisma.$queryRaw<{ recintoId: string; lat: number; lng: number; metros: number }[]>`
        SELECT et.recinto_id::text AS "recintoId",
               ST_Y(et.ubicacion::geometry) AS lat, ST_X(et.ubicacion::geometry) AS lng,
               ST_Distance(r.ubicacion, et.ubicacion::geography) AS metros
        FROM eventos_tracking et JOIN recintos r ON r.id = et.recinto_id
        WHERE et.tipo IN ('LLEGADA_RECINTO', 'SALIDA_RECINTO')
          AND et.motivo_manual IS NULL
          AND et.ubicacion IS NOT NULL AND r.ubicacion IS NOT NULL;
      `,
    ]);
    const marcas = new Map<string, MarcaRecinto[]>();
    for (const f of filas) {
      const lista = marcas.get(f.recintoId) ?? [];
      lista.push({ lat: Number(f.lat), lng: Number(f.lng), metros: Number(f.metros) });
      marcas.set(f.recintoId, lista);
    }
    return {
      umbralMetros,
      minMarcas: MIN_MARCAS_COORDENADA,
      recintos: analizarCoordenadas(
        recintos.map((r) => ({ ...r, lat: Number(r.lat), lng: Number(r.lng) })),
        marcas,
        umbralMetros,
      ),
    };
  }
}
