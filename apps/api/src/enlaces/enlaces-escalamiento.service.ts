import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { ArchivoDriveNoConfigurado } from './drive-excel';
import { DistributivoTecnicosClient, tecnicosPorRecinto } from './distributivo-tecnicos.client';
import { codigosFueraDelBot, seMuestraEnBot } from './fuera-del-bot';
import { EncargadosRecintosClient, type EncargadoRecinto } from './encargados-recintos.client';
import { TelegramNotifier, type AlertaRecinto, type GrupoAlerta } from './telegram-notifier';

const MS_MINUTO = 60_000;
/**
 * Si no hay configuración guardada: primer aviso a las 2 h de caído y luego
 * cada 2 h. Se cambia desde la web (config_enlaces).
 */
export const MINUTOS_AVISO_POR_DEFECTO = 120;
const CONFIG_ID = 1;
/** El cron corre cada 5 min y no exactamente a la misma hora: sin este margen, 30 min se volverían 35. */
const MARGEN_MS = MS_MINUTO;
/** Caídas de la misma parroquia (o cantón) con menos de esto entre una y otra = posible corte de zona. */
export const VENTANA_ZONA_MS = 10 * MS_MINUTO;
/** Inestable: 3 o más caídas en 24 h, o 5 o más en 7 días. */
export const INESTABLE_24H = 3;
export const INESTABLE_7D = 5;

export function esInestable(caidas24h: number, caidas7d: number): boolean {
  return caidas24h >= INESTABLE_24H || caidas7d >= INESTABLE_7D;
}

const normalizarSector = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toUpperCase();

/** "P:" y "C:" separan parroquias de cantones: la parroquia urbana "Cotacachi" no se
 * junta con recintos sin parroquia del cantón Cotacachi. */
function claveSector(a: AlertaRecinto): string | null {
  if (a.parroquia.trim()) return `P:${normalizarSector(a.parroquia)}`;
  if (a.canton.trim()) return `C:${normalizarSector(a.canton)}`;
  return null;
}

/**
 * Junta en un "posible corte de zona" los recintos de la misma parroquia (o
 * cantón, si no hay parroquia) que se cayeron con menos de 10 min entre uno
 * y otro: lo más probable es un corte de energía o de fibra del sector, y
 * conviene un solo aviso en vez de uno por recinto. Primero las zonas, luego
 * los recintos sueltos, de más a menos tiempo caído.
 */
export function agruparPorZona(alertas: AlertaRecinto[]): GrupoAlerta[] {
  const porSector = new Map<string, AlertaRecinto[]>();
  const sueltos: AlertaRecinto[] = [];
  for (const a of alertas) {
    const clave = claveSector(a);
    if (!clave) sueltos.push(a);
    else porSector.set(clave, [...(porSector.get(clave) ?? []), a]);
  }

  const zonas: GrupoAlerta[] = [];
  for (const grupo of porSector.values()) {
    const ordenadas = [...grupo].sort((x, y) => x.inicio.getTime() - y.inicio.getTime());
    let actual: AlertaRecinto[] = [];
    const cerrar = () => {
      if (actual.length >= 2) zonas.push({ zona: actual[0].parroquia || actual[0].canton, recintos: actual });
      else sueltos.push(...actual);
      actual = [];
    };
    for (const a of ordenadas) {
      const ultimo = actual[actual.length - 1];
      if (ultimo && a.inicio.getTime() - ultimo.inicio.getTime() > VENTANA_ZONA_MS) cerrar();
      actual.push(a);
    }
    cerrar();
  }

  const porTiempo = (x: AlertaRecinto, y: AlertaRecinto) =>
    y.minutosCaido - x.minutosCaido || x.codigoRecinto.localeCompare(y.codigoRecinto);
  return [
    ...zonas
      .map((z) => ({ ...z, recintos: [...z.recintos].sort(porTiempo) }))
      .sort((x, y) => y.recintos.length - x.recintos.length),
    ...sueltos.sort(porTiempo).map((a) => ({ zona: null, recintos: [a] })),
  ];
}

/**
 * Escalamiento de enlaces caídos: en cada ciclo del cron busca las caídas
 * abiertas hace N min o más que no se avisaron en los últimos M min (N y M
 * configurables desde la web), y
 * manda un solo mensaje con el encargado de cada recinto (para llamarlo),
 * si es inestable y si parece un corte de zona.
 */
