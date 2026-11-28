import type { LlegadaDpeiCda, ReporteLlegadaDpei, ResumenLlegadaDpei } from '@cne/shared-types';
import { duracionTexto, horaConDia, registroLlegadaTexto } from '@cne/shared-validation';

import { llegadaDpeiDe, type Jornada, type UnidadJornada } from '../enlaces/jornada/jornada';
import { diaCorto, type ColumnaReporte, type ReporteCda } from '../operadores-cda/reporte-cda';

/**
 * Reporte de llegadas de los CDA a la DPEI (lógica pura sobre la Jornada del bot,
 * así la web, el Excel/PDF y el grupo de Telegram dan las mismas cifras).
 * Una fila por CDA: la primera salida del recinto de sus parejas y la llegada de
 * la última. La llegada de cada pareja es la del bot: la marcada en la app o la
 * recepción de su kit en la DPEI. Sin noción de atraso: los CDA salen entre las
 * 21:00 y las 02:00, así que solo se muestran horas y duración.
 */

const MINUTO = 60_000;

function minimo(fechas: (Date | undefined)[]): Date | null {
  const t = fechas.filter((f): f is Date => !!f).map((f) => f.getTime());
  return t.length ? new Date(Math.min(...t)) : null;
}

function operadoresDe(us: UnidadJornada[]): string[] {
  const nombres = us.flatMap((u) => {
    const ops = u.personas.filter((p) => p.rol === 'Op.');
    return (ops.length ? ops : u.personas).map((p) => p.nombre);
  });
  return [...new Set(nombres)];
}

function filaCda(us: UnidadJornada[]): LlegadaDpeiCda {
  const llegadas = us.map((u) => llegadaDpeiDe(u));
  const salida = minimo(us.map((u) => u.registros.SALIDA_RECINTO?.en));
  const completo = llegadas.every(Boolean);
  const llegada = completo ? new Date(Math.max(...llegadas.map((l) => l!.registro.en.getTime()))) : null;
  const duracionMin = salida && llegada && llegada >= salida ? Math.round((llegada.getTime() - salida.getTime()) / MINUTO) : null;
  return {
    codigoRecinto: us[0].codigoRecinto,
    nombreRecinto: us[0].nombreRecinto,
    cantonNombre: us[0].canton.nombre,
    operadores: operadoresDe(us),
    kits: [...new Set(us.flatMap((u) => u.kits ?? []))],
    parejas: us.length,
    parejasLlegadas: llegadas.filter(Boolean).length,
    salidaRecintoEn: salida?.toISOString() ?? null,
    llegadaDpiEn: llegada?.toISOString() ?? null,
    duracionMin,
    manual: llegadas.some((l) => !!l && !l.porKit && l.registro.manual === true),
    porKit: llegadas.some((l) => !!l?.porKit),
  };
}

const porCodigo = (a: LlegadaDpeiCda, b: LlegadaDpeiCda) =>
  a.codigoRecinto.localeCompare(b.codigoRecinto, 'es', { numeric: true });

