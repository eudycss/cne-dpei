import type {
  DispositivoCda,
  GrupoCda,
  HistorialParejasCda,
  PersonaHistorialCda,
  RecintoHistorialCda,
  VisitaHistorialCda,
} from '@cne/shared-types';

import { type Celda, type ReporteCda, diaCorto } from './reporte-cda';

/**
 * Historial de parejas de las fechas elegidas: quién fue (estuvo en una
 * pareja ese día) y quién no, y qué recintos CDA se visitaron, con la pareja
 * y el kit de cada visita. Base para armar la siguiente prueba técnica.
 */

export interface PersonaBase {
  id: string;
  apellidosNombres: string;
  cedula: string;
  grupo: GrupoCda;
  dispositivo: string | null;
  activo: boolean;
}

export interface RecintoBase {
  id: string;
  codigoRecinto: string;
  nombre: string;
  canton: { nombre: string } | null;
}

type PersonaDeVisita = PersonaBase & { usuarioId: string | null };

export interface ParejaBase {
  fecha: string;
  recinto: RecintoBase;
  operador: PersonaDeVisita;
  asistente: PersonaDeVisita | null;
  /** operadorId del kit = id de la cuenta (Usuario) que lo tiene asignado. */
  kit: { codigoUnico: string; operadorId: string | null } | null;
}

/** La columna es VARCHAR con CHECK: solo puede traer ANDROID, IPHONE o null. */
const dispositivo = (d: string | null): DispositivoCda | null => (d === 'ANDROID' || d === 'IPHONE' ? d : null);

const etiquetaRecinto = (r: RecintoBase) => `${r.codigoRecinto} · ${r.nombre}`;

function llevaKit(p: ParejaBase): string | null {
  const titular = p.kit?.operadorId;
  if (!titular) return null;
  return [p.operador, p.asistente].find((x) => x?.usuarioId === titular)?.apellidosNombres ?? null;
}

/**
 * `personas` y `recintos`: los activos de hoy. Quien estuvo en una pareja y
 * hoy está oculto (o cambió de cargo) aparece igual, para no perder la visita.
 */
export function armarHistorial(
  fechas: string[],
  personas: PersonaBase[],
  recintos: RecintoBase[],
  parejas: ParejaBase[],
): HistorialParejasCda {
  const porPersona = new Map<string, PersonaHistorialCda>();
  const agregarPersona = (p: PersonaBase) => {
    if (!porPersona.has(p.id)) {
      porPersona.set(p.id, {
        id: p.id,
        apellidosNombres: p.apellidosNombres,
        cedula: p.cedula,
        grupo: p.grupo,
        dispositivo: dispositivo(p.dispositivo),
        activo: p.activo,
        fechas: [],
        recintos: [],
      });
    }
    return porPersona.get(p.id)!;
  };
  const porRecinto = new Map<string, RecintoHistorialCda>();
  const agregarRecinto = (r: RecintoBase) => {
    if (!porRecinto.has(r.id)) {
      porRecinto.set(r.id, { id: r.id, codigo: r.codigoRecinto, nombre: r.nombre, canton: r.canton?.nombre ?? '', visitas: [] });
    }
    return porRecinto.get(r.id)!;
  };
  personas.forEach(agregarPersona);
  recintos.forEach(agregarRecinto);

  const ordenadas = [...parejas].sort((a, b) => a.fecha.localeCompare(b.fecha));
  for (const p of ordenadas) {
    const visita: VisitaHistorialCda = {
      fecha: p.fecha,
      operador: p.operador.apellidosNombres,
      asistente: p.asistente?.apellidosNombres ?? null,
      kitCodigo: p.kit?.codigoUnico ?? null,
      llevaKit: llevaKit(p),
    };
    agregarRecinto(p.recinto).visitas.push(visita);
    for (const x of [p.operador, p.asistente]) {
      if (!x) continue;
      const h = agregarPersona(x);
      if (!h.fechas.includes(p.fecha)) h.fechas.push(p.fecha);
      const r = etiquetaRecinto(p.recinto);
      if (!h.recintos.includes(r)) h.recintos.push(r);
    }
  }

  return {
    fechas,
    personas: [...porPersona.values()].sort((a, b) => a.apellidosNombres.localeCompare(b.apellidosNombres, 'es')),
    recintos: [...porRecinto.values()].sort(
      (a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }) || a.nombre.localeCompare(b.nombre, 'es'),
    ),
  };
}

const CARGO: Record<string, string> = { OPERADOR: 'Operador CDA', ASISTENTE: 'Asistente CDA' };
const CELULAR: Record<DispositivoCda, string> = { ANDROID: 'Android', IPHONE: 'iPhone' };

/** pdfkit (fuentes estándar) borra la barra invertida de nombres como "Bloque 1 \ Ex Escuela"; "/" se lee igual. */
const sinBarra = (t: string) => t.replace(/\\/g, '/');
const dias = (fechas: string[]) => fechas.map(diaCorto).join(', ');

function cargo(p: PersonaHistorialCda): string {
  const c = CARGO[p.grupo] ?? p.grupo;
  return p.activo ? c : `${c} (oculto)`;
}

