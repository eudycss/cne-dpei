import { BadRequestException } from '@nestjs/common';
import type { RecintoParejaCda } from '@cne/shared-types';

import { type EntradaPropuesta, type PersonaParaProponer, proponerParejas } from './propuesta-parejas-cda';
import { HistorialParejasCdaService } from './historial-parejas-cda.service';

const op = (nombre: string, dispositivo: string | null = null): PersonaParaProponer => ({
  id: nombre,
  apellidosNombres: nombre,
  cedula: '1000000001',
  grupo: 'OPERADOR',
  dispositivo,
});
const as = (nombre: string, dispositivo: string | null = null): PersonaParaProponer => ({ ...op(nombre, dispositivo), grupo: 'ASISTENTE' });
const recinto = (codigo: string): RecintoParejaCda => ({ id: `r${codigo}`, codigo, nombre: `Recinto ${codigo}` });

const entrada = (e: Partial<EntradaPropuesta>): EntradaPropuesta => ({
  personas: [],
  recintos: [],
  fueron: new Set(),
  visitados: new Set(),
  personasDelDia: new Set(),
  recintosDelDia: new Set(),
  extras: new Set(),
  ...e,
});
const resumen = (filas: ReturnType<typeof proponerParejas>['filas']) =>
  filas.map((f) => [f.recinto.codigo, f.operador?.id ?? null, f.asistente?.id ?? null, f.extra]);

describe('propuesta automática de parejas', () => {
  it('el personal que no fue va a los recintos no visitados, un Operador con un Asistente', () => {
    const { filas, personas } = proponerParejas(
      entrada({
        personas: [op('OP-FUE', 'ANDROID'), op('OP1', 'ANDROID'), as('AS1')],
        recintos: [recinto('971'), recinto('1133')],
        fueron: new Set(['OP-FUE']),
        visitados: new Set(['r971']),
      }),
    );
    expect(resumen(filas)).toEqual([['1133', 'OP1', 'AS1', false]]);
    // Quien ya fue no se propone, pero se puede elegir a mano.
    expect(personas.find((p) => p.id === 'OP-FUE')).toMatchObject({ yaFue: true });
    expect(personas.find((p) => p.id === 'OP1')).toMatchObject({ yaFue: false, dispositivo: 'ANDROID' });
  });

  it('reparte los Android para que cada pareja tenga al menos uno; las que no tienen ninguno van al final', () => {
    const { filas } = proponerParejas(
      entrada({
        personas: [op('OA', 'ANDROID'), op('ON1', 'IPHONE'), op('ON2'), as('AA', 'ANDROID'), as('AN1', 'IPHONE'), as('AN2')],
        recintos: [recinto('1'), recinto('2'), recinto('3')],
      }),
    );
    expect(resumen(filas)).toEqual([
      ['1', 'ON1', 'AA', false],
      ['2', 'OA', 'AN1', false],
      ['3', 'ON2', 'AN2', false],
    ]);
  });

  it('una pareja más en los recintos marcados (aunque ya los hayan visitado), después de las principales', () => {
    const { filas } = proponerParejas(
      entrada({
        personas: [op('O1', 'ANDROID'), op('O2', 'ANDROID'), as('A1'), as('A2')],
        recintos: [recinto('5'), recinto('7')],
        visitados: new Set(['r5']),
        extras: new Set(['r5', 'r7']),
      }),
    );
    expect(filas.map((f) => [f.recinto.codigo, f.extra])).toEqual([
      ['7', false],
      ['5', true],
      ['7', true],
    ]);
    // Solo alcanzó para dos parejas: la tercera queda vacía para elegir a mano.
    expect(filas[2]).toMatchObject({ operador: null, asistente: null });
  });

  it('sin asistentes suficientes, el operador va solo; los asistentes que sobran quedan libres', () => {
    expect(resumen(proponerParejas(entrada({ personas: [op('O1'), op('O2', 'ANDROID'), as('A1')], recintos: [recinto('1'), recinto('2')] })).filas)).toEqual([
      ['1', 'O2', 'A1', false],
      ['2', 'O1', null, false],
    ]);
    const sobra = proponerParejas(entrada({ personas: [op('O1'), as('A1'), as('A2')], recintos: [recinto('1')] }));
    expect(resumen(sobra.filas)).toEqual([['1', 'O1', 'A1', false]]);
    expect(sobra.personas.map((p) => p.id)).toContain('A2');
  });

  it('no propone a quien ni a los recintos que ya tienen pareja en la fecha nueva', () => {
    const { filas, personas } = proponerParejas(
      entrada({
        personas: [op('O1'), op('O2'), as('A1')],
        recintos: [recinto('1'), recinto('2')],
        personasDelDia: new Set(['O1']),
        recintosDelDia: new Set(['r1']),
      }),
    );
    expect(resumen(filas)).toEqual([['2', 'O2', 'A1', false]]);
    expect(personas.map((p) => p.id)).not.toContain('O1');
  });
});

describe('HistorialParejasCdaService.propuesta', () => {
  const prisma = () => ({
    operadorCda: { findMany: jest.fn().mockResolvedValue([op('O1', 'ANDROID'), as('A1')]) },
    recinto: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'r1', codigoRecinto: '971', nombre: 'UE Chaltura', canton: { nombre: 'ANTONIO ANTE' } },
        { id: 'r2', codigoRecinto: '1133', nombre: 'CECIB', canton: null },
      ]),
    },
    parejaCda: {
      findMany: jest
        .fn()
        .mockResolvedValueOnce([{ operadorCdaId: 'X', asistenteCdaId: null, recintoId: 'r1' }])
        .mockResolvedValueOnce([]),
    },
  });

  it('lee las parejas de las fechas de referencia y de la fecha nueva, y propone sin guardar', async () => {
    const p = prisma();
    const r = await new HistorialParejasCdaService(p as never).propuesta('2026-11-10', ['2026-10-28'], []);

    expect(p.parejaCda.findMany.mock.calls.map(([q]) => q.where)).toEqual([
      { fecha: { in: [new Date('2026-10-28T00:00:00Z')] } },
      { fecha: new Date('2026-11-10T00:00:00Z') },
    ]);
    expect(r).toMatchObject({ fecha: '2026-11-10', referencia: ['2026-10-28'] });
    expect(resumen(r.filas)).toEqual([['1133', 'O1', 'A1', false]]);
    expect(Object.keys(p)).not.toContain('create');
  });

  it('un recinto marcado que no es CDA activo: 400', async () => {
    await expect(new HistorialParejasCdaService(prisma() as never).propuesta('2026-11-10', ['2026-10-28'], ['otro'])).rejects.toThrow(
      BadRequestException,
    );
  });
});
