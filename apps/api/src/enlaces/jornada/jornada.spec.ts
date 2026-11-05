import {
  BOTONES_JORNADA,
  callbackFichaCda,
  callbackJornada,
  conteosJornada,
  consultablesDe,
  estadoVista,
  formatearFichaCda,
  formatearResumenAutomatico,
  formatearResumenJornada,
  gruposDe,
  jornadaCerrada,
  jornadaEmpezada,
  leerCallbackFichaCda,
  leerCallbackJornada,
  paginasDetalleJornada,
  tecladoFichaCda,
  tecladoFijoJornada,
  tecladoJornada,
  tecladoResumenAutomatico,
  telefonoTelegram,
  vistaDeTexto,
  type CantonJornada,
  type Jornada,
  type NoCdaJornada,
  type TecnicoJornada,
  type UnidadJornada,
} from './jornada';

const JAIRO: TecnicoJornada = { numero: 1, nombre: 'Jairo' };
const CARLOS: TecnicoJornada = { numero: 2, nombre: 'Carlos' };
const SIN: TecnicoJornada = { numero: null, nombre: '' };
const IBARRA: CantonJornada = { codigo: 30, nombre: 'IBARRA' };
const OTAVALO: CantonJornada = { codigo: 35, nombre: 'OTAVALO' };
// 14:00 UTC = 09:00 en Ecuador.
const AHORA = new Date('2026-11-29T14:00:00Z');
const A_LAS = (hhmm: string) => new Date(`2026-11-29T${hhmm}:00-05:00`);

function unidad(codigo: string, tecnico: TecnicoJornada, extra: Partial<UnidadJornada> = {}): UnidadJornada {
  return {
    codigoRecinto: codigo,
    nombreRecinto: `Recinto ${codigo}`,
    tecnico,
    canton: IBARRA,
    personas: [
      { nombre: `OP ${codigo}`, telefono: '0991234567', rol: 'Op.' },
      { nombre: `AS ${codigo}`, telefono: null, rol: 'Asis.' },
    ],
    registros: {},
    kitRecibido: null,
    ...extra,
  };
}

function noCda(codigo: string, cda: string, extra: Partial<NoCdaJornada> = {}): NoCdaJornada {
  return {
    codigoRecinto: codigo,
    nombreRecinto: `NC ${codigo}`,
    codigoCda: cda,
    nombreCda: `Recinto ${cda}`,
    tecnico: JAIRO,
    canton: IBARRA,
    personas: [{ nombre: `OP ${cda}`, telefono: null, rol: 'Op.' }],
    visita: null,
    cdaConKit: true,
    ...extra,
  };
}

