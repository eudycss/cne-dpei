import { responderConsulta, type FilaRecinto, type FuentesDisponibles } from './consulta-recintos';
import type { FiltrosRecintos } from './herramientas';

const fila = (
  codigoRecinto: string,
  canton: string | null,
  estado: 'ACTIVO' | 'FALLO',
  tecnico: [number, string] | null,
  extra: Partial<FilaRecinto> = {},
): FilaRecinto => ({
  codigoRecinto,
  nombreRecinto: `Escuela ${codigoRecinto}`,
  canton,
  parroquia: '',
  estado,
  numeroTecnico: tecnico?.[0] ?? null,
  tecnico: tecnico?.[1] ?? null,
  encargado: { nombre: `Rector ${codigoRecinto}`, telefono: '0991234567' },
  ...extra,
});

const WILLY: [number, string] = [5, 'Willy'];
const JAIRO: [number, string] = [2, 'Jairo Leal'];

const FILAS: FilaRecinto[] = [
  fila('1307', 'Pimampiro', 'ACTIVO', WILLY),
  fila('1400', 'Urcuquí', 'FALLO', WILLY, { encargado: null }),
  fila('4241', 'Cotacachi', 'ACTIVO', WILLY, { parroquia: 'GARCIA MORENO' }),
  fila('323', 'Ibarra', 'FALLO', JAIRO, { encargado: { nombre: 'Ana', telefono: '' } }),
  fila('1126', 'Ibarra', 'ACTIVO', JAIRO),
  fila('1008', 'Otavalo', 'FALLO', null, { parroquia: 'SAN JUAN DE ILUMAN', nombreRecinto: 'UE <Ilumán>' }),
];

const TODAS: FuentesDisponibles = { distributivo: true, encargados: true };

const filtros = (f: Partial<FiltrosRecintos> = {}): FiltrosRecintos => ({
  cantones: [],
  parroquias: [],
  tecnicos: [],
  estado: null,
  sinTecnico: false,
  sinContacto: false,
  conContacto: false,
  agruparPor: null,
  soloContar: false,
  ...f,
});

const responder = (f: Partial<FiltrosRecintos>, filas = FILAS, fuentes = TODAS) => responderConsulta(filtros(f), filas, fuentes).join('\n---\n');