/** Reporte imprimible (Excel o PDF): personal, recintos y kits de las fechas elegidas. */
export function reporteHistorial(h: HistorialParejasCda): ReporteCda {
  const fueron = h.personas.filter((p) => p.fechas.length > 0);
  const visitados = h.recintos.filter((r) => r.visitas.length > 0);
  const noFueron = (grupo: string) => h.personas.filter((p) => p.grupo === grupo && p.fechas.length === 0).length;
  const visitas = h.recintos
    .flatMap((r) => r.visitas.map((v) => ({ r, v })))
    .sort((a, b) => a.v.fecha.localeCompare(b.v.fecha) || a.r.codigo.localeCompare(b.r.codigo, 'es', { numeric: true }));

  const filasKits: Celda[][] = visitas.map(({ r, v }, i) => [
    i + 1,
    diaCorto(v.fecha),
    r.codigo,
    sinBarra(r.nombre),
    v.kitCodigo ?? 'Sin kit',
    v.operador,
    v.asistente ?? '— (sin asistente)',
    v.llevaKit ?? '—',
  ]);

  return {
    titulo: 'Historial de parejas CDA',
    detalle: `Fechas: ${dias(h.fechas)} · "Fue" = estuvo en una pareja en alguna de esas fechas`,
    archivo: 'historial_parejas_cda',
    desde: h.fechas[0],
    hasta: h.fechas[h.fechas.length - 1],
    modo: 'GENERAL',
    // Son a lo sumo 20 fechas sueltas (pueden estar a meses): el tamaño no depende del rango.
    limitarDiasPdf: false,
    tablas: [
      {
        hoja: 'Personal',
        titulo: 'Personal que fue y que no fue',
        columnas: [
          { titulo: 'N°', ancho: 5 },
          { titulo: 'Apellidos y nombres', ancho: 34 },
          { titulo: 'Cédula', ancho: 13 },
          { titulo: 'Cargo', ancho: 16 },
          { titulo: 'Celular', ancho: 12 },
          { titulo: '¿Fue?', ancho: 7 },
          { titulo: 'Fechas', ancho: 20 },
          { titulo: 'Recintos', ancho: 40 },
        ],
        filas: h.personas.map((p, i) => [
          i + 1,
          p.apellidosNombres,
          p.cedula,
          cargo(p),
          p.dispositivo ? CELULAR[p.dispositivo] : 'Sin registrar',
          p.fechas.length ? 'Sí' : 'No',
          dias(p.fechas),
          sinBarra(p.recintos.join('; ')),
        ]),
        resaltadas: h.personas.flatMap((p, i) => (p.fechas.length ? [] : [i])),
        anexo: {
          titulo: 'Resumen',
          columnas: [
            { titulo: 'Concepto', ancho: 30 },
            { titulo: 'Cantidad', ancho: 10 },
          ],
          filas: [
            ['Personas', h.personas.length],
            ['Fueron', fueron.length],
            ['No fueron', h.personas.length - fueron.length],
            ['Operadores CDA que no fueron', noFueron('OPERADOR')],
            ['Asistentes CDA que no fueron', noFueron('ASISTENTE')],
          ],
        },
      },
      {
        hoja: 'Recintos',
        titulo: 'Recintos CDA visitados y no visitados',
        columnas: [
          { titulo: 'N°', ancho: 5 },
          { titulo: 'Código', ancho: 9 },
          { titulo: 'Cantón', ancho: 14 },
          { titulo: 'Recinto', ancho: 32 },
          { titulo: '¿Visitado?', ancho: 10 },
          { titulo: 'Fechas', ancho: 20 },
          { titulo: 'Parejas que fueron', ancho: 50 },
        ],
        filas: h.recintos.map((r, i) => [
          i + 1,
          r.codigo,
          r.canton,
          sinBarra(r.nombre),
          r.visitas.length ? 'Sí' : 'No',
          dias([...new Set(r.visitas.map((v) => v.fecha))]),
          r.visitas.map((v) => `${diaCorto(v.fecha)}: ${v.operador}${v.asistente ? ` + ${v.asistente}` : ''}`).join('; '),
        ]),
        resaltadas: h.recintos.flatMap((r, i) => (r.visitas.length ? [] : [i])),
        anexo: {
          titulo: 'Resumen',
          columnas: [
            { titulo: 'Concepto', ancho: 30 },
            { titulo: 'Cantidad', ancho: 10 },
          ],
          filas: [
            ['Recintos', h.recintos.length],
            ['Visitados', visitados.length],
            ['No visitados', h.recintos.length - visitados.length],
          ],
        },
      },
      {
        hoja: 'Kits',
        titulo: 'Asignación de kits',
        columnas: [
          { titulo: 'N°', ancho: 5 },
          { titulo: 'Fecha', ancho: 11 },
          { titulo: 'Código', ancho: 9 },
          { titulo: 'Recinto', ancho: 28 },
          { titulo: 'Kit', ancho: 12 },
          { titulo: 'Operador', ancho: 26 },
          { titulo: 'Asistente', ancho: 26 },
          { titulo: 'Lleva el kit', ancho: 24 },
        ],
        filas: filasKits.length ? filasKits : [['', '', '', 'No hay parejas en las fechas elegidas', '', '', '', '']],
        resaltadas: visitas.flatMap(({ v }, i) => (v.kitCodigo ? [] : [i])),
      },
    ],
  };
}
