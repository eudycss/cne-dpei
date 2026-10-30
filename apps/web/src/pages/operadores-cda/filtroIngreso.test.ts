import { describe, it, expect } from 'vitest';
import { cumpleIngreso, fechaDeUrl, ordenarPorIngreso, rangoIngresoInvalido } from './filtroIngreso';
import { CARGOS_BASE, CENTROS, TEXTOS_GRUPO, grupoDeRuta } from './grupo';
import { fechaCorta } from './utils';

const sin = { desde: '', hasta: '', incluirSinFecha: false };

describe('filtro por fecha de ingreso', () => {
  it('sin rango pasan todos, también los que no tienen fecha', () => {
    expect(cumpleIngreso({ fechaInicio: null }, sin)).toBe(true);
    expect(cumpleIngreso({ fechaInicio: '2026-10-01' }, sin)).toBe(true);
  });

  it('los extremos del rango cuentan (desde y hasta inclusive)', () => {
    const f = { ...sin, desde: '2026-10-01', hasta: '2026-10-15' };
    expect(cumpleIngreso({ fechaInicio: '2026-10-01' }, f)).toBe(true);
    expect(cumpleIngreso({ fechaInicio: '2026-10-15' }, f)).toBe(true);
    expect(cumpleIngreso({ fechaInicio: '2026-09-30' }, f)).toBe(false);
    expect(cumpleIngreso({ fechaInicio: '2026-10-16' }, f)).toBe(false);
  });

  it('con rango, los sin fecha solo pasan si se pide incluirlos', () => {
    const f = { ...sin, desde: '2026-10-01' };
    expect(cumpleIngreso({ fechaInicio: null }, f)).toBe(false);
    expect(cumpleIngreso({ fechaInicio: null }, { ...f, incluirSinFecha: true })).toBe(true);
  });

  it('un rango invertido es inválido y no filtra', () => {
    const f = { ...sin, desde: '2026-10-20', hasta: '2026-10-01' };
    expect(rangoIngresoInvalido(f)).toBe(true);
    expect(cumpleIngreso({ fechaInicio: '2025-01-01' }, f)).toBe(true);
    expect(rangoIngresoInvalido({ ...sin, desde: '2026-10-01', hasta: '2026-10-01' })).toBe(false);
  });

  it('ordena sin modificar la lista original; "lista" la deja igual', () => {
    const lista = [{ fechaInicio: '2026-10-05' }, { fechaInicio: null }, { fechaInicio: '2026-10-01' }];
    expect(ordenarPorIngreso(lista, 'lista')).toBe(lista);
    expect(ordenarPorIngreso(lista, 'ingreso-antiguo').map((o) => o.fechaInicio)).toEqual(['2026-10-01', '2026-10-05', null]);
    expect(ordenarPorIngreso(lista, 'ingreso-reciente').map((o) => o.fechaInicio)).toEqual(['2026-10-05', '2026-10-01', null]);
    expect(lista.map((o) => o.fechaInicio)).toEqual(['2026-10-05', null, '2026-10-01']);
  });
});

describe('fechas e ids que llegan en la URL', () => {
  it('fechaDeUrl solo acepta AAAA-MM-DD; lo demás se ignora', () => {
    expect(fechaDeUrl('2026-10-20')).toBe('2026-10-20');
    for (const v of [null, '', 'zzz', '2026-1-2', '20/10/2026', '2026-10-20x']) expect(fechaDeUrl(v)).toBe('');
  });

  it('fechaCorta pasa a DD/MM/AAAA sin correrse de día', () => {
    expect(fechaCorta('2026-10-01')).toBe('01/10/2026');
  });

  it('grupoDeRuta: cada cargo tiene su ruta propia; una desconocida es OPERADOR', () => {
    const GRUPOS = CARGOS_BASE.map((c) => c.clave);
    expect(GRUPOS).toHaveLength(9);
    for (const g of GRUPOS) expect(grupoDeRuta(TEXTOS_GRUPO[g].ruta)).toBe(g);
    expect(new Set(GRUPOS.map((g) => TEXTOS_GRUPO[g].ruta)).size).toBe(9);
    expect(grupoDeRuta('archivadores-actas')).toBe('ARCHIVADOR_ACTAS');
    // Todo cargo cae en una sección del combo; solo operadores y asistentes son CDA.
    for (const g of GRUPOS) expect(CENTROS).toContain(TEXTOS_GRUPO[g].centro);
    expect(GRUPOS.filter((g) => TEXTOS_GRUPO[g].centro === 'CDA')).toEqual(['OPERADOR', 'ASISTENTE']);
    for (const v of [null, '', 'xyz', 'SUPERVISOR']) expect(grupoDeRuta(v)).toBe('OPERADOR');
  });

  it('grupoDeRuta: un cargo agregado usa su clave en minúsculas y no choca con los originales', () => {
    const cargos = [
      ...CARGOS_BASE,
      { clave: 'RECEPTORES_ACTAS', nombre: 'Receptores (2)', centro: 'CPE' as const, activo: true, protegido: false, orden: 10, personas: 0 },
    ];
    expect(grupoDeRuta('receptores_actas', cargos)).toBe('RECEPTORES_ACTAS');
    expect(grupoDeRuta('receptores-actas', cargos)).toBe('RECEPTOR_ACTAS');
    expect(grupoDeRuta('receptores_actas')).toBe('OPERADOR');
  });
});
