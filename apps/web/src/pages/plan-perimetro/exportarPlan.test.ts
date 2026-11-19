import { describe, expect, it, vi } from 'vitest';
import type { PlanPerimetroDetalle } from '@cne/shared-types';

const { escrito } = vi.hoisted(() => ({ escrito: [] as Array<{ libro: unknown; nombre: string }> }));
vi.mock('xlsx', async (original) => ({
  ...(await original<typeof import('xlsx')>()),
  writeFile: (libro: unknown, nombre: string) => escrito.push({ libro, nombre }),
}));

import * as XLSX from 'xlsx';
import { descargarExcel, filasPuestos, nombreArchivo, resumenPlan, textoSeguro } from './exportarPlan';

const PLAN: PlanPerimetroDetalle = {
  id: 'p',
  eventoId: 'e',
  nombre: 'Coliseo Ibarra — 2.ª vuelta',
  lugar: null,
  perimetro: [
    [0.35, -78.11],
    [0.351, -78.11],
    [0.351, -78.111],
  ],
  zonas: [],
  vallas: [{ id: 'v', lat: 0, lng: 0, angulo: 0 }],
  ajustes: { pctMujeres: 50, largoValla: 2.5, mostrarNombres: true, alinearVallas: true },
  vista: null,
  puestos: [
    { id: 'a', orden: 1, lat: 0.3501234567, lng: -78.1101234567, etiqueta: null, persona: { id: 'x', nombre: 'PÉREZ JUAN', tieneFoto: true } },
    { id: 'b', orden: 2, lat: 0.351, lng: -78.11, etiqueta: '=HYPERLINK("http://malo")', persona: null },
    { id: 'c', orden: 3, lat: 0.351, lng: -78.111, etiqueta: null, persona: null },
  ],
  version: 0,
  actualizadoEn: '',
  avisos: [],
};

describe('exportar el plan', () => {
  it('cada fila: número, nombre, coordenadas y enlace a Google Maps; nada más', () => {
    const filas = filasPuestos(PLAN);
    expect(filas[0]).toEqual([1, 'PÉREZ JUAN', 0.350123, -78.110123, 'https://www.google.com/maps?q=0.350123,-78.110123']);
    expect(filas[2][1]).toBe('Sin asignar');
    expect(filas.every((f) => f.length === 5)).toBe(true);
  });

  it('un texto que Excel tomaría como fórmula queda como texto', () => {
    expect(filasPuestos(PLAN)[1][1]).toBe('\'=HYPERLINK("http://malo")');
    for (const peligroso of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx']) expect(textoSeguro(peligroso).startsWith("'")).toBe(true);
    expect(textoSeguro('Policía 1')).toBe('Policía 1');
  });

  it('resumen y nombre de archivo', () => {
    expect(resumenPlan(PLAN)).toMatch(/^\d+ m de perímetro · 3 puestos \(1 con persona\) · 1 vallas$/);
    expect(nombreArchivo(PLAN.nombre)).toBe('plan_perimetro_Coliseo_Ibarra_2_vuelta.xlsx');
    expect(nombreArchivo('***')).toBe('plan_perimetro_sin_nombre.xlsx');
  });

  it('descarga un Excel con la hoja Puestos', () => {
    descargarExcel(PLAN);
    const { libro, nombre } = escrito.at(-1)!;
    expect(nombre).toBe('plan_perimetro_Coliseo_Ibarra_2_vuelta.xlsx');
    const filas = XLSX.utils.sheet_to_json<unknown[]>((libro as XLSX.WorkBook).Sheets.Puestos, { header: 1 });
    expect(filas[3]).toEqual(['N.º', 'Nombre', 'Latitud', 'Longitud', 'Ver en Google Maps']);
    expect(filas).toHaveLength(7);
  });
});
