import { describe, expect, it } from 'vitest';
import type { PersonaDistribucionDias } from '@cne/shared-types';
import { candidatosIntercambio, claveTexto, contactosPorDia, cupoPorDia, desbalance, diaCorto, filtrarPersonas, proximoFinDeSemana, valoresUnicos } from './distribucionDias';

const p = (o: Partial<PersonaDistribucionDias>): PersonaDistribucionDias => ({
  id: 'x',
  fecha: '2026-11-20',
  operadorId: 'o',
  nombres: 'PÉREZ JUAN',
  cedula: '1003456785',
  telefono: null,
  sexo: 'M',
  cargo: 'Operadores CDA',
  canton: 'IBARRA',
  encargado: 'Willy',
  ...o,
});

describe('distribucionDias', () => {
  it('claveTexto ignora tildes, mayúsculas y espacios', () => {
    expect(claveTexto(' Sebastián  C ')).toBe('SEBASTIAN C');
    expect(claveTexto(null)).toBe('');
  });

  it('valoresUnicos: sin repetir por tildes/mayúsculas, sin vacíos y ordenados', () => {
    expect(valoresUnicos(['Willy', 'willy', null, ' ', 'Carlos L', 'Sebastián'])).toEqual(['Carlos L', 'Sebastián', 'Willy']);
  });

  it('filtrarPersonas por día, encargado y búsqueda sin tildes', () => {
    const lista = [
      p({ id: '1' }),
      p({ id: '2', fecha: '2026-11-21', nombres: 'RUIZ ÁNGELA', encargado: 'Edison Mafla' }),
      p({ id: '3', encargado: null }),
    ];
    expect(filtrarPersonas(lista, { fecha: '2026-11-20', encargado: '', buscar: '' }).map((x) => x.id)).toEqual(['1', '3']);
    expect(filtrarPersonas(lista, { fecha: '', encargado: 'WILLY', buscar: '' }).map((x) => x.id)).toEqual(['1']);
    expect(filtrarPersonas(lista, { fecha: '', encargado: '', buscar: 'angela' }).map((x) => x.id)).toEqual(['2']);
    expect(filtrarPersonas(lista, { fecha: '', encargado: '', buscar: '1003456785' })).toHaveLength(3);
  });

  it('desbalance: más de una persona de diferencia entre días', () => {
    const t = (hombres: number, mujeres: number) => ({ fecha: 'x', hombres, mujeres, sinSexo: 0, total: hombres + mujeres });
    expect(desbalance([t(22, 31), t(22, 31), t(21, 31)])).toEqual({ hombres: false, mujeres: false });
    expect(desbalance([t(23, 31), t(21, 33), t(21, 29)])).toEqual({ hombres: true, mujeres: true });
    expect(desbalance([])).toEqual({ hombres: false, mujeres: false });
  });

  it('proximoFinDeSemana: viernes a domingo siguientes (o desde hoy si es viernes)', () => {
    expect(proximoFinDeSemana('2026-11-18')).toEqual(['2026-11-20', '2026-11-21', '2026-11-22']);
    expect(proximoFinDeSemana('2026-11-20')).toEqual(['2026-11-20', '2026-11-21', '2026-11-22']);
    expect(proximoFinDeSemana('2026-11-22')).toEqual(['2026-11-27', '2026-11-28', '2026-11-29']);
  });

  it('diaCorto', () => {
    expect(diaCorto('2026-11-20')).toMatch(/^vie 20\/11$/);
  });

  it('cupoPorDia y candidatosIntercambio: misma regla que la API, solo mismo sexo y otro día', () => {
    const a = p({ id: 'a' });
    const lista = [a, p({ id: 'b' }), p({ id: 'c', fecha: '2026-11-21' }), p({ id: 'd', fecha: '2026-11-21' }), p({ id: 'm', fecha: '2026-11-22', sexo: 'F' })];
    const dias = ['2026-11-20', '2026-11-21', '2026-11-22'];
    expect(cupoPorDia(lista, a, dias)).toEqual([
      { fecha: '2026-11-20', mismoSexo: 2, conCupo: true },
      { fecha: '2026-11-21', mismoSexo: 2, conCupo: false },
      { fecha: '2026-11-22', mismoSexo: 0, conCupo: true },
    ]);
    expect(candidatosIntercambio(lista, a).map((x) => x.id)).toEqual(['c', 'd']);
    // Sin dato de sexo: cualquier día.
    expect(cupoPorDia(lista, p({ id: 'x', sexo: null }), dias).every((c) => c.conCupo)).toBe(true);
  });

  it('contactosPorDia: cuántos van al .vcf y quién queda fuera (sin celular o número repetido)', () => {
    const lista = [
      p({ nombres: 'CON CEL', telefono: '0991234567' }),
      p({ nombres: 'SIN CEL' }),
      p({ nombres: 'MISMO NÚMERO', telefono: '+593991234567' }),
      p({ nombres: 'FIJO', fecha: '2026-11-21', telefono: '062123456' }),
      p({ nombres: 'OTRO DÍA MISMO NÚMERO', fecha: '2026-11-21', telefono: '0991234567' }),
    ];
    const r = contactosPorDia(lista, ['2026-11-20', '2026-11-21', '2026-11-22']);
    expect(Object.fromEntries(r)).toEqual({
      '2026-11-20': { incluidos: 1, sinCelular: ['SIN CEL'], repetidos: ['MISMO NÚMERO'] },
      '2026-11-21': { incluidos: 1, sinCelular: ['FIJO'], repetidos: [] },
      '2026-11-22': { incluidos: 0, sinCelular: [], repetidos: [] },
    });
  });
});