/** Compara horas ISO; las nulas van al final. */
function porHora(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/** Primero los que faltan (salieron hace más, arriba) y luego los que llegaron, por hora de llegada. */
export function llegadasPorCda(j: Jornada): LlegadaDpeiCda[] {
  const porRecinto = new Map<string, UnidadJornada[]>();
  for (const u of j.unidades) porRecinto.set(u.codigoRecinto, [...(porRecinto.get(u.codigoRecinto) ?? []), u]);
  const filas = [...porRecinto.values()].map(filaCda);
  const faltan = filas.filter((f) => !f.llegadaDpiEn).sort((a, b) => porHora(a.salidaRecintoEn, b.salidaRecintoEn) || porCodigo(a, b));
  const llegaron = filas.filter((f) => f.llegadaDpiEn).sort((a, b) => porHora(a.llegadaDpiEn, b.llegadaDpiEn) || porCodigo(a, b));
  return [...faltan, ...llegaron];
}

export function resumenLlegadas(cdas: LlegadaDpeiCda[]): ResumenLlegadaDpei {
  const horas = cdas.map((c) => c.llegadaDpiEn).filter((h): h is string => !!h).sort();
  const duraciones = cdas.map((c) => c.duracionMin).filter((d): d is number => d !== null);
  return {
    total: cdas.length,
    llegaron: horas.length,
    faltan: cdas.length - horas.length,
    primeraLlegadaEn: horas[0] ?? null,
    ultimaLlegadaEn: horas[horas.length - 1] ?? null,
    duracionPromedioMin: duraciones.length ? Math.round(duraciones.reduce((s, d) => s + d, 0) / duraciones.length) : null,
  };
}

export function reporteLlegadaDpei(j: Jornada, fecha: string): ReporteLlegadaDpei {
  const cdas = llegadasPorCda(j);
  return { evento: j.evento, fecha, resumen: resumenLlegadas(cdas), cdas };
}

// ─── Excel y PDF (horas y duración con los formatos compartidos con la web) ──

const COLUMNAS: ColumnaReporte[] = [
  { titulo: 'N°', ancho: 5 },
  { titulo: 'Cantón', ancho: 14 },
  { titulo: 'Código', ancho: 9 },
  { titulo: 'CDA', ancho: 34 },
  { titulo: 'Operador(es)', ancho: 34 },
  { titulo: 'Kits', ancho: 16 },
  { titulo: 'Parejas', ancho: 10 },
  { titulo: 'Salida del recinto', ancho: 15 },
  { titulo: 'Llegada a la DPEI', ancho: 15 },
  { titulo: 'Duración', ancho: 12 },
  { titulo: 'Registro', ancho: 18 },
];

export function archivoLlegadaDpei(r: ReporteLlegadaDpei): ReporteCda {
  const s = r.resumen;
  return {
    titulo: 'REPORTE DE LLEGADA DE LOS CDA A LA DPEI',
    detalle: `${r.evento} · Jornada del ${diaCorto(r.fecha)} · Llegaron ${s.llegaron} de ${s.total} CDA · Faltan ${s.faltan}`,
    archivo: 'llegada_dpei_cdas',
    desde: r.fecha,
    hasta: r.fecha,
    modo: 'GENERAL',
    limitarDiasPdf: false,
    unaFecha: true,
    tablas: [
      {
        hoja: 'Llegada a la DPEI',
        titulo: 'Llegada de los CDA a la DPEI',
        columnas: COLUMNAS,
        filas: r.cdas.map((c, i) => [
          i + 1,
          c.cantonNombre,
          c.codigoRecinto,
          c.nombreRecinto,
          c.operadores.join(', ') || '—',
          c.kits.join(', ') || '—',
          `${c.parejasLlegadas} de ${c.parejas}`,
          horaConDia(c.salidaRecintoEn),
          c.llegadaDpiEn ? horaConDia(c.llegadaDpiEn) : 'Falta',
          duracionTexto(c.duracionMin),
          registroLlegadaTexto(c),
        ]),
        // Los que faltan, en rojo claro.
        resaltadas: r.cdas.flatMap((c, i) => (c.llegadaDpiEn ? [] : [i])),
        anexo: {
          titulo: 'Resumen',
          columnas: [
            { titulo: 'Dato', ancho: 34 },
            { titulo: 'Valor', ancho: 20 },
          ],
          filas: [
            ['CDA con kit', s.total],
            ['Llegaron a la DPEI', s.llegaron],
            ['Faltan', s.faltan],
            ['Primera llegada', horaConDia(s.primeraLlegadaEn)],
            ['Última llegada', horaConDia(s.ultimaLlegadaEn)],
            ['Duración promedio (salida → llegada)', duracionTexto(s.duracionPromedioMin)],
          ],
        },
      },
    ],
  };
}
