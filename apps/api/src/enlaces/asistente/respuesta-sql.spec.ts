import { formatearResultadoSql } from './respuesta-sql';
import type { ResultadoSql } from './sql/motor-sql';

const ENCARGADOS = new Map([['1008', { nombre: 'Rector <Ana>', telefono: '0991234567' }]]);
const res = (columnas: string[], filas: ResultadoSql['filas'], hayMas = false): ResultadoSql => ({ columnas, filas, hayMas });

describe('formatearResultadoSql', () => {
  it('un solo valor: "Título: valor"', () => {
    expect(formatearResultadoSql('Caídos en Ibarra', res(['caidos'], [[2]]), false, ENCARGADOS)).toEqual(['🔎 <b>Caídos en Ibarra</b>: 2']);
  });

  it('sin filas lo dice', () => {
    expect(formatearResultadoSql('Caídos', res(['codigo'], []), false, null)).toEqual(['🔎 <b>Caídos</b>\nNinguno cumple esa condición.']);
  });

  it('recintos: estado con ícono, código y nombre; sin teléfonos si no se pidieron', () => {
    const r = formatearResultadoSql(
      'Recintos de Otavalo',
      res(['codigo', 'nombre', 'estado'], [['1008', 'UE <Ilumán>', 'caido'], ['1009', 'UE Otavalo', 'activo']]),
      false,
      ENCARGADOS,
    );
    expect(r).toEqual(['🔎 <b>Recintos de Otavalo</b> (2)\n🔴 1008 — UE &lt;Ilumán&gt;\n✅ 1009 — UE Otavalo']);
  });

  it('con contacto: el encargado sale del Excel, escapado', () => {
    const [m] = formatearResultadoSql('Caídos', res(['codigo', 'nombre'], [['1008', 'UE A'], ['1009', 'UE B']]), true, ENCARGADOS);
    expect(m).toContain('• 1008 — UE A\n     📞 Rector &lt;Ana&gt; · 0991234567');
    expect(m).toContain('• 1009 — UE B\n     📞 sin registrar');
  });

  it('con contacto pero sin código no puede buscar teléfonos: lista normal', () => {
    const [m] = formatearResultadoSql('Técnicos', res(['tecnico', 'recintos'], [['Willy', 5]]), true, ENCARGADOS);
    expect(m).not.toContain('📞');
  });

  it('tablas sin código (conteos): encabezado de columnas y valores', () => {
    const [m] = formatearResultadoSql(
      'Técnicos',
      res(['numero_tecnico', 'tecnico', 'recintos'], [[1, 'Jairo <b>', 7], [2, null, 5]]),
      false,
      null,
    );
    expect(m).toBe('🔎 <b>Técnicos</b> (2)\n<i>numero_tecnico · tecnico · recintos</i>\n• 1 · Jairo &lt;b&gt; · 7\n• 2 · — · 5');
  });

  it('columnas extra junto al recinto', () => {
    const [m] = formatearResultadoSql('X', res(['codigo', 'nombre', 'tecnico'], [['1', 'UE A', 'Willy']]), false, null);
    expect(m).toContain('• 1 — UE A · Willy');
  });

  it('escapa el título que escribe el modelo', () => {
    expect(formatearResultadoSql('<b>A & B</b>', res(['n'], [[1]]), false, null)).toEqual(['🔎 <b>&lt;b&gt;A &amp; B&lt;/b&gt;</b>: 1']);
  });

  it('si el Excel de encargados no se pudo leer, lo dice en vez de "sin registrar"', () => {
    const [m] = formatearResultadoSql('X', res(['codigo', 'nombre'], [['1008', 'UE A']]), true, null);
    expect(m).toContain('📞 no se pudo consultar ahora');
  });

  it('avisa si el resultado se cortó en el máximo de filas', () => {
    const [m] = formatearResultadoSql('X', res(['codigo'], [['1'], ['2']], true), false, null);
    expect(m).toContain('(2+)');
    expect(m).toContain('… y hay más. Agregue un filtro para ver el resto.');
  });

  it('con contacto muestra a lo más 40 recintos', () => {
    const filas = Array.from({ length: 50 }, (_, i) => [String(1000 + i), 'UE']);
    const texto = formatearResultadoSql('X', res(['codigo', 'nombre'], filas), true, ENCARGADOS).join('\n');
    expect(texto.match(/📞/g)).toHaveLength(40);
    expect(texto).toContain('… y 10 más. Agregue un filtro para ver sus contactos.');
  });

  it('muchas filas se parten en mensajes que caben en Telegram', () => {
    const filas = Array.from({ length: 200 }, (_, i) => [String(1000 + i), 'Unidad Educativa Fiscal Mixta de Prueba Número ' + i, 'activo']);
    const mensajes = formatearResultadoSql('X', res(['codigo', 'nombre', 'estado'], filas), false, null);
    expect(mensajes.length).toBeGreaterThan(1);
    mensajes.forEach((m) => expect(m.length).toBeLessThan(4096));
  });
});
