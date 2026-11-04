import {
  callbackJornada,
  estadoVista,
  formatearResumenJornada,
  leerCallbackJornada,
  paginasDetalleJornada,
  tecladoJornada,
  telefonoTelegram,
  vistaDeTexto,
  BOTONES_JORNADA,
  type Jornada,
  type TecnicoJornada,
  type UnidadJornada,
} from './jornada';

const JAIRO: TecnicoJornada = { numero: 1, nombre: 'Jairo' };
const CARLOS: TecnicoJornada = { numero: 2, nombre: 'Carlos' };
const SIN: TecnicoJornada = { numero: null, nombre: '' };
// 14:00 UTC = 09:00 en Ecuador.
const AHORA = new Date('2026-11-29T14:00:00Z');
const A_LAS = (hhmm: string) => new Date(`2026-11-29T${hhmm}:00-05:00`);

function unidad(codigo: string, tecnico: TecnicoJornada, extra: Partial<UnidadJornada> = {}): UnidadJornada {
  return {
    codigoRecinto: codigo,
    nombreRecinto: `Recinto ${codigo}`,
    tecnico,
    personas: [
      { nombre: `OP ${codigo}`, telefono: '0991234567', rol: 'Op.' },
      { nombre: `AS ${codigo}`, telefono: null, rol: 'Asis.' },
    ],
    registros: {},
    kitRecibido: null,
    ...extra,
  };
}

function jornada(extra: Partial<Jornada> = {}): Jornada {
  return {
    evento: 'Elecciones 2027',
    unidades: [
      unidad('1487', CARLOS),
      unidad('971', JAIRO, { registros: { SALIDA_DPI: { en: A_LAS('08:12'), sinSenal: true } } }),
      unidad('1290', JAIRO),
    ],
    noCdas: [],
    sinKit: [],
    sinDistributivo: false,
    ...extra,
  };
}