describe('responderConsulta', () => {
  it('"recintos de Pimampiro y Urcuquí": los dos cantones, agrupados por cantón', () => {
    expect(responder({ cantones: ['pimampiro', 'Urcuqui'] })).toBe(
      '🏫 <b>Recintos · Pimampiro, Urcuquí</b>: 2 (1 caído)\n\n' +
        '<b>📍 Pimampiro</b> (1)\n✅ 1307 (Pim) — Escuela 1307\n\n' +
        '<b>📍 Urcuquí</b> (1 · 1 caído)\n🔴 1400 (Urc) — Escuela 1400',
    );
  });

  it('"qué técnico está en Cotacachi": cuenta por técnico', () => {
    expect(responder({ cantones: ['Cotacachi'], agruparPor: 'tecnico', soloContar: true })).toBe(
      '🏫 <b>Recintos · Cotacachi</b>: 1\n• 👷 5. Willy: 1 recinto',
    );
  });

  it('"qué técnicos tienen caídos": por técnico, solo caídos, con los sin técnico al final', () => {
    const r = responder({ estado: 'caido', agruparPor: 'tecnico' });
    expect(r).toContain('Recintos · caídos</b>: 3');
    expect(r.indexOf('2. Jairo Leal')).toBeLessThan(r.indexOf('5. Willy'));
    expect(r.indexOf('5. Willy')).toBeLessThan(r.indexOf('Sin técnico asignado'));
    expect(r).not.toContain('1307');
  });

  it('"cuántos caídos hay en Ibarra": solo el total', () => {
    expect(responder({ cantones: ['Ibarra'], estado: 'caido', soloContar: true })).toBe('🏫 <b>Recintos · Ibarra · caídos</b>: 1');
  });

  it('"recintos de Willi" (con error de tipeo) avisa que muestra el más parecido', () => {
    const r = responder({ tecnicos: ['willi'] });
    expect(r).toContain('Algún técnico no estaba escrito tal cual');
    expect(r).toContain('Recintos · Willy</b>: 3');
  });

  it('"qué recintos no tienen técnico"', () => {
    expect(responder({ sinTecnico: true })).toContain('Recintos · sin técnico</b>: 1');
  });

  it('"qué recintos no tienen contacto": sin encargado o sin teléfono', () => {
    const r = responder({ sinContacto: true });
    expect(r).toContain('Recintos · sin contacto</b>: 2');
    expect(r).toContain('1400');
    expect(r).toContain('323');
  });

  it('con contacto: el encargado de cada uno, escapado', () => {
    const r = responder({ parroquias: ['Ilumán'], conContacto: true });
    expect(r).toContain('UE &lt;Ilumán&gt;');
    expect(r).toContain('📞 Rector 1008 · 0991234567');
  });

  it('una parroquia sin tildes ni el nombre completo', () => {
    expect(responder({ parroquias: ['garcia moreno'] })).toContain('4241');
  });

  it('un cantón que no existe lo dice; si había otro válido, responde con ese', () => {
    expect(responder({ cantones: ['Quito'] })).toBe(
      'No reconozco el cantón "Quito". Cantones con recintos: Cotacachi, Ibarra, Otavalo, Pimampiro, Urcuquí.',
    );
    const r = responder({ cantones: ['Quito', 'Ibarra'] });
    expect(r).toContain('No reconozco el cantón "Quito"');
    expect(r).toContain('Recintos · Ibarra</b>: 2');
  });

  it('una parte del nombre que calza con varios cantones no elige ninguno; con uno solo, sí', () => {
    expect(responder({ cantones: ['a'] })).toContain('No reconozco el cantón "a"');
    expect(responder({ cantones: ['pima'] })).toContain('Recintos · Pimampiro');
  });

  it('un técnico que no existe lo dice, sin inventar', () => {
    expect(responder({ tecnicos: ['Zoila'] })).toBe('No encontré al técnico "Zoila" en el distributivo.');
  });

  it('sin resultados lo dice', () => {
    expect(responder({ cantones: ['Pimampiro'], estado: 'caido' })).toBe(
      '🏫 <b>Recintos · Pimampiro · caídos</b>: 0\n✅ Ninguno cumple esa condición.',
    );
  });

  it('sin distributivo no filtra por técnico ni dice "sin técnico"', () => {
    const sinDistributivo = { distributivo: false, encargados: true };
    expect(responder({ tecnicos: ['Willy'] }, FILAS, sinDistributivo)).toContain('distributivo de técnicos no está disponible');
    expect(responder({ sinTecnico: true }, FILAS, sinDistributivo)).toContain('distributivo de técnicos no está disponible');
    expect(responder({}, FILAS, sinDistributivo)).toContain('agrupo por cantón');
  });

  it('sin el Excel de encargados no dice "sin contacto" y avisa si pidió contactos', () => {
    const sinEncargados = { distributivo: true, encargados: false };
    expect(responder({ sinContacto: true }, FILAS, sinEncargados)).toContain('archivo de encargados no está disponible');
    const r = responder({ conContacto: true, cantones: ['Ibarra'] }, FILAS, sinEncargados);
    expect(r).toContain('los contactos no se pudieron consultar');
    expect(r).not.toContain('📞');
  });

  it('escapa los nombres de técnicos y cantones', () => {
    const filas = [fila('1', '<Ibarra>', 'ACTIVO', [1, '<b>Ana</b>'])];
    const r = responder({ agruparPor: 'tecnico' }, filas);
    expect(r).toContain('👷 1. &lt;b&gt;Ana&lt;/b&gt;');
    expect(r).not.toContain('<b>Ana</b>');
  });

  it('contactos sin ningún filtro no vuelca los teléfonos de toda la provincia', () => {
    const r = responder({ conContacto: true });
    expect(r).toContain('Para mostrar contactos indique un cantón');
    expect(r).not.toContain('0991234567');
    expect(responder({ conContacto: true, estado: 'caido' })).toContain('📞');
  });

  it('con contactos, se muestran a lo más 40 recintos', () => {
    const muchas = Array.from({ length: 60 }, (_, i) => fila(String(1000 + i), 'Ibarra', 'FALLO', [1, 'Ana']));
    const r = responderConsulta(filtros({ cantones: ['Ibarra'], conContacto: true }), muchas, TODAS).join('\n');
    expect(r.match(/📞/g)).toHaveLength(40);
    expect(r).toContain('… y 20 más');
  });

  it('sin distributivo no filtra ni agrupa por parroquia (diría "no encontré" en falso)', () => {
    const sinDistributivo = { distributivo: false, encargados: true };
    expect(responder({ parroquias: ['Ilumán'] }, FILAS, sinDistributivo)).toContain('no está disponible ahora');
    expect(responder({ agruparPor: 'parroquia' }, FILAS, sinDistributivo)).toContain('no está disponible ahora');
  });

  it('un cantón de menos de 3 letras no se completa ("ra" no es Ibarra)', () => {
    expect(responder({ cantones: ['ra'] })).toContain('No reconozco el cantón "ra"');
  });

  it('un nombre que calza con varios técnicos avisa que muestra a todos', () => {
    const filas = [...FILAS, fila('9', 'Ibarra', 'ACTIVO', [7, 'Jairo Pozo'])];
    const r = responder({ tecnicos: ['Jairo'] }, filas);
    expect(r).toContain('Varios técnicos coinciden con "Jairo"');
    expect(r).toContain('Jairo Leal');
    expect(r).toContain('Jairo Pozo');
  });

  it('nunca más de 4 mensajes por consulta, con aviso de que hay más', () => {
    const muchas = Array.from({ length: 200 }, (_, i) =>
      fila(String(1000 + i), 'Ibarra', 'ACTIVO', [i, `Técnico ${i}`], { nombreRecinto: 'Unidad Educativa '.repeat(5) }),
    );
    const mensajes = responderConsulta(filtros({ agruparPor: 'tecnico' }), muchas, TODAS);
    expect(mensajes).toHaveLength(4);
    expect(mensajes[3]).toContain('… y hay más. Agregue un filtro');
  });

  it('muchos recintos: varios mensajes que caben en Telegram, y un tope con aviso', () => {
    const muchas = Array.from({ length: 260 }, (_, i) =>
      fila(String(1000 + i), 'Ibarra', 'ACTIVO', [1, 'Ana'], { nombreRecinto: `Unidad Educativa Fiscal Mixta Número ${i}` }),
    );
    const mensajes = responderConsulta(filtros(), muchas, TODAS);
    expect(mensajes.length).toBeGreaterThan(1);
    mensajes.forEach((m) => expect(m.length).toBeLessThan(4096));
    expect(mensajes.at(-1)).toContain('… y 60 más. Agregue un filtro');
  });
});
