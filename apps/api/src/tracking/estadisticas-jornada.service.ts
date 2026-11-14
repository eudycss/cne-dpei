import { Injectable } from '@nestjs/common';
import type { EstadisticasJornadaDto, RoleName } from '@cne/shared-types';
import { JornadaService } from '../enlaces/jornada/jornada.service';
import type { MomentoJornada, PersonaJornada } from '../enlaces/jornada/jornada';
import { PrismaService } from '../db/prisma.service';

const nombreDe = (personas: PersonaJornada[], rol: PersonaJornada['rol']) =>
  personas.find((p) => p.rol === rol)?.nombre ?? null;

/**
 * Datos de la pantalla de estadísticas de Monitoreo: una fila por pareja con la
 * hora de cada etapa y una por NO CDA con su llegada. Reutiliza la consulta de
 * la Jornada (la del bot) para no calcular dos veces técnico, cantón y etapas;
 * la web arma los gráficos y los porcentajes.
 */
@Injectable()
export class EstadisticasJornadaService {
  constructor(
    private readonly jornada: JornadaService,
    private readonly prisma: PrismaService,
  ) {}

  async estadisticas(viewerId: string, roles: RoleName[]): Promise<EstadisticasJornadaDto | null> {
    const j = await this.jornada.cargar();
    if (!j) return null;

    const veTodo = roles.includes('ADMINISTRADOR') || roles.includes('ANALISTA_PROVINCIAL') || roles.includes('LECTOR');
    let permitidos: Set<string> | null = null;
    if (!veTodo) {
      const asignados = await this.prisma.asignacionSupervisor.findMany({
        where: { eventoId: j.eventoId, supervisorId: viewerId },
        select: { operadorId: true },
      });
      permitidos = new Set(asignados.map((a) => a.operadorId));
    }

    const unidadesVisibles = j.unidades.filter((u) => !permitidos || permitidos.has(u.operadorId));
    const cdasVisibles = new Set(unidadesVisibles.map((u) => u.codigoRecinto));
    const iso = (u: (typeof j.unidades)[number], m: MomentoJornada) => u.registros[m]?.en.toISOString() ?? null;

    return {
      evento: j.evento,
      sinDistributivo: j.sinDistributivo,
      unidades: unidadesVisibles.map((u) => ({
        codigoRecinto: u.codigoRecinto,
        nombreRecinto: u.nombreRecinto,
        cantonNombre: u.canton.nombre,
        tecnicoNombre: u.tecnico.nombre,
        operadorNombre: nombreDe(u.personas, 'Op.'),
        asistenteNombre: nombreDe(u.personas, 'Asis.'),
        salidaDpiEn: iso(u, 'SALIDA_DPI'),
        llegadaRecintoEn: iso(u, 'LLEGADA_RECINTO'),
        salidaRecintoEn: iso(u, 'SALIDA_RECINTO'),
        llegadaDpiEn: iso(u, 'LLEGADA_DPI'),
      })),
      // Un NO CDA solo cuenta si su CDA lleva kit; y el supervisor solo ve los de sus CDAs.
      noCdas: j.noCdas
        .filter((n) => n.cdaConKit && (!permitidos || cdasVisibles.has(n.codigoCda)))
        .map((n) => ({
          codigoRecinto: n.codigoRecinto,
          nombreRecinto: n.nombreRecinto,
          codigoCda: n.codigoCda,
          nombreCda: n.nombreCda,
          cantonNombre: n.canton.nombre,
          tecnicoNombre: n.tecnico.nombre,
          llegadaEn: n.visita?.en.toISOString() ?? null,
        })),
    };
  }
}
