import * as XLSX from 'xlsx';
import type * as maplibregl from 'maplibre-gl';
import type { PlanPerimetroDetalle } from '@cne/shared-types';
import { longitudAnillo } from './geometria';
import { nombrePuesto } from './PuestoMarker';

// Lista del plan para Excel e impresión: N.º de puesto, nombre (o nombre libre)
// y ubicación. Nada de cédula, cargo, sexo ni teléfono.

export const ENCABEZADOS_PUESTOS = ['N.º', 'Nombre', 'Latitud', 'Longitud', 'Ver en Google Maps'] as const;

const enlaceMaps = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;

/**
 * Texto que Excel podría tomar como fórmula (=, +, -, @, tabulador o retorno al
 * inicio) lleva un apóstrofo delante: inyección de fórmulas (CSV/Excel injection).
 */
export function textoSeguro(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** `seguro`: protege contra fórmulas (Excel). En la hoja impresa no hace falta. */
export function filasPuestos(plan: Pick<PlanPerimetroDetalle, 'puestos'>, { seguro = true } = {}): (string | number)[][] {
  return plan.puestos.map((p) => [
    p.orden,
    seguro ? textoSeguro(nombrePuesto(p)) : nombrePuesto(p),
    Number(p.lat.toFixed(6)),
    Number(p.lng.toFixed(6)),
    enlaceMaps(p.lat, p.lng),
  ]);
}

/** Resumen de una línea: largo del perímetro, puestos, personas asignadas y vallas. */
export function resumenPlan(plan: Pick<PlanPerimetroDetalle, 'perimetro' | 'puestos' | 'vallas'>): string {
  const largo = plan.perimetro ? `${Math.round(longitudAnillo(plan.perimetro))} m de perímetro · ` : '';
  const conPersona = plan.puestos.filter((p) => p.persona).length;
  return `${largo}${plan.puestos.length} puestos (${conPersona} con persona) · ${plan.vallas.length} vallas`;
}

/** Nombre de archivo sin tildes ni caracteres raros. */
export function nombreArchivo(nombrePlan: string): string {
  const base = nombrePlan
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return `plan_perimetro_${base || 'sin_nombre'}.xlsx`;
}

export function descargarExcel(plan: PlanPerimetroDetalle): void {
  const hoja = XLSX.utils.aoa_to_sheet([
    [textoSeguro(plan.nombre)],
    [resumenPlan(plan)],
    [],
    [...ENCABEZADOS_PUESTOS],
    ...filasPuestos(plan),
  ]);
  hoja['!cols'] = [{ wch: 6 }, { wch: 40 }, { wch: 12 }, { wch: 12 }, { wch: 48 }];
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Puestos');
  XLSX.writeFile(libro, nombreArchivo(plan.nombre));
}

/**
 * Imagen del mapa tal como se ve. MapLibre borra el lienzo después de dibujar,
 * así que se pide un cuadro nuevo y se copia en ese mismo momento. null si falla
 * (p. ej. una tesela sin CORS deja el lienzo "contaminado").
 */
export function capturarMapa(map: maplibregl.Map): Promise<string | null> {
  return new Promise((resolver) => {
    const tope = setTimeout(() => resolver(null), 3000);
    map.once('render', () => {
      clearTimeout(tope);
      try {
        resolver(map.getCanvas().toDataURL('image/png'));
      } catch {
        resolver(null);
      }
    });
    map.triggerRepaint();
  });
}
