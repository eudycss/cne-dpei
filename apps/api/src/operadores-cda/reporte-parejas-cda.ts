import { BadRequestException } from '@nestjs/common';
import type { DispositivoCda, EstadoParejaCda, ParejaCdaFila, ParejasCdaDia, PersonaParejaCda } from '@cne/shared-types';

import { textosGrupo } from './grupo-cda';
import { type Celda, type ReporteCda, type TablaReporte, diaCorto, diaLargo } from './reporte-cda';

/**
 * Reporte imprimible de las parejas de un día: recinto, operador y asistente
 * con su cédula y celular (la APK solo se instala en Android) y quién lleva
 * el kit; en otra hoja, los activos que quedaron sin pareja. Sin teléfonos.
 */

const CELULAR: Record<DispositivoCda, string> = { ANDROID: 'Android', IPHONE: 'iPhone' };

const ESTADO: Record<EstadoParejaCda, string> = {
  EN_APP: 'Con kit',
  SIN_KIT: 'Sin kit',
  SOLO_REGISTRADA: 'Solo registrada (2.ª pareja del recinto)',
  PENDIENTE_EVENTO: 'Pendiente de evento',
};

const CARGO: Record<string, string> = { OPERADOR: 'Operador CDA', ASISTENTE: 'Asistente CDA' };

const celular = (p: PersonaParejaCda) => (p.dispositivo ? CELULAR[p.dispositivo] : 'Sin registrar');

/** pdfkit (fuentes estándar) borra la barra invertida de nombres como "Bloque 1 \ Ex Escuela"; "/" se lee igual. */
const nombreRecinto = (nombre: string) => nombre.replace(/\\/g, '/');

const kitSinAndroid = (p: ParejaCdaFila) => p.estado === 'EN_APP' && p.portador?.dispositivo !== 'ANDROID';

function estado(p: ParejaCdaFila): string {
  if (!p.asistente && p.estado === 'SOLO_REGISTRADA') return 'Persona sola (acompaña a la pareja del recinto)';
  const partes = [ESTADO[p.estado]];
  if (kitSinAndroid(p)) partes.push('sin Android');
  if (!p.asistente) partes.push('sin asistente');
  return partes.join(' · ');
}

/** Lo que hay que revisar antes de la jornada. */
const revisar = (p: ParejaCdaFila) => p.estado === 'SIN_KIT' || !p.asistente || kitSinAndroid(p);

function resumen(parejas: ParejaCdaFila[], sinPareja: number): Celda[][] {
  const recintos = new Set(parejas.map((p) => p.recinto.id));
  const conKit = new Set(parejas.filter((p) => p.estado === 'EN_APP').map((p) => p.recinto.id));
  const personas = new Map<string, PersonaParejaCda>();
  for (const p of parejas) for (const x of [p.operador, p.asistente]) if (x) personas.set(x.id, x);
  return [
    ['Recintos', recintos.size],
    ['Recintos con kit', conKit.size],
    ['Recintos sin kit', recintos.size - conKit.size],
    ['Parejas', parejas.length],
    ['Personas', personas.size],
    ['Personas sin pareja', parejas.filter((p) => !p.asistente).length],
    ['Celulares sin registrar', [...personas.values()].filter((x) => !x.dispositivo).length],
    ['Activos sin pareja', sinPareja],
  ];
}

/** Operadores y Asistentes CDA activos que no están en ninguna pareja del día. */
function tablaSinPareja(fecha: string, personas: PersonaParejaCda[]): TablaReporte {
  const filas: Celda[][] = [...personas]
    .sort((a, b) => a.apellidosNombres.localeCompare(b.apellidosNombres, 'es'))
    .map((p, i) => [i + 1, p.apellidosNombres, p.cedula, CARGO[p.grupo] ?? textosGrupo(p.grupo).cargo, celular(p)]);
  return {
    hoja: 'Sin pareja',
    titulo: `Operadores y Asistentes CDA activos sin pareja el ${diaCorto(fecha)}`,
    columnas: [
      { titulo: 'N°', ancho: 5 },
      { titulo: 'Apellidos y nombres', ancho: 40 },
      { titulo: 'Cédula', ancho: 14 },
      { titulo: 'Cargo', ancho: 18 },
      { titulo: 'Celular', ancho: 14 },
    ],
    filas: filas.length > 0 ? filas : [['', 'Todos los Operadores y Asistentes CDA activos tienen pareja este día', '', '', '']],
  };
}

export function reporteParejas(dia: ParejasCdaDia, sinPareja: PersonaParejaCda[] = []): ReporteCda {
  if (dia.parejas.length === 0) throw new BadRequestException(`El ${diaCorto(dia.fecha)} no tiene parejas`);
  const parejas = [...dia.parejas].sort(
    (a, b) =>
      a.recinto.codigo.localeCompare(b.recinto.codigo, 'es', { numeric: true }) ||
      a.operador.apellidosNombres.localeCompare(b.operador.apellidosNombres, 'es'),
  );
  const evento = dia.evento ? `Evento: ${dia.evento.nombre}` : 'Evento: sin evento activo de esa fecha';
  return {
    titulo: 'Parejas Operador + Asistente CDA',
    detalle: `${diaLargo(dia.fecha)} · ${evento}`,
    archivo: 'parejas_cda',
    desde: dia.fecha,
    hasta: dia.fecha,
    modo: 'GENERAL',
    tablas: [
      {
        hoja: 'Parejas',
        titulo: `Parejas del ${diaCorto(dia.fecha)}`,
        columnas: [
          { titulo: 'N°', ancho: 5 },
          { titulo: 'Código', ancho: 10 },
          { titulo: 'Cantón', ancho: 15 },
          { titulo: 'Recinto', ancho: 25 },
          { titulo: 'Operador', ancho: 21 },
          { titulo: 'Cédula operador', ancho: 14.5 },
          { titulo: 'Celular operador', ancho: 12.5 },
          { titulo: 'Asistente', ancho: 21 },
          { titulo: 'Cédula asistente', ancho: 14.5 },
          { titulo: 'Celular asistente', ancho: 12.5 },
          { titulo: 'Lleva el kit', ancho: 20 },
          { titulo: 'Estado', ancho: 20 },
        ],
        filas: parejas.map((p, i) => [
          i + 1,
          p.recinto.codigo,
          p.recinto.canton ?? '',
          nombreRecinto(p.recinto.nombre),
          p.operador.apellidosNombres,
          p.operador.cedula,
          celular(p.operador),
          p.asistente?.apellidosNombres ?? '— (sin pareja)',
          p.asistente?.cedula ?? '',
          p.asistente ? celular(p.asistente) : '',
          p.portador?.apellidosNombres ?? '—',
          estado(p),
        ]),
        resaltadas: parejas.flatMap((p, i) => (revisar(p) ? [i] : [])),
        anexo: { titulo: 'Resumen', columnas: [{ titulo: 'Concepto', ancho: 30 }, { titulo: 'Cantidad', ancho: 10 }], filas: resumen(parejas, sinPareja.length) },
      },
      tablaSinPareja(dia.fecha, sinPareja),
    ],
  };
}