function jornada(extra: Partial<Jornada> = {}): Jornada {
  return {
    evento: 'Elecciones 2027',
    unidades: [
      unidad('1487', CARLOS, { canton: OTAVALO }),
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
    it('reconoce los 6 botones fijos sin importar mayúsculas, y el teclado trae "Consultar CDA"', () => {
      expect(vistaDeTexto(BOTONES_JORNADA.SALIDA_DPI)).toBe('SALIDA_DPI');
      expect(vistaDeTexto(BOTONES_JORNADA.KIT.toUpperCase())).toBe('KIT');
      expect(vistaDeTexto(`  ${BOTONES_JORNADA.NO_CDA} `)).toBe('NO_CDA');
      // El botón de antes (teclado viejo en el celular) sigue funcionando.
      expect(vistaDeTexto('🏫 Visitas NO CDA')).toBe('NO_CDA');
      expect(BOTONES_JORNADA.NO_CDA).toBe('🏫 Llegada NO CDA');
      expect(vistaDeTexto('/caidos')).toBeNull();
      expect(JSON.stringify(tecladoFijoJornada())).toContain('🔎 Consultar CDA');
    });

    it('el callback_data va y vuelve con la agrupación, acepta los botones de antes y rechaza lo mal formado', () => {
      const data = callbackJornada({ vista: 'LLEGADA_DPI', agrupacion: 'can', seleccion: 35, pagina: 2 });
      expect(data).toBe('jor:ld:c:35:2');
      expect(data.length).toBeLessThanOrEqual(64);
      expect(leerCallbackJornada(data)).toEqual({ vista: 'LLEGADA_DPI', agrupacion: 'can', seleccion: 35, pagina: 2 });
      expect(leerCallbackJornada('jor:nc:t:tod:0')).toEqual({ vista: 'NO_CDA', agrupacion: 'tec', seleccion: 'tod', pagina: 0 });
      // Botón publicado antes de la agrupación: por técnico.
      expect(leerCallbackJornada('jor:sd:3:0')).toEqual({ vista: 'SALIDA_DPI', agrupacion: 'tec', seleccion: 3, pagina: 0 });
      for (const malo of ['jor:xx:t:1:0', 'jor:sd:t:0:0', 'jor:sd:x:1:0', 'jor:sd:t:1:999', 'jor:sd:<b>:0', 'asig:1', undefined]) {
        expect(leerCallbackJornada(malo)).toBeNull();
      }
    });

    it('el botón de ficha de un CDA va y vuelve', () => {
      expect(callbackFichaCda('1133')).toBe('jor:cda:1133');
      expect(leerCallbackFichaCda('jor:cda:1133')).toBe('1133');
      expect(leerCallbackFichaCda('jor:cda:<b>')).toBeNull();
      expect(leerCallbackFichaCda('jor:sd:t:1:0')).toBeNull();
      expect(leerCallbackFichaCda(`jor:cda:${'1'.repeat(21)}`)).toBeNull();
      // El peor caso cabe en los 64 bytes de Telegram.
      expect(callbackFichaCda('x'.repeat(20)).length).toBeLessThanOrEqual(64);
      expect(callbackJornada({ vista: 'SALIDA_RECINTO', agrupacion: 'can', seleccion: 999, pagina: 99 }).length).toBeLessThanOrEqual(64);
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

    it('NO CDA: visitados o no, con su CDA', () => {
      const j = jornada({ noCdas: [noCda('2001', '971'), noCda('2000', '971', { visita: { en: A_LAS('10:00'), sinSenal: false } })] });
      const e = estadoVista(j, 'NO_CDA');
      expect(e.faltan.map((i) => [i.codigoRecinto, i.cda])).toEqual([['2001', { codigo: '971', nombre: 'Recinto 971' }]]);
      expect(e.cumplidos.map((i) => i.codigoRecinto)).toEqual(['2000']);
    });
  });

  describe('grupos', () => {
    it('técnicos en el orden del distributivo y cantones por nombre, "Sin …" al final', () => {
      const j = jornada({ unidades: [...jornada().unidades, unidad('9', SIN, { canton: { codigo: null, nombre: 'Sin cantón' } })] });
      expect(gruposDe(j, 'tec').map((g) => g.nombre)).toEqual(['Jairo', 'Carlos', 'Sin técnico']);
      expect(gruposDe(j, 'can').map((g) => [g.clave, g.nombre])).toEqual([
        [30, 'IBARRA'],
        [35, 'OTAVALO'],
        ['sin', 'Sin cantón'],
      ]);
    });
  });

  describe('resumen', () => {
    it('muestra el avance total, una línea por técnico y los recintos sin kit aparte', () => {
      const texto = formatearResumenJornada(
        jornada({ sinKit: [{ codigoRecinto: '5', nombreRecinto: 'X', tecnico: JAIRO, canton: IBARRA }] }),
        'SALIDA_DPI',
        AHORA,
      );
      expect(texto).toContain('<b>🚐 Salida del DPEI</b> · 09:00');
      expect(texto).toContain('<b>1 de 3</b> · faltan 2');
      expect(texto).toMatch(/Jairo {2}<code>[▓░]{5}<\/code> 1\/2 {2}faltan 1/);
      expect(texto).toMatch(/Carlos {2}<code>░{5}<\/code> 0\/1 {2}faltan 1/);
      expect(texto).toContain('⚪ 1 recinto CDA sin kit asignado (no cuentan)');
      expect(texto.indexOf('Jairo')).toBeLessThan(texto.indexOf('Carlos'));
    });

    it('por cantón: una línea por cantón y el título lo dice', () => {
      const texto = formatearResumenJornada(jornada(), 'SALIDA_DPI', AHORA, 'can');
      expect(texto).toContain('<b>🚐 Salida del DPEI · por cantón</b>');
      expect(texto).toMatch(/IBARRA {2}<code>[▓░]{5}<\/code> 1\/2 {2}faltan 1/);
      expect(texto).toMatch(/OTAVALO {2}<code>░{5}<\/code> 0\/1 {2}faltan 1/);
      expect(texto).not.toContain('Jairo');
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

    it('sin kits lo dice, y avisa si no se pudo leer el distributivo (solo por técnico)', () => {
      const j = jornada({ unidades: [], sinDistributivo: true });
      const texto = formatearResumenJornada(j, 'LLEGADA_RECINTO', AHORA);
      expect(texto).toContain('Todavía no hay kits asignados en este evento.');
      expect(texto).toContain('No se pudo leer el distributivo');
      expect(formatearResumenJornada(j, 'LLEGADA_RECINTO', AHORA, 'can')).not.toContain('distributivo');
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

    it('NO CDA: cuántos CDA están completos (llegaron todos sus NO CDA)', () => {
      const visita = { en: A_LAS('10:00'), sinSenal: false };
      const j = jornada({ noCdas: [noCda('2000', '971', { visita }), noCda('2001', '971'), noCda('3000', '1290', { visita })] });
      const texto = formatearResumenJornada(j, 'NO_CDA', AHORA);
      expect(texto).toContain('<b>2 de 3</b> · faltan 1');
      expect(texto).toContain('🏫 1 de 2 CDA completos (llegaron todos sus NO CDA)');
    });

    it('escapa los nombres que vienen de las hojas', () => {
      const j = jornada({ evento: 'E <x>', unidades: [unidad('1', { numero: 1, nombre: '<b>Malo</b>' })] });
      const texto = formatearResumenJornada(j, 'SALIDA_DPI', AHORA);
      expect(texto).toContain('&lt;b&gt;Malo&lt;/b&gt;');
      expect(texto).toContain('E &lt;x&gt;');
    });
  });

  describe('detalle de un técnico o cantón', () => {
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

    it('un cantón lista solo sus recintos', () => {
      const [pagina] = paginasDetalleJornada(jornada(), 'SALIDA_DPI', 35, AHORA, 'can');
      expect(pagina).toContain('Salida del DPEI · OTAVALO');
      expect(pagina).toContain('1487');
      expect(pagina).not.toContain('1290');
    });

    it('lista aparte los recintos sin kit del grupo', () => {
      const [pagina] = paginasDetalleJornada(
        jornada({ sinKit: [{ codigoRecinto: '5', nombreRecinto: 'Sin kit', tecnico: JAIRO, canton: IBARRA }] }),
        'LLEGADA_RECINTO',
        1,
        AHORA,
      );
      expect(pagina).toContain('<b>⚪ SIN KIT ASIGNADO (1)</b>\n\n5 · Sin kit');
    });

    it('"todos los que faltan" los agrupa y no lista a quien ya cumplió', () => {
      const [pagina] = paginasDetalleJornada(jornada(), 'SALIDA_DPI', 'tod', AHORA);
      expect(pagina).toContain('<u>Jairo (1)</u>');
      expect(pagina).toContain('<u>Carlos (1)</u>');
      expect(pagina).not.toContain('YA SALIERON');
      expect(pagina).not.toContain('971');
      expect(paginasDetalleJornada(jornada(), 'SALIDA_DPI', 'tod', AHORA, 'can')[0]).toContain('<u>OTAVALO (1)</u>');
    });

    it('NO CDA agrupados debajo de su CDA, primero los CDA con pendientes', () => {
      const visita = { en: A_LAS('10:15'), sinSenal: false };
      const j = jornada({
        noCdas: [
          noCda('3000', '1290', { visita }),
          noCda('542', '1133', { visita, nombreCda: 'UE Manuel J. Calle' }),
          noCda('5968', '1133', { nombreCda: 'UE Manuel J. Calle', personas: [] }),
        ],
      });
      const [pagina] = paginasDetalleJornada(j, 'NO_CDA', 1, AHORA);
      expect(pagina).toContain(
        '<b>1133 · UE Manuel J. Calle</b> — 1 de 2 llegaron\n   <i>su CDA no tiene kit</i>\n   ⏳ 5968 · NC 5968\n   ✅ 542 · NC 542 · 10:15',
      );
      expect(pagina).toContain('<b>1290 · Recinto 1290</b> — 1 de 1 llegó\n   OP 1290 (Op.)\n   ✅ 3000 · NC 3000 · 10:15');
      expect(pagina.indexOf('1133 ·')).toBeLessThan(pagina.indexOf('1290 ·'));
    });

    it('NO CDA "todos los que faltan": solo los CDA con pendientes, contando todos sus NO CDA', () => {
      const visita = { en: A_LAS('10:15'), sinSenal: false };
      const j = jornada({ noCdas: [noCda('3000', '1290', { visita }), noCda('542', '1133', { visita }), noCda('5968', '1133')] });
      const [pagina] = paginasDetalleJornada(j, 'NO_CDA', 'tod', AHORA);
      expect(pagina).toContain('<b>1133 · Recinto 1133</b> — 1 de 2 llegaron');
      expect(pagina).toContain('⏳ 5968');
      expect(pagina).not.toContain('✅ 542');
      expect(pagina).not.toContain('1290 ·');
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
      const recintos = paginas.join('\n').match(/<b>1\d{3} · /g) ?? [];
      expect(recintos).toHaveLength(80);
    });

    it('"Sin técnico" para los recintos que no están en el distributivo', () => {
      const [pagina] = paginasDetalleJornada(jornada({ unidades: [unidad('1', SIN)] }), 'SALIDA_DPI', 'sin', AHORA);
      expect(pagina).toContain('Salida del DPEI · Sin técnico');
    });
  });

  describe('teclado', () => {
    it('cada grupo dice cuántos faltan; el elegido va marcado; hay resumen, páginas y actualizar', () => {
      const teclado = tecladoJornada(jornada(), 'SALIDA_DPI', 1, 1, 3);
      const textos = teclado.inline_keyboard.flat().map((b) => [b.text, b.callback_data]);
      expect(textos).toEqual([
        ['• Jairo · 1 •', 'jor:sd:t:1:0'],
        ['Carlos · 1', 'jor:sd:t:2:0'],
        ['◀ Resumen', 'jor:sd:t:res:0'],
        ['◀ Pág.', 'jor:sd:t:1:0'],
        ['Pág. ▶', 'jor:sd:t:1:2'],
        ['↻ Actualizar', 'jor:sd:t:1:1'],
      ]);
    });

    it('en el resumen ofrece "Ver todos los que faltan" y cambiar entre técnico y cantón', () => {
      const j = jornada({
        unidades: [unidad('1', JAIRO, { registros: { SALIDA_DPI: { en: AHORA, sinSenal: false } } }), unidad('2', CARLOS)],
      });
      const textos = tecladoJornada(j, 'SALIDA_DPI').inline_keyboard.map((fila) => fila.map((b) => b.text));
      expect(textos).toEqual([
        ['Jairo · ✅', 'Carlos · 1'],
        ['↻ Actualizar'],
        ['Ver todos los que faltan'],
        ['• 👷 Por técnico •', '🗺️ Por cantón'],
      ]);
      const porCanton = tecladoJornada(j, 'SALIDA_DPI', 'res', 0, 1, 'can').inline_keyboard.flat();
      expect(porCanton.map((b) => b.text)).toContain('• 🗺️ Por cantón •');
      expect(porCanton.find((b) => b.text === 'IBARRA · 1')?.callback_data).toBe('jor:sd:c:30:0');
      expect(porCanton.find((b) => b.text === '👷 Por técnico')?.callback_data).toBe('jor:sd:t:res:0');
    });

    it('kit pendiente solo muestra a los grupos con pendientes', () => {
      const j = jornada({ unidades: [unidad('1', CARLOS, { kitRecibido: AHORA }), unidad('2', JAIRO)] });
      const textos = tecladoJornada(j, 'KIT').inline_keyboard.flat().map((b) => b.text);
      expect(textos).toEqual(['Carlos · 1', '↻ Actualizar', 'Ver todos los que faltan', '• 👷 Por técnico •', '🗺️ Por cantón']);
    });

    it('de 3 en 3 por fila', () => {
      const tecnicos = [1, 2, 3, 4, 5].map((n) => ({ numero: n, nombre: `T${n}` }));
      const j = jornada({ unidades: tecnicos.map((t) => unidad(String(t.numero), t)) });
      const filas = tecladoJornada(j, 'SALIDA_DPI').inline_keyboard;
      expect(filas[0]).toHaveLength(3);
      expect(filas[1]).toHaveLength(2);
    });
  });

  describe('NO CDA por CDA', () => {
    const visita = { en: A_LAS('10:15'), sinSenal: false };
    const conNoCda = () =>
      jornada({
        noCdas: [
          noCda('3000', '1290', { visita }),
          noCda('542', '1133', { visita, nombreCda: 'UE Manuel J. Calle' }),
          noCda('5968', '1133', { nombreCda: 'UE Manuel J. Calle' }),
          noCda('7000', '800', { cdaConKit: false }),
          noCda('7001', '800', { cdaConKit: false }),
        ],
      });

    it('los NO CDA de un CDA sin kit no cuentan y se avisan aparte', () => {
      const e = estadoVista(conNoCda(), 'NO_CDA');
      expect(e.faltan.map((i) => i.codigoRecinto)).toEqual(['5968']);
      expect(e.cumplidos).toHaveLength(2);
      const texto = formatearResumenJornada(conNoCda(), 'NO_CDA', AHORA);
      expect(texto).toContain('<b>2 de 3</b> · faltan 1');
      expect(texto).toContain('🏫 1 de 2 CDA completos (llegaron todos sus NO CDA)');
      expect(texto).toContain('⚪ 2 NO CDA de CDA sin kit (no cuentan)');
    });

    it('el resumen por CDA lista cada CDA con su avance, primero los incompletos', () => {
      const texto = formatearResumenJornada(conNoCda(), 'NO_CDA', AHORA, 'cda');
      expect(texto).toContain('🏫 Llegada de los NO CDA a su CDA · por CDA');
      expect(texto).toContain('⏳ <b>1133</b> · UE Manuel J. Calle — 1/2\n✅ <b>1290</b> · Recinto 1290 — 1/1');
      expect(texto).not.toContain('800');
      expect(texto).toContain('⚪ 2 NO CDA de CDA sin kit (no cuentan)');
    });

    it('por CDA cada botón abre la ficha del CDA, de 2 en 2, y se puede cambiar de agrupación', () => {
      const filas = tecladoJornada(conNoCda(), 'NO_CDA', 'res', 0, 1, 'cda').inline_keyboard;
      expect(filas[0]).toEqual([
        { text: '1133 UE Manuel J. Call · 1', callback_data: 'jor:cda:1133' },
        { text: '1290 Recinto 1290 · ✅', callback_data: 'jor:cda:1290' },
      ]);
      expect(filas.flat().map((b) => b.text)).toEqual(expect.arrayContaining(['↻ Actualizar', 'Ver todos los que faltan', '• 🏫 Por CDA •']));
      expect(filas.flat().find((b) => b.text === '↻ Actualizar')?.callback_data).toBe('jor:nc:d:res:0');
      // Las demás vistas no ofrecen "Por CDA".
      expect(tecladoJornada(conNoCda(), 'SALIDA_DPI').inline_keyboard.flat().map((b) => b.text)).not.toContain('🏫 Por CDA');
    });

    it('el callback por CDA solo vale en NO CDA y sin grupos', () => {
      expect(leerCallbackJornada('jor:nc:d:res:0')).toEqual({ vista: 'NO_CDA', agrupacion: 'cda', seleccion: 'res', pagina: 0 });
      expect(leerCallbackJornada('jor:nc:d:tod:1')).toEqual({ vista: 'NO_CDA', agrupacion: 'cda', seleccion: 'tod', pagina: 1 });
      expect(leerCallbackJornada('jor:nc:d:3:0')).toEqual({ vista: 'NO_CDA', agrupacion: 'cda', seleccion: 'res', pagina: 0 });
      expect(leerCallbackJornada('jor:nc:d:sin:0')).toEqual({ vista: 'NO_CDA', agrupacion: 'cda', seleccion: 'res', pagina: 0 });
      expect(leerCallbackJornada('jor:sd:d:3:0')).toEqual({ vista: 'SALIDA_DPI', agrupacion: 'tec', seleccion: 3, pagina: 0 });
    });

    it('por CDA escapa los nombres y no pasa de 90 botones de CDA', () => {
      const j = jornada({ noCdas: [noCda('1', '9', { nombreCda: 'UE <A&B>' })] });
      expect(formatearResumenJornada(j, 'NO_CDA', AHORA, 'cda')).toContain('<b>9</b> · UE &lt;A&amp;B&gt; — 0/1');
      const muchos = jornada({ noCdas: Array.from({ length: 120 }, (_, i) => noCda(String(5000 + i), String(100 + i))) });
      const botones = tecladoJornada(muchos, 'NO_CDA', 'res', 0, 1, 'cda').inline_keyboard.flat();
      expect(botones.filter((b) => b.callback_data.startsWith('jor:cda:'))).toHaveLength(90);
      expect(botones.length).toBeLessThanOrEqual(100);
      expect(formatearResumenJornada(muchos, 'NO_CDA', AHORA, 'cda').length).toBeLessThanOrEqual(3800);
    });

    it('si ningún NO CDA cuenta lo dice, y sus técnicos no aparecen como grupo', () => {
      const j = jornada({ noCdas: [noCda('7000', '800', { cdaConKit: false, tecnico: { numero: 9, nombre: 'Solo NC' } })] });
      const texto = formatearResumenJornada(j, 'NO_CDA', AHORA, 'cda');
      expect(texto).toContain('No hay recintos NO CDA de un CDA con kit en este evento.');
      expect(texto).toContain('⚪ 1 NO CDA de CDA sin kit (no cuentan)');
      expect(gruposDe(j, 'tec').map((g) => g.nombre)).not.toContain('Solo NC');
    });

    it('la ficha de un CDA con NO CDA ofrece volver al resumen por CDA', () => {
      const j = conNoCda();
      expect(tecladoFichaCda(j, '1133').inline_keyboard[0].map((b) => b.callback_data)).toEqual(['jor:cda:1133', 'jor:nc:d:res:0']);
      expect(tecladoFichaCda(j, '971').inline_keyboard[0]).toHaveLength(1);
      expect(tecladoFichaCda(j, '800').inline_keyboard[0]).toHaveLength(1);
    });
  });

  describe('resumen automático', () => {
    const r = (h: string) => ({ en: A_LAS(h), sinSenal: false });
    const enCurso = () =>
      jornada({
        unidades: [
          unidad('971', JAIRO, { registros: { SALIDA_DPI: r('07:00'), LLEGADA_RECINTO: r('08:00'), SALIDA_RECINTO: r('17:00') } }),
          unidad('1290', JAIRO, { registros: { SALIDA_DPI: r('07:05'), LLEGADA_RECINTO: r('08:10') } }),
        ],
        noCdas: [noCda('3000', '1290', { visita: r('10:15') }), noCda('3001', '1290'), noCda('4000', '971', { visita: r('10:20') })],
      });

    it('una línea por momento con su avance, NO CDA con CDA completos y los kits pendientes', () => {
      const texto = formatearResumenAutomatico(enCurso(), AHORA);
      expect(texto).toContain('<b>📋 Jornada</b> · 09:00 · resumen automático');
      expect(texto).toContain(`${BOTONES_JORNADA.SALIDA_DPI}  <code>▓▓▓▓▓▓▓▓▓▓</code> 2/2 ✅`);
      expect(texto).toContain(`${BOTONES_JORNADA.SALIDA_RECINTO}  <code>▓▓▓▓▓░░░░░</code> 1/2 · faltan 1`);
      expect(texto).toContain(`${BOTONES_JORNADA.NO_CDA}  <code>▓▓▓▓▓▓▓░░░</code> 2/3 · faltan 1 · 1 de 2 CDA completos`);
      expect(texto).toContain(`${BOTONES_JORNADA.KIT}: ninguno`);
      expect(texto).not.toContain('Desde las');
    });

    it('con un resumen anterior dice qué cambió desde esa hora', () => {
      const antes = conteosJornada(
        jornada({
          unidades: [unidad('971', JAIRO, { registros: { SALIDA_DPI: r('07:00') } }), unidad('1290', JAIRO)],
          noCdas: [noCda('3000', '1290'), noCda('3001', '1290'), noCda('4000', '971')],
        }),
      );
      const texto = formatearResumenAutomatico(enCurso(), AHORA, { conteos: antes, en: A_LAS('08:45') });
      expect(texto).toContain(
        'Desde las 08:45: 🚐 +1 salieron del DPEI · 📍 +2 llegaron al recinto · 🏁 +1 salieron del recinto · 🏫 +2 NO CDA llegaron',
      );
    });

    it('empezada con la primera salida del DPEI; cerrada con todos en el DPEI y sin kits pendientes', () => {
      expect(jornadaEmpezada(jornada({ unidades: [unidad('1', JAIRO)] }))).toBe(false);
      expect(jornadaEmpezada(enCurso())).toBe(true);
      expect(jornadaCerrada(enCurso())).toBe(false);
      expect(jornadaCerrada(jornada({ unidades: [] }))).toBe(false);

      const todos = { SALIDA_DPI: r('07:00'), LLEGADA_DPI: r('19:00') };
      const sinKit = jornada({ unidades: [unidad('1', JAIRO, { registros: todos })] });
      expect(jornadaCerrada(sinKit)).toBe(false);
      const lista = jornada({ unidades: [unidad('1', JAIRO, { registros: todos, kitRecibido: A_LAS('19:05') })] });
      expect(jornadaCerrada(lista)).toBe(true);
      expect(formatearResumenAutomatico(lista, AHORA)).toContain('<b>✅ Jornada cerrada</b>');
    });

    it('un botón por vista; NO CDA abre por CDA', () => {
      const botones = tecladoResumenAutomatico().inline_keyboard.flat();
      expect(botones).toHaveLength(6);
      expect(botones.find((b) => b.text === BOTONES_JORNADA.NO_CDA)?.callback_data).toBe('jor:nc:d:res:0');
      expect(botones.find((b) => b.text === BOTONES_JORNADA.SALIDA_DPI)?.callback_data).toBe('jor:sd:t:res:0');
      for (const b of botones) expect(leerCallbackJornada(b.callback_data)).not.toBeNull();
    });
  });

  describe('Consultar CDA', () => {
    it('la ficha trae técnico, cantón, los 4 momentos, el kit, las personas y sus NO CDA', () => {
      const j = jornada({
        unidades: [
          unidad('1133', JAIRO, {
            nombreRecinto: 'UE Manuel J. Calle',
            canton: OTAVALO,
            registros: {
              SALIDA_DPI: { en: A_LAS('07:10'), sinSenal: false },
              LLEGADA_RECINTO: { en: A_LAS('08:02'), sinSenal: true },
            },
          }),
        ],
        noCdas: [noCda('542', '1133', { visita: { en: A_LAS('10:15'), sinSenal: false } }), noCda('5968', '1133')],
      });
      const ficha = formatearFichaCda(j, '1133', AHORA)!;
      expect(ficha).toContain('<b>🔎 1133 · UE Manuel J. Calle</b> · 09:00');
      expect(ficha).toContain('OTAVALO · Técnico: Jairo');
      expect(ficha).toContain('🚐 Salió del DPEI 07:10');
      expect(ficha).toContain('📍 Llegó al recinto 08:02 📴');
      expect(ficha).toContain('🏁 Falta salir del recinto');
      expect(ficha).toContain('🏢 Falta llegar al DPEI');
      expect(ficha).toContain('📦 Kit: aún no se recibe en el DPEI');
      expect(ficha).toContain('OP 1133 (Op.) +593991234567 · AS 1133 (Asis.)');
      expect(ficha).toContain('🏫 <b>NO CDA: 1 de 2 llegaron</b>\n   ⏳ 5968 · NC 5968\n   ✅ 542 · NC 542 · 10:15');
    });

    it('una ficha que no cabe quita líneas completas del final (el HTML queda válido) y lo dice', () => {
      const muchos = Array.from({ length: 300 }, (_, i) => noCda(String(5000 + i), '971', { nombreRecinto: `Escuela <&> ${i}` }));
      const ficha = formatearFichaCda(jornada({ noCdas: muchos }), '971', AHORA)!;
      expect(ficha.length).toBeLessThanOrEqual(3800);
      expect(ficha).toMatch(/<i>… y \d+ líneas más<\/i>$/);
      expect((ficha.match(/<b>/g) ?? []).length).toBe((ficha.match(/<\/b>/g) ?? []).length);
      // Ninguna entidad cortada: cada & es el inicio de &lt; &gt; o &amp;.
      expect(ficha.replace(/&(lt|gt|amp|quot|#39);/g, '')).not.toContain('&');
    });

    it('con dos parejas las separa; un CDA sin kit lo dice; un código que no es CDA da null', () => {
      const dos = jornada({ unidades: [unidad('971', JAIRO), unidad('971', JAIRO)] });
      const ficha = formatearFichaCda(dos, '971', AHORA)!;
      expect(ficha).toContain('<u>Pareja 1</u>');
      expect(ficha).toContain('<u>Pareja 2</u>');

      const sinKit = jornada({ sinKit: [{ codigoRecinto: '5', nombreRecinto: 'Sin kit', tecnico: SIN, canton: IBARRA }] });
      expect(formatearFichaCda(sinKit, '5', AHORA)).toContain('⚪ Sin kit asignado en este evento.');
      expect(formatearFichaCda(sinKit, '5', AHORA)).toContain('IBARRA · sin técnico');
      expect(formatearFichaCda(jornada(), '9999', AHORA)).toBeNull();
    });

    it('se puede consultar un CDA (con o sin kit) o un NO CDA, que lleva a su CDA', () => {
      const j = jornada({
        sinKit: [{ codigoRecinto: '5', nombreRecinto: 'Sin kit', tecnico: SIN, canton: IBARRA }],
        noCdas: [noCda('542', '971')],
      });
      expect(consultablesDe(j).map((c) => [c.codigoRecinto, c.codigoCda, c.esNoCda])).toEqual([
        ['1487', '1487', false],
        ['971', '971', false],
        ['1290', '1290', false],
        ['5', '5', false],
        ['542', '971', true],
      ]);
    });
  });
});
