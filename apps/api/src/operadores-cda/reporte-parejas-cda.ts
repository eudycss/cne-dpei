import { BadRequestException } from '@nestjs/common';
import type { DispositivoCda, EstadoParejaCda, ParejaCdaFila, ParejasCdaDia, PersonaParejaCda } from '@cne/shared-types';

import { type Celda, type ReporteCda, diaCorto, diaLargo } from './reporte-cda';

/**
 * Reporte imprimible de las parejas de un día: recinto, operador y asistente
 * con su celular (la APK solo se instala en Android) y quién lleva el kit.
 * Sin cédulas ni teléfonos: la hoja se imprime y circula.
 */

const CELULAR: Record<DispositivoCda, string> = { ANDROID: 'Android', IPHONE: 'iPhone' };

const ESTADO: Record<EstadoParejaCda, string> = {
  EN_APP: 'Con kit',
  SIN_KIT: 'Sin kit',
  SOLO_REGISTRADA: 'Solo registrada (2.ª pareja del recinto)',
  PENDIENTE_EVENTO: 'Pendiente de evento',
};

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

function resumen(parejas: ParejaCdaFila[]): Celda[][] {
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
  ];
}

export function reporteParejas(dia: ParejasCdaDia): ReporteCda {
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
          { titulo: 'Recinto', ancho: 34 },
          { titulo: 'Operador', ancho: 28 },
          { titulo: 'Celular operador', ancho: 11 },
          { titulo: 'Asistente', ancho: 28 },
          { titulo: 'Celular asistente', ancho: 11 },
          { titulo: 'Lleva el kit', ancho: 28 },
          { titulo: 'Estado', ancho: 22 },
        ],
        filas: parejas.map((p, i) => [
          i + 1,
          p.recinto.codigo,
          nombreRecinto(p.recinto.nombre),
          p.operador.apellidosNombres,
          celular(p.operador),
          p.asistente?.apellidosNombres ?? '— (sin pareja)',
          p.asistente ? celular(p.asistente) : '',
          p.portador?.apellidosNombres ?? '—',
          estado(p),
        ]),
        resaltadas: parejas.flatMap((p, i) => (revisar(p) ? [i] : [])),
        anexo: { titulo: 'Resumen', columnas: [{ titulo: 'Concepto', ancho: 30 }, { titulo: 'Cantidad', ancho: 10 }], filas: resumen(parejas) },
      },
    ],
  };
}
