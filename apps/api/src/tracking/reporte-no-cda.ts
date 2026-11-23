import type { ReporteNoCdaDetalle, ReporteNoCdaItem } from '@cne/shared-types';
import { CDA_ID_DELEGACION, CODIGO_DELEGACION, NOMBRE_DELEGACION } from '@cne/shared-validation';

/** Datos mínimos de un recinto (CDA o NO CDA) para el reporte de llegadas. */
export interface RecintoLlegada {
  id: string;
  codigoRecinto: string;
  nombre: string;
  cantonNombre: string;
  cdaDestinoId: string | null;
  juntasFemeninas: number | null;
  juntasMasculinas: number | null;
  numeroElectores: number | null;
}

export interface UsuarioLlegada {
  id: string;
  nombres: string;
  apellidos: string;
  cedula: string;
}

/** Una marca LLEGADA_NO_CDA del operador del CDA. */
export interface MarcaLlegadaNoCda {
  recintoId: string | null;
  operadorId: string;
  ocurridoEn: Date;
}

export interface EntradaReporteNoCda {
  /** Solo los CDA con operador en el evento activo, en el orden del reporte. */
  cdas: RecintoLlegada[];
  operadorPorCda: ReadonlyMap<string, string>;
  kitsPorCda: ReadonlyMap<string, string[]>;
  noCdas: RecintoLlegada[];
  /** NO CDA sin CDA de destino: van al final como el grupo de la Delegación. */
  noCdasDelegacion?: RecintoLlegada[];
  /** Los operadores de los CDA y quienes marcaron llegadas. */
  usuarios: UsuarioLlegada[];
  llegadas: MarcaLlegadaNoCda[];
}

const nombreCompleto = (u: UsuarioLlegada) => `${u.nombres} ${u.apellidos}`;

/**
 * Arma el reporte "¿qué NO CDA ya llegaron a su CDA?": por cada CDA sus NO
 * CDA con juntas, electores y la PRIMERA marca de llegada (repetir la marca
 * no cambia la hora). Los NO CDA van en el orden en que llegan en `noCdas`.
 */
export function armarReporteNoCda(entrada: EntradaReporteNoCda): ReporteNoCdaItem[] {
  // Genéricos explícitos: sin ellos la CI (sin `prisma generate`) infiere Map<unknown, unknown>.
  const usuarioPorId = new Map<string, UsuarioLlegada>(entrada.usuarios.map((u) => [u.id, u]));

  const primeraLlegada = new Map<string, MarcaLlegadaNoCda>();
  for (const l of entrada.llegadas) {
    if (!l.recintoId) continue;
    const previa = primeraLlegada.get(l.recintoId);
    if (!previa || l.ocurridoEn < previa.ocurridoEn) primeraLlegada.set(l.recintoId, l);
  }

  const noCdasPorCda = new Map<string, RecintoLlegada[]>();
  for (const nc of entrada.noCdas) {
    if (!nc.cdaDestinoId) continue;
    const lista = noCdasPorCda.get(nc.cdaDestinoId) ?? [];
    lista.push(nc);
    noCdasPorCda.set(nc.cdaDestinoId, lista);
  }

  const detalleDe = (lista: RecintoLlegada[]) => lista.map((nc) => detalleNoCda(nc, primeraLlegada.get(nc.id), usuarioPorId));
  const totales = (detalle: ReporteNoCdaDetalle[]) => {
    const llegados = detalle.filter((d) => d.llegado);
    return {
      totalNoCdas: detalle.length,
      totalLlegados: llegados.length,
      juntasNoCdas: sumaJuntas(detalle),
      juntasLlegadas: sumaJuntas(llegados),
      noCdas: detalle,
    };
  };

  const items: ReporteNoCdaItem[] = entrada.cdas.map((cda) => {
    const operadorId = entrada.operadorPorCda.get(cda.id);
    const operador = operadorId ? usuarioPorId.get(operadorId) : undefined;
    return {
      cdaId: cda.id,
      cdaCodigo: cda.codigoRecinto,
      cdaNombre: cda.nombre,
      cantonNombre: cda.cantonNombre,
      operadorNombre: operador ? nombreCompleto(operador) : 'Operador',
      operadorCedula: operador?.cedula ?? '—',
      kitsCodigos: entrada.kitsPorCda.get(cda.id) ?? [],
      ...totales(detalleDe(noCdasPorCda.get(cda.id) ?? [])),
    };
  });

  const directos = entrada.noCdasDelegacion ?? [];
  if (directos.length > 0) {
    items.push({
      cdaId: CDA_ID_DELEGACION,
      cdaCodigo: CODIGO_DELEGACION,
      cdaNombre: NOMBRE_DELEGACION,
      cantonNombre: 'IBARRA',
      // Lo marca quien recibe en la Delegación (sale en cada NO CDA como "marcó…").
      operadorNombre: '—',
      operadorCedula: '—',
      kitsCodigos: [],
      ...totales(detalleDe(directos)),
      esDelegacion: true,
    });
  }
  return items;
}

function detalleNoCda(
  nc: RecintoLlegada,
  llegada: MarcaLlegadaNoCda | undefined,
  usuarioPorId: ReadonlyMap<string, UsuarioLlegada>,
): ReporteNoCdaDetalle {
  const juntasFemeninas = nc.juntasFemeninas ?? 0;
  const juntasMasculinas = nc.juntasMasculinas ?? 0;
  const quien = llegada ? usuarioPorId.get(llegada.operadorId) : undefined;
  return {
    id: nc.id,
    codigoRecinto: nc.codigoRecinto,
    nombre: nc.nombre,
    cantonNombre: nc.cantonNombre,
    juntasFemeninas,
    juntasMasculinas,
    juntas: juntasFemeninas + juntasMasculinas,
    electores: nc.numeroElectores ?? 0,
    llegado: llegada !== undefined,
    llegadaEn: llegada ? llegada.ocurridoEn.toISOString() : null,
    registradoPor: llegada ? (quien ? nombreCompleto(quien) : 'Operador') : null,
  };
}

const sumaJuntas = (lista: ReporteNoCdaDetalle[]) => lista.reduce((total, d) => total + d.juntas, 0);