@Injectable()
export class EnlacesEscalamientoService {
  private readonly log = new Logger('EnlacesEscalamiento');
  /** Si un ciclo tarda más de 5 min (Drive o Telegram lentos), el siguiente no se solapa: duplicaría avisos. */
  private enCurso = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramNotifier,
    private readonly encargados: EncargadosRecintosClient,
    private readonly distributivo: DistributivoTecnicosClient,
  ) {}

  async escalar(ahora = new Date()): Promise<void> {
    if (this.enCurso) {
      this.log.warn('El escalamiento anterior sigue en curso — se omite este ciclo');
      return;
    }
    this.enCurso = true;
    try {
      const { minutosPrimerAviso, minutosRepetirAviso } = await this.frecuencia();
      const hace = (minutos: number) => new Date(ahora.getTime() - minutos * MS_MINUTO + MARGEN_MS);
      const pendientes = (
        await this.prisma.enlaceCaida.findMany({
          where: {
            fin: null,
            codigoRecinto: { notIn: codigosFueraDelBot() },
            inicio: { lte: hace(minutosPrimerAviso) },
            OR: [{ ultimoAviso: null }, { ultimoAviso: { lte: hace(minutosRepetirAviso) } }],
          },
          select: { id: true, codigoRecinto: true, nombreRecinto: true, canton: true, inicio: true, avisos: true },
          orderBy: { inicio: 'asc' },
        })
      ).filter((p) => seMuestraEnBot(p.codigoRecinto));
      if (pendientes.length === 0) return;

      const codigos = pendientes.map((p) => p.codigoRecinto);
      const hace24h = ahora.getTime() - 24 * 60 * MS_MINUTO;
      const [historial, encargados, distributivo] = await Promise.all([
        this.prisma.enlaceCaida.findMany({
          where: { codigoRecinto: { in: codigos }, inicio: { gte: new Date(ahora.getTime() - 7 * 24 * 60 * MS_MINUTO) } },
          select: { codigoRecinto: true, inicio: true },
        }),
        this.leerEncargados(),
        this.leerDistributivo(),
      ]);
      const { parroquias, tecnicos } = distributivo;

      const alertas: AlertaRecinto[] = pendientes.map((p) => {
        const propias = historial.filter((h) => h.codigoRecinto === p.codigoRecinto);
        const caidas24h = propias.filter((h) => h.inicio.getTime() >= hace24h).length;
        return {
          codigoRecinto: p.codigoRecinto,
          nombreRecinto: p.nombreRecinto,
          canton: p.canton ?? '',
          parroquia: parroquias.get(p.codigoRecinto) ?? '',
          inicio: p.inicio,
          minutosCaido: Math.round((ahora.getTime() - p.inicio.getTime()) / MS_MINUTO),
          aviso: p.avisos + 1,
          caidas24h,
          caidas7d: propias.length,
          inestable: esInestable(caidas24h, propias.length),
          encargado: encargados.get(p.codigoRecinto) ?? null,
          tecnico: tecnicos.get(p.codigoRecinto) ?? null,
        };
      });

      // Se marca ANTES de enviar: si la base falla, no sale nada y el siguiente ciclo
      // reintenta; al revés, un fallo al marcar repetiría el aviso cada 5 min.
      await this.prisma.enlaceCaida.updateMany({
        where: { id: { in: pendientes.map((p) => p.id) } },
        data: { ultimoAviso: ahora, avisos: { increment: 1 } },
      });
      await this.telegram.enviarEscalamiento(agruparPorZona(alertas));
    } catch (e) {
      // El escalamiento nunca frena el resto del cron; el siguiente ciclo lo reintenta.
      this.log.error(`No se pudo escalar los enlaces caídos: ${(e as Error)?.message ?? e}`);
    } finally {
      this.enCurso = false;
    }
  }

  /** La frecuencia guardada desde la web; sin fila (base recién creada), la de por defecto. */
  private async frecuencia(): Promise<{ minutosPrimerAviso: number; minutosRepetirAviso: number }> {
    const config = await this.prisma.configEnlaces.findUnique({
      where: { id: CONFIG_ID },
      select: { minutosPrimerAviso: true, minutosRepetirAviso: true },
    });
    return {
      minutosPrimerAviso: config?.minutosPrimerAviso ?? MINUTOS_AVISO_POR_DEFECTO,
      minutosRepetirAviso: config?.minutosRepetirAviso ?? MINUTOS_AVISO_POR_DEFECTO,
    };
  }

  /** Sin el archivo de encargados el aviso sale igual, con "Encargado: sin registrar". */
  private async leerEncargados(): Promise<Map<string, EncargadoRecinto>> {
    try {
      return await this.encargados.encargados();
    } catch (e) {
      if (!(e instanceof ArchivoDriveNoConfigurado)) {
        this.log.warn(`No se pudieron leer los encargados de recintos: ${(e as Error)?.message ?? e}`);
      }
      return new Map();
    }
  }

  /** Del distributivo: la parroquia de cada recinto (agrupa por sector) y su técnico.
   * Si falla, se agrupa por cantón y el técnico sale "sin asignar". */
  private async leerDistributivo(): Promise<{ parroquias: Map<string, string>; tecnicos: Map<string, string> }> {
    try {
      const asignaciones = await this.distributivo.asignaciones();
      return {
        parroquias: new Map<string, string>(
          asignaciones.filter((a) => a.parroquia).map((a) => [a.codigoRecinto, a.parroquia]),
        ),
        tecnicos: tecnicosPorRecinto(asignaciones),
      };
    } catch (e) {
      if (!(e instanceof ArchivoDriveNoConfigurado)) {
        this.log.warn(`No se pudo leer el distributivo, se agrupa por cantón: ${(e as Error)?.message ?? e}`);
      }
      return { parroquias: new Map(), tecnicos: new Map() };
    }
  }
}