describe('Jornada (Telegram)', () => {
  describe('botones', () => {
    it('reconoce los 6 botones fijos sin importar mayúsculas y nada más', () => {
      expect(vistaDeTexto(BOTONES_JORNADA.SALIDA_DPI)).toBe('SALIDA_DPI');
      expect(vistaDeTexto(BOTONES_JORNADA.KIT.toUpperCase())).toBe('KIT');
      expect(vistaDeTexto(`  ${BOTONES_JORNADA.NO_CDA} `)).toBe('NO_CDA');
      expect(vistaDeTexto('/caidos')).toBeNull();
    });

    it('el callback_data va y vuelve, y rechaza lo mal formado', () => {
      const data = callbackJornada({ vista: 'LLEGADA_DPI', seleccion: 3, pagina: 2 });
      expect(data).toBe('jor:ld:3:2');
      expect(data.length).toBeLessThanOrEqual(64);
      expect(leerCallbackJornada(data)).toEqual({ vista: 'LLEGADA_DPI', seleccion: 3, pagina: 2 });
      expect(leerCallbackJornada('jor:nc:tod:0')).toEqual({ vista: 'NO_CDA', seleccion: 'tod', pagina: 0 });
      for (const malo of ['jor:xx:1:0', 'jor:sd:0:0', 'jor:sd:1:999', 'jor:sd:<b>:0', 'asig:1', undefined]) {
        expect(leerCallbackJornada(malo)).toBeNull();
      }
    });
  });

  it('el teléfono sale en formato internacional para poder tocarlo', () => {
    expect(telefonoTelegram('099 123 4567')).toBe('+593991234567');
    expect(telefonoTelegram('593991234567')).toBe('+593991234567');
    expect(telefonoTelegram('062612345')).toBe('062612345');
    expect(telefonoTelegram(null)).toBeNull();
    expect(telefonoTelegram('')).toBeNull();
  });

  describe('estado de cada vista', () => {
    it('separa quién falta y quién ya cumplió, ordenado por código', () => {
      const e = estadoVista(jornada(), 'SALIDA_DPI');
      expect(e.faltan.map((i) => i.codigoRecinto)).toEqual(['1290', '1487']);
      expect(e.cumplidos.map((i) => i.codigoRecinto)).toEqual(['971']);
    });

    it('kit pendiente: llegó al DPEI sin recibir el kit, o el kit se recibió sin marcar la llegada', () => {
      const j = jornada({
        unidades: [
          unidad('1', JAIRO, { registros: { LLEGADA_DPI: { en: A_LAS('18:40'), sinSenal: false } } }),
          unidad('2', JAIRO, { kitRecibido: A_LAS('18:50') }),
          unidad('3', JAIRO, { registros: { LLEGADA_DPI: { en: A_LAS('18:00'), sinSenal: false } }, kitRecibido: A_LAS('18:05') }),
          unidad('4', JAIRO),
        ],
      });
      const e = estadoVista(j, 'KIT');
      expect(e.faltan.map((i) => [i.codigoRecinto, i.nota])).toEqual([
        ['1', 'llegó al DPEI · el kit no se ha recibido'],
        ['2', 'kit recibido · falta marcar la llegada al DPEI'],
      ]);
      expect(e.cumplidos).toEqual([]);
    });

    it('NO CDA: visitados o no, con el código de su CDA', () => {
      const j = jornada({
        noCdas: [
          { codigoRecinto: '2001', nombreRecinto: 'NC A', codigoCda: '971', tecnico: JAIRO, personas: [], visita: null },
          {
            codigoRecinto: '2000',
            nombreRecinto: 'NC B',
            codigoCda: '971',
            tecnico: JAIRO,
            personas: [{ nombre: 'OP', telefono: null, rol: 'Op.' }],
            visita: { en: A_LAS('10:00'), sinSenal: false },
          },
        ],
      });
      const e = estadoVista(j, 'NO_CDA');
      expect(e.faltan.map((i) => [i.codigoRecinto, i.nota])).toEqual([['2001', 'CDA 971 · su CDA no tiene kit']]);
      expect(e.cumplidos.map((i) => [i.codigoRecinto, i.nota])).toEqual([['2000', 'CDA 971']]);
    });
  });

  describe('resumen', () => {
    it('muestra el avance total, una línea por técnico y los recintos sin kit aparte', () => {
      const texto = formatearResumenJornada(
        jornada({ sinKit: [{ codigoRecinto: '5', nombreRecinto: 'X', tecnico: JAIRO }] }),
        'SALIDA_DPI',
        AHORA,
      );
      expect(texto).toContain('<b>🚐 Salida del DPEI</b> · 09:00');
      expect(texto).toContain('<b>1 de 3</b> · faltan 2');
      expect(texto).toMatch(/Jairo {2}<code>[▓░]{5}<\/code> 1\/2 {2}faltan 1/);
      expect(texto).toMatch(/Carlos {2}<code>░{5}<\/code> 0\/1 {2}faltan 1/);
      expect(texto).toContain('⚪ 1 recinto CDA sin kit asignado (no cuentan)');
      // Jairo va antes que Carlos: orden del distributivo.
      expect(texto.indexOf('Jairo')).toBeLessThan(texto.indexOf('Carlos'));
    });

    it('con todos cumplidos marca ✅ y nunca llena la barra si falta alguno', () => {
      const listo = jornada({
        unidades: [unidad('1', JAIRO, { registros: { SALIDA_DPI: { en: AHORA, sinSenal: false } } })],
      });
      expect(formatearResumenJornada(listo, 'SALIDA_DPI', AHORA)).toContain('<code>▓▓▓▓▓▓▓▓▓▓</code>  <b>1 de 1</b> ✅');

      const casi = jornada({
        unidades: [
          ...Array.from({ length: 30 }, (_, i) =>
            unidad(String(i), JAIRO, { registros: { SALIDA_DPI: { en: AHORA, sinSenal: false } } }),
          ),
          unidad('99', JAIRO),
        ],
      });
      expect(formatearResumenJornada(casi, 'SALIDA_DPI', AHORA)).toContain('<code>▓▓▓▓▓▓▓▓▓░</code>');
    });

    it('sin kits lo dice, y avisa si no se pudo leer el distributivo', () => {
      const texto = formatearResumenJornada(jornada({ unidades: [], sinDistributivo: true }), 'LLEGADA_RECINTO', AHORA);
      expect(texto).toContain('Todavía no hay kits asignados en este evento.');
      expect(texto).toContain('No se pudo leer el distributivo');
    });

    it('kit pendiente: cuántos y de qué técnico', () => {
      const j = jornada({
        unidades: [unidad('1', CARLOS, { registros: { LLEGADA_DPI: { en: AHORA, sinSenal: false } } }), unidad('2', JAIRO)],
      });
      const texto = formatearResumenJornada(j, 'KIT', AHORA);
      expect(texto).toContain('<b>1</b> con el kit pendiente');
      expect(texto).toContain('Carlos · 1');
      expect(texto).not.toContain('Jairo');
      expect(formatearResumenJornada(jornada(), 'KIT', AHORA)).toContain('✅ Nadie tiene el kit pendiente.');
    });

    it('escapa los nombres que vienen de las hojas', () => {
      const j = jornada({ evento: 'E <x>', unidades: [unidad('1', { numero: 1, nombre: '<b>Malo</b>' })] });
      const texto = formatearResumenJornada(j, 'SALIDA_DPI', AHORA);
      expect(texto).toContain('&lt;b&gt;Malo&lt;/b&gt;');
      expect(texto).toContain('E &lt;x&gt;');
    });
  });

  describe('detalle de un técnico', () => {
    it('primero los que faltan (recinto en negrita, personas y teléfono) y después los que cumplieron con la hora', () => {
      const [pagina] = paginasDetalleJornada(jornada(), 'SALIDA_DPI', 1, AHORA);
      expect(pagina).toContain('<b>🚐 Salida del DPEI · Jairo</b>');
      expect(pagina).toContain('Faltan <b>1</b> de 2');
      expect(pagina).toContain('<b>1290 · Recinto 1290</b>\n   OP 1290 (Op.) +593991234567 · AS 1290 (Asis.)');
      expect(pagina).toContain('<b>✅ YA SALIERON (1)</b>');
      expect(pagina).toContain('<b>971 · Recinto 971</b> · 08:12 📴');
      expect(pagina.indexOf('FALTAN')).toBeLessThan(pagina.indexOf('YA SALIERON'));
      expect(pagina).not.toContain('1487');
    });

    it('lista aparte los recintos sin kit del técnico', () => {
      const [pagina] = paginasDetalleJornada(
        jornada({ sinKit: [{ codigoRecinto: '5', nombreRecinto: 'Sin kit', tecnico: JAIRO }] }),
        'LLEGADA_RECINTO',
        1,
        AHORA,
      );
      expect(pagina).toContain('<b>⚪ SIN KIT ASIGNADO (1)</b>\n\n5 · Sin kit');
    });

    it('"todos los que faltan" los agrupa por técnico y no lista a quien ya cumplió', () => {
      const [pagina] = paginasDetalleJornada(jornada(), 'SALIDA_DPI', 'tod', AHORA);
      expect(pagina).toContain('<u>Jairo (1)</u>');
      expect(pagina).toContain('<u>Carlos (1)</u>');
      expect(pagina).not.toContain('YA SALIERON');
      expect(pagina).not.toContain('971');
    });

    it('sin nadie pendiente lo dice', () => {
      const listo = jornada({ unidades: [unidad('1', JAIRO, { registros: { SALIDA_DPI: { en: AHORA, sinSenal: false } } })] });
      expect(paginasDetalleJornada(listo, 'SALIDA_DPI', 1, AHORA)[0]).toContain('✅ No falta nadie.');
    });

    it('una lista larga se reparte en páginas que Telegram acepta, con el encabezado en cada una', () => {
      const muchas = jornada({ unidades: Array.from({ length: 80 }, (_, i) => unidad(String(1000 + i), JAIRO)) });
      const paginas = paginasDetalleJornada(muchas, 'SALIDA_DPI', 1, AHORA);
      expect(paginas.length).toBeGreaterThan(1);
      for (const [i, p] of paginas.entries()) {
        expect(p.length).toBeLessThanOrEqual(4096);
        expect(p).toContain(`pág. ${i + 1}/${paginas.length}`);
        expect(p).toContain('Salida del DPEI · Jairo');
      }
      // Ningún recinto se pierde ni se repite entre páginas.
      const recintos = paginas.join('\n').match(/<b>1\d{3} · /g) ?? [];
      expect(recintos).toHaveLength(80);
    });

    it('"Sin técnico" para los recintos que no están en el distributivo', () => {
      const [pagina] = paginasDetalleJornada(jornada({ unidades: [unidad('1', SIN)] }), 'SALIDA_DPI', 'sin', AHORA);
      expect(pagina).toContain('Salida del DPEI · Sin técnico');
    });
  });

  describe('teclado de técnicos', () => {
    it('cada técnico dice cuántos le faltan; el elegido va marcado; hay resumen, páginas y actualizar', () => {
      const teclado = tecladoJornada(jornada(), 'SALIDA_DPI', 1, 1, 3);
      const textos = teclado.inline_keyboard.flat().map((b) => [b.text, b.callback_data]);
      expect(textos).toEqual([
        ['• Jairo · 1 •', 'jor:sd:1:0'],
        ['Carlos · 1', 'jor:sd:2:0'],
        ['◀ Resumen', 'jor:sd:res:0'],
        ['◀ Pág.', 'jor:sd:1:0'],
        ['Pág. ▶', 'jor:sd:1:2'],
        ['↻ Actualizar', 'jor:sd:1:1'],
      ]);
    });

    it('en el resumen ofrece "Ver todos los que faltan" y marca ✅ a quien ya terminó', () => {
      const j = jornada({
        unidades: [unidad('1', JAIRO, { registros: { SALIDA_DPI: { en: AHORA, sinSenal: false } } }), unidad('2', CARLOS)],
      });
      const textos = tecladoJornada(j, 'SALIDA_DPI').inline_keyboard.map((fila) => fila.map((b) => b.text));
      expect(textos).toEqual([['Jairo · ✅', 'Carlos · 1'], ['↻ Actualizar'], ['Ver todos los que faltan']]);
    });

    it('kit pendiente solo muestra a los técnicos con pendientes', () => {
      const j = jornada({ unidades: [unidad('1', CARLOS, { kitRecibido: AHORA }), unidad('2', JAIRO)] });
      const textos = tecladoJornada(j, 'KIT').inline_keyboard.flat().map((b) => b.text);
      expect(textos).toEqual(['Carlos · 1', '↻ Actualizar', 'Ver todos los que faltan']);
    });

    it('de 3 en 3 por fila', () => {
      const tecnicos = [1, 2, 3, 4, 5].map((n) => ({ numero: n, nombre: `T${n}` }));
      const j = jornada({ unidades: tecnicos.map((t) => unidad(String(t.numero), t)) });
      const filas = tecladoJornada(j, 'SALIDA_DPI').inline_keyboard;
      expect(filas[0]).toHaveLength(3);
      expect(filas[1]).toHaveLength(2);
    });
  });
});
