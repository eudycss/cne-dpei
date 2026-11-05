import { describe, expect, it } from 'vitest';
import { guardarActaSimuladorSchema, iniciarSimuladorSchema, practicaDigitacionSchema, tokenSimuladorSchema } from './index';

const P1 = '22222222-2222-4222-8222-222222222222';
const BASE = {
  nombre: 'Práctica 1',
  filasPorActa: 12,
  votoMin: 0,
  votoMax: 350,
  metaActas: 200,
  plazoMinutos: 60,
  inicio: '2026-11-10T08:00:00-05:00',
  fin: '2026-11-10T18:00:00-05:00',
  pctDigitosDistintos: 10,
  intentosMax: 1,
  cargos: ['DIGITADOR'],
  incluir: [],
  excluir: [],
};

describe('practicaDigitacionSchema', () => {
  it('acepta una práctica válida y quita cargos/personas repetidos', () => {
    const r = practicaDigitacionSchema.parse({ ...BASE, cargos: ['DIGITADOR', 'DIGITADOR'], incluir: [P1, P1] });
    expect(r.cargos).toEqual(['DIGITADOR']);
    expect(r.incluir).toEqual([P1]);
  });

  it.each([
    ['voto mínimo mayor que el máximo', { votoMin: 400, votoMax: 350 }],
    ['fin antes del inicio', { fin: '2026-11-10T07:00:00-05:00' }],
    ['sin cargos ni personas', { cargos: [], incluir: [] }],
    ['persona agregada y quitada', { incluir: [P1], excluir: [P1] }],
    ['0 filas', { filasPorActa: 0 }],
    ['41 filas', { filasPorActa: 41 }],
    ['voto de 4 cifras', { votoMax: 1000 }],
    ['meta decimal', { metaActas: 10.5 }],
    ['porcentaje > 100', { pctDigitosDistintos: 101 }],
    ['0 intentos', { intentosMax: 0 }],
    ['fecha sin zona horaria', { inicio: '2026-11-10 08:00' }],
    ['cargo con forma inválida', { cargos: ['digitador'] }],
    ['nombre muy corto', { nombre: ' a ' }],
  ])('rechaza: %s', (_caso, cambio) => {
    expect(practicaDigitacionSchema.safeParse({ ...BASE, ...cambio }).success).toBe(false);
  });

  it('solo personas, sin cargos, también vale', () => {
    expect(practicaDigitacionSchema.safeParse({ ...BASE, cargos: [], incluir: [P1] }).success).toBe(true);
  });
});

describe('esquemas públicos del simulador', () => {
  const TOKEN = 'A'.repeat(43);

  it('iniciar exige cédula ecuatoriana válida', () => {
    expect(iniciarSimuladorSchema.safeParse({ cedula: '1710034065', practicaId: P1 }).success).toBe(true);
    expect(iniciarSimuladorSchema.safeParse({ cedula: '1710034066', practicaId: P1 }).success).toBe(false);
  });

  it('token: 43 caracteres base64url', () => {
    expect(tokenSimuladorSchema.safeParse({ token: TOKEN }).success).toBe(true);
    expect(tokenSimuladorSchema.safeParse({ token: `${TOKEN}=` }).success).toBe(false);
    expect(tokenSimuladorSchema.safeParse({ token: 'A'.repeat(42) }).success).toBe(false);
  });

  it('guardar: números de 0 a 999 o vacío (null)', () => {
    expect(guardarActaSimuladorSchema.safeParse({ token: TOKEN, actaId: P1, valores: [62, null, 0] }).success).toBe(true);
    for (const valores of [[], [1000], [-1], [1.5], ['62'], Array(41).fill(1)]) {
      expect(guardarActaSimuladorSchema.safeParse({ token: TOKEN, actaId: P1, valores }).success).toBe(false);
    }
  });
});
