import { Logger } from '@nestjs/common';
import { AsistenteService, AYUDA_ASISTENTE, MAX_LARGO_PREGUNTA, preguntaPorTecnico } from './asistente.service';
import { AsistenteNoDisponible } from './llm.client';

const ENLACES = [
  { codigoRecinto: '28', nombreRecinto: 'Unidad Educativa Ibarra', canton: 'Ibarra', estado: 'ACTIVO' },
  { codigoRecinto: '1008', nombreRecinto: 'UE San Juan de Ilumán Bloque 2', canton: 'Otavalo', estado: 'FALLO' },
  { codigoRecinto: '1009', nombreRecinto: 'UE San Juan de Iluman Bloque 1', canton: 'Otavalo', estado: 'FALLO' },
  { codigoRecinto: '1961', nombreRecinto: 'UE García Moreno <b>', canton: 'Cotacachi', estado: 'FALLO' },
];

const ASIGNACIONES = [
  { codigoRecinto: '28', localidad: '', parroquia: 'SAGRARIO', numeroTecnico: 1, tecnico: 'Juan Pérez' },
  { codigoRecinto: '1008', localidad: '', parroquia: 'SAN JUAN DE ILUMAN', numeroTecnico: 2, tecnico: 'Ana Torres' },
  { codigoRecinto: '1009', localidad: '', parroquia: 'SAN JUAN DE ILUMAN', numeroTecnico: 2, tecnico: 'Ana Torres' },
  { codigoRecinto: '3000', localidad: 'Escuela sin enlace', parroquia: '', numeroTecnico: 2, tecnico: 'Ana Torres' },
  { codigoRecinto: '1961', localidad: '', parroquia: 'GARCIA MORENO', numeroTecnico: 3, tecnico: 'Juan Andrade' },
];

describe('AsistenteService', () => {
  const prisma = { enlaceRecinto: { findMany: jest.fn(), findUnique: jest.fn() }, enlaceCaida: { findMany: jest.fn() } };
  const haceMinutos = (m: number) => new Date(Date.now() - m * 60_000);
  const telegram = {
    enviarTexto: jest.fn().mockResolvedValue(undefined),
    enviarHtml: jest.fn().mockResolvedValue(undefined),
    enviarListaActual: jest.fn().mockResolvedValue(undefined),
    enviarAsignaciones: jest.fn().mockResolvedValue(undefined),
    indicarEscribiendo: jest.fn().mockResolvedValue(undefined),
  };
  const distributivo = { asignaciones: jest.fn() };
  const encargados = { encargados: jest.fn() };
  const llm = { elegirConsultas: jest.fn() };
  const estadisticas = { enviarEstadisticasTelegram: jest.fn().mockResolvedValue(undefined) };
  let service: AsistenteService;
  let logs: jest.SpyInstance[];

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.enlaceRecinto.findMany.mockResolvedValue(ENLACES);
    prisma.enlaceCaida.findMany.mockResolvedValue([]);
    distributivo.asignaciones.mockResolvedValue(ASIGNACIONES);
    encargados.encargados.mockResolvedValue(new Map([['28', { nombre: 'Rector Luis Mora', telefono: '0991234567' }]]));
    service = new AsistenteService(
      prisma as any,
      telegram as any,
      distributivo as any,
      encargados as any,
      llm as any,
      estadisticas as any,
    );
    logs = (['log', 'warn', 'error'] as const).map((m) => jest.spyOn(Logger.prototype, m).mockImplementation(() => undefined));
  });

  afterEach(() => logs.forEach((l) => l.mockRestore()));

  const consulta = (nombre: string, argumentos: unknown) => llm.elegirConsultas.mockResolvedValue([{ nombre, argumentos }]);
  const html = () => telegram.enviarHtml.mock.calls.map((c) => c[0]).join('\n---\n');

  describe('buscar_recinto', () => {
    it('un solo resultado: ficha con estado, encargado y técnico', async () => {
      consulta('buscar_recinto', { texto: 'colegio Ibarra' });

      await service.responder('dame el número del encargado del colegio Ibarra', 'c:1');

      expect(llm.elegirConsultas).toHaveBeenCalledWith('dame el número del encargado del colegio Ibarra', 'filtros');
      expect(telegram.indicarEscribiendo).toHaveBeenCalled();
      expect(html()).toBe(
        '📍 <b>28 · Unidad Educativa Ibarra</b> (Iba · SAGRARIO)\n' +
          'Enlace: ✅ activo\n' +
          '📞 Encargado: Rector Luis Mora · 0991234567\n' +
          '👷 Técnico: Juan Pérez',
      );
    });

    it('el teléfono nunca se manda al modelo: solo la pregunta', async () => {
      consulta('buscar_recinto', { texto: '28' });

      await service.responder('encargado del 28', 'c:1');

      expect(llm.elegirConsultas).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(llm.elegirConsultas.mock.calls)).not.toContain('0991234567');
    });

    it('varios resultados (hasta 5): lista con el contacto de cada uno y botones para la ficha', async () => {
      encargados.encargados.mockResolvedValue(new Map([['1008', { nombre: 'Rosa <Q>', telefono: '0987654321' }]]));
      consulta('buscar_recinto', { texto: 'San Juan de Ilumán' });

      await service.responder('encargado de San Juan de Ilumán', 'c:1');

      const [texto, , botones] = telegram.enviarHtml.mock.calls[0];
      expect(texto).toBe(
        '🔍 Encontré 2 recintos para "San Juan de Ilumán":\n' +
          '• <b>1008 · UE San Juan de Ilumán Bloque 2</b> 🔴\n   📞 Rosa &lt;Q&gt; · 0987654321\n' +
          '• <b>1009 · UE San Juan de Iluman Bloque 1</b> 🔴\n   📞 sin registrar\n\n' +
          'Toque uno para ver su ficha completa.',
      );
      expect(botones.inline_keyboard).toEqual([
        [{ text: '1008 · UE San Juan de Ilumán Bloque 2', callback_data: 'asis:rec:1008' }],
        [{ text: '1009 · UE San Juan de Iluman Bloque 1', callback_data: 'asis:rec:1009' }],
      ]);
    });

    it('más de 5 resultados: lista con contactos, sin botones; más de 15 pide más detalle', async () => {
      prisma.enlaceRecinto.findMany.mockResolvedValue(
        Array.from({ length: 17 }, (_, i) => ({ codigoRecinto: String(100 + i), nombreRecinto: `Escuela Mira ${i}`, canton: 'Ibarra', estado: 'ACTIVO' })),
      );
      consulta('buscar_recinto', { texto: 'mira' });

      await service.responder('escuela mira', 'c:1');

      const [texto, , botones] = telegram.enviarHtml.mock.calls[0];
      expect(texto).toContain('Encontré 17 recintos');
      expect(texto.match(/📞/g)).toHaveLength(15);
      expect(texto).toContain('… y 2 más. Pregunte con más detalle');
      expect(botones).toBeUndefined();
    });

    it('con nombres largos, la lista se corta antes del límite de Telegram', async () => {
      const largo = 'Unidad Educativa Fiscomisional Bilingüe Intercultural '.repeat(3);
      prisma.enlaceRecinto.findMany.mockResolvedValue(
        Array.from({ length: 15 }, (_, i) => ({ codigoRecinto: String(100 + i), nombreRecinto: `${largo}Mira ${i}`, canton: 'Ibarra', estado: 'FALLO' })),
      );
      encargados.encargados.mockResolvedValue(
        new Map(Array.from({ length: 15 }, (_, i) => [String(100 + i), { nombre: 'Licenciada María José Andrade de los Ríos Pérez', telefono: '0991234567' }])),
      );
      consulta('buscar_recinto', { texto: 'mira' });

      await service.responder('escuela mira', 'c:1');

      const [texto] = telegram.enviarHtml.mock.calls[0];
      expect(texto.length).toBeLessThan(4096);
      expect(texto).toMatch(/… y \d+ más\. Pregunte con más detalle/);
    });

    it('si hubo que tolerar un error de tipeo, avisa antes de responder', async () => {
      consulta('buscar_recinto', { texto: 'Iluman Bloqe 2' });

      await service.responder('iluman bloqe 2', 'c:1');

      const [aviso] = telegram.enviarHtml.mock.calls[0];
      expect(aviso).toBe('🔎 No encontré "Iluman Bloqe 2" tal cual; le muestro lo más parecido. Revise que sea lo que busca.');
      expect(telegram.enviarHtml.mock.calls[1][0]).toContain('1008 · UE San Juan de Ilumán Bloque 2');
    });

    it('"contacto de Ilumán" lista todos los recintos de la parroquia', async () => {
      distributivo.asignaciones.mockResolvedValue([
        ...ASIGNACIONES,
        { codigoRecinto: '1010', localidad: '', parroquia: 'SAN JUAN DE ILUMAN', numeroTecnico: 2, tecnico: 'Ana Torres' },
      ]);
      prisma.enlaceRecinto.findMany.mockResolvedValue([
        ...ENLACES,
        { codigoRecinto: '1010', nombreRecinto: 'Escuela Carabuela', canton: 'Otavalo', estado: 'ACTIVO' },
      ]);
      consulta('buscar_recinto', { texto: 'contacto de Ilumán' });

      await service.responder('dame el contacto de iluman', 'c:1');

      expect(html()).toContain('Encontré 3 recintos');
      expect(html()).toContain('1010 · Escuela Carabuela');
    });

    it('"quién es el técnico de Ilumán": los técnicos con sus códigos, sin rectores ni teléfonos', async () => {
      encargados.encargados.mockResolvedValue(new Map([['1008', { nombre: 'Rector Daniel', telefono: '0990808459' }]]));
      prisma.enlaceRecinto.findMany.mockResolvedValue([
        ...ENLACES,
        { codigoRecinto: '1010', nombreRecinto: 'Escuela Ilumán Alto', canton: 'Otavalo', estado: 'ACTIVO' },
      ]);
      consulta('buscar_recinto', { texto: 'Ilumán' });

      await service.responder('Quien es el técnico encargado de Iluman?', 'c:1');

      const [texto, , botones] = telegram.enviarHtml.mock.calls[0];
      expect(texto).toBe(
        '👷 Técnicos de "Ilumán" (3 recintos):\n' +
          '• 👷 <b>2. Ana Torres</b>: 2 recintos (1008, 1009)\n' +
          '• Sin técnico asignado: 1010',
      );
      expect(texto).not.toContain('0990808459');
      expect(botones).toBeUndefined();
    });

    it('preguntando por técnicos con muchos resultados: códigos acotados y mensaje dentro del límite de Telegram', async () => {
      const codigosDe = (i: number) => Array.from({ length: 25 }, (_, j) => String(10000 + i * 100 + j));
      prisma.enlaceRecinto.findMany.mockResolvedValue(
        Array.from({ length: 60 }, (_, i) => codigosDe(i)).flat().map((c) => ({ codigoRecinto: c, nombreRecinto: `Escuela Mira ${c}`, canton: 'Ibarra', estado: 'ACTIVO' })),
      );
      distributivo.asignaciones.mockResolvedValue(
        Array.from({ length: 60 }, (_, i) =>
          codigosDe(i).map((c) => ({ codigoRecinto: c, localidad: '', parroquia: '', numeroTecnico: i + 1, tecnico: `Técnica Andrea Pérez de los Ríos ${i}` })),
        ).flat(),
      );
      consulta('buscar_recinto', { texto: 'mira' });

      await service.responder('técnicos de las escuelas mira', 'c:1');

      const [texto] = telegram.enviarHtml.mock.calls[0];
      expect(texto.length).toBeLessThan(4096);
      expect(texto).toContain('y 5 más)');
      expect(texto).toMatch(/… y \d+ más\. Pregunte con más detalle\.$/);
    });

    it('preguntando por el técnico sin distributivo, lo dice en vez de listar contactos', async () => {
      distributivo.asignaciones.mockRejectedValue(new Error('sin Drive'));
      consulta('buscar_recinto', { texto: 'San Juan de Ilumán' });

      await service.responder('técnicos de San Juan de Ilumán', 'c:1');

      expect(html()).toBe('⚠️ El distributivo de técnicos no está disponible ahora. Intente de nuevo en unos minutos.');
    });

    it('preguntando por el técnico de UN recinto, da su ficha (que trae el técnico)', async () => {
      consulta('buscar_recinto', { texto: 'colegio Ibarra' });

      await service.responder('qué técnico tiene el colegio Ibarra', 'c:1');

      expect(html()).toContain('👷 Técnico: Juan Pérez');
    });

    it('preguntaPorTecnico reconoce "técnico/técnica/técnicos" con o sin tilde, no otras palabras', () => {
      expect(preguntaPorTecnico('Quien es el TÉCNICO de Ilumán?')).toBe(true);
      expect(preguntaPorTecnico('tecnicos de otavalo')).toBe(true);
      expect(preguntaPorTecnico('la técnica de Quiroga')).toBe(true);
      expect(preguntaPorTecnico('contacto de Ilumán')).toBe(false);
      expect(preguntaPorTecnico('colegio técnico Ibarra problema tecnicamente')).toBe(true);
      expect(preguntaPorTecnico('falla técnicamente')).toBe(false);
    });

    it('un alias del diccionario ("Golondrinas") da la ficha de su recinto', async () => {
      prisma.enlaceRecinto.findMany.mockResolvedValue([
        ...ENLACES,
        { codigoRecinto: '4241', nombreRecinto: 'Unidad Educativa Santa Ana de Cotacachi', canton: 'Cotacachi', estado: 'ACTIVO' },
      ]);
      consulta('buscar_recinto', { texto: 'golondrinas' });

      await service.responder('cuál es el recinto de golondrinas', 'c:1');

      expect(html()).toContain('📍 <b>4241 · Unidad Educativa Santa Ana de Cotacachi</b>');
    });

    it('sin resultados lo dice, escapando lo buscado', async () => {
      consulta('buscar_recinto', { texto: '<script>' });

      await service.responder('x', 'c:1');

      expect(html()).toBe('🔍 No encontré recintos para "&lt;script&gt;". Pruebe con otra parte del nombre o con el código.');
    });

    it('escapa el HTML de los datos de la hoja y dice "sin registrar" si no hay encargado', async () => {
      consulta('buscar_recinto', { texto: '1961' });

      await service.responder('1961', 'c:1');

      expect(html()).toContain('UE García Moreno &lt;b&gt;');
      expect(html()).toContain('📞 Encargado: sin registrar');
      expect(html()).toContain('Enlace: 🔴 caído');
    });

    it('si el Excel de encargados o el distributivo fallan, responde igual con lo que hay', async () => {
      encargados.encargados.mockRejectedValue(new Error('Drive 500'));
      distributivo.asignaciones.mockRejectedValue(new Error('Drive 500'));
      consulta('buscar_recinto', { texto: '28' });

      await service.responder('28', 'c:1');

      expect(html()).toContain('📞 Encargado: no se pudo consultar ahora');
      expect(html()).toContain('👷 Técnico: sin técnico asignado');
    });
  });

  describe('consultar_recintos', () => {
    it('junta la base, el distributivo y los encargados y manda la respuesta armada por el código', async () => {
      consulta('consultar_recintos', { cantones: ['Otavalo'], con_contacto: true });

      await service.responder('contactos de los recintos de Otavalo', 'c:1');

      expect(html()).toBe(
        '🏫 <b>Recintos · Otavalo</b>: 2 (2 caídos)\n\n' +
          '<b>📍 Otavalo</b> (2 · 2 caídos)\n' +
          '🔴 1008 (Ota) — UE San Juan de Ilumán Bloque 2\n     📞 sin registrar\n' +
          '🔴 1009 (Ota) — UE San Juan de Iluman Bloque 1\n     📞 sin registrar',
      );
    });

    it('varios cantones en una sola pregunta salen completos', async () => {
      consulta('consultar_recintos', { cantones: ['Ibarra', 'Cotacachi'] });

      await service.responder('recintos de Ibarra y Cotacachi', 'c:1');

      expect(html()).toContain('Recintos · Ibarra, Cotacachi</b>: 2');
      expect(html()).toContain('28 (Iba)');
      expect(html()).toContain('1961 (Cot)');
    });

    it('agrupa por técnico con los nombres del distributivo', async () => {
      consulta('consultar_recintos', { estado: 'caido', agrupar_por: 'tecnico' });

      await service.responder('qué técnicos tienen caídos', 'c:1');

      expect(html()).toContain('<b>👷 2. Ana Torres</b> (2 · 2 caídos)');
      expect(html()).toContain('<b>👷 3. Juan Andrade</b> (1 · 1 caído)');
      expect(html()).not.toContain('Juan Pérez');
    });

    it('sin distributivo no responde "sin técnico" (sería falso)', async () => {
      distributivo.asignaciones.mockRejectedValue(new Error('Drive 500'));
      consulta('consultar_recintos', { sin_tecnico: true });

      await service.responder('qué recintos no tienen técnico', 'c:1');

      expect(html()).toContain('El distributivo de técnicos no está disponible ahora');
    });

    it('sin el Excel de encargados no responde "sin contacto" (sería falso)', async () => {
      encargados.encargados.mockRejectedValue(new Error('Drive 500'));
      consulta('consultar_recintos', { sin_contacto: true });

      await service.responder('qué recintos no tienen contacto', 'c:1');

      expect(html()).toContain('El archivo de encargados no está disponible ahora');
    });

    it('una respuesta larga se manda en varios mensajes', async () => {
      prisma.enlaceRecinto.findMany.mockResolvedValue(
        Array.from({ length: 150 }, (_, i) => ({ codigoRecinto: String(100 + i), nombreRecinto: `Escuela Fiscal Mixta N° ${i}`, canton: 'Ibarra', estado: 'ACTIVO' })),
      );
      consulta('consultar_recintos', {});

      await service.responder('todos los recintos', 'c:1');

      expect(telegram.enviarHtml.mock.calls.length).toBeGreaterThan(1);
      for (const [texto] of telegram.enviarHtml.mock.calls) expect(texto.length).toBeLessThan(4096);
    });
  });

  describe('modo SQL (ASISTENTE_SQL_ENABLED)', () => {
    beforeEach(() => (process.env.ASISTENTE_SQL_ENABLED = 'true'));
    afterEach(() => delete process.env.ASISTENTE_SQL_ENABLED);

    const datos = (sql: string, extra: Record<string, unknown> = {}) => [{ nombre: 'consultar_datos', argumentos: { sql, titulo: 'Resultado', ...extra } }];

    it('pide las consultas en modo sql y responde con el resultado del SQL, sin teléfonos', async () => {
      llm.elegirConsultas.mockResolvedValue(
        datos("SELECT codigo, nombre, estado FROM recintos WHERE norm(canton) = norm('otavalo') ORDER BY codigo"),
      );

      await service.responder('recintos de otavalo', 'c:1');

      expect(llm.elegirConsultas).toHaveBeenCalledWith('recintos de otavalo', 'sql');
      expect(html()).toBe(
        '🔎 <b>Resultado</b> (2)\n🔴 1008 — UE San Juan de Ilumán Bloque 2\n🔴 1009 — UE San Juan de Iluman Bloque 1',
      );
    });

    it('la tabla trae técnicos, parroquias y si hay contacto (sin el teléfono)', async () => {
      llm.elegirConsultas.mockResolvedValue(
        datos("SELECT codigo, tecnico, parroquia, tiene_contacto FROM recintos WHERE codigo IN ('28', '1008') ORDER BY codigo"),
      );

      await service.responder('x', 'c:1');

      expect(html()).toContain('• 1008 · Ana Torres · SAN JUAN DE ILUMAN · 0');
      expect(html()).toContain('• 28 · Juan Pérez · SAGRARIO · 1');
      expect(html()).not.toContain('0991234567');
    });

    it('con con_contacto los teléfonos salen del Excel de encargados', async () => {
      llm.elegirConsultas.mockResolvedValue(datos("SELECT codigo, nombre FROM recintos WHERE codigo = '28'", { con_contacto: true }));

      await service.responder('contacto del 28', 'c:1');

      expect(html()).toContain('📞 Rector Luis Mora · 0991234567');
    });

    it('si el SQL falla, el modelo lo corrige una vez recibiendo solo el error', async () => {
      llm.elegirConsultas
        .mockResolvedValueOnce(datos('SELECT telefono FROM recintos'))
        .mockResolvedValueOnce(datos("SELECT count(*) FROM recintos WHERE estado = 'caido'"));

      await service.responder('cuántos caídos hay', 'c:1');

      expect(llm.elegirConsultas).toHaveBeenCalledTimes(2);
      const [pedido, modo] = llm.elegirConsultas.mock.calls[1];
      expect(modo).toBe('sql');
      expect(pedido).toContain('cuántos caídos hay');
      expect(pedido).toContain('no such column: telefono');
      expect(pedido).not.toContain('Unidad Educativa');
      expect(html()).toBe('🔎 <b>Resultado</b>: 3');
    });

    it('si vuelve a fallar, responde con el modo de filtros (como antes)', async () => {
      llm.elegirConsultas
        .mockResolvedValueOnce(datos('SELECT x FROM recintos'))
        .mockResolvedValueOnce(datos('SELECT y FROM recintos'))
        .mockResolvedValueOnce([{ nombre: 'consultar_recintos', argumentos: { estado: 'caido', solo_contar: true } }]);

      await service.responder('cuántos caídos hay', 'c:1');

      expect(llm.elegirConsultas.mock.calls.map((c) => c[1])).toEqual(['sql', 'sql', 'filtros']);
      expect(html()).toContain('Recintos · caídos</b>: 3');
    });

    it('una consulta prohibida no se ejecuta y termina en el modo de filtros', async () => {
      llm.elegirConsultas
        .mockResolvedValueOnce(datos('DELETE FROM recintos'))
        .mockResolvedValueOnce(datos('DROP TABLE recintos'))
        .mockResolvedValueOnce([]);

      await service.responder('borra todo', 'c:1');

      expect(telegram.enviarTexto).toHaveBeenCalledWith(expect.stringContaining('No pude responder esa pregunta'), expect.any(String));
      expect(telegram.enviarHtml).not.toHaveBeenCalled();
    });

    it('varias consultas SQL que fallan: 1 corrección y 1 respaldo, sin repetir lo que ya se respondió', async () => {
      llm.elegirConsultas
        .mockResolvedValueOnce([
          ...datos('SELECT a FROM recintos'),
          ...datos('SELECT b FROM recintos'),
          { nombre: 'estadisticas', argumentos: { periodo: 'semana' } },
        ])
        .mockResolvedValueOnce(datos('SELECT c FROM recintos'))
        .mockResolvedValueOnce([
          { nombre: 'consultar_recintos', argumentos: { estado: 'caido', solo_contar: true } },
          { nombre: 'estadisticas', argumentos: { periodo: 'semana' } },
        ]);

      await service.responder('caídos y estadísticas de la semana', 'c:1');

      expect(llm.elegirConsultas.mock.calls.map((c) => c[1])).toEqual(['sql', 'sql', 'filtros']);
      expect(estadisticas.enviarEstadisticasTelegram).toHaveBeenCalledTimes(1);
      expect(telegram.enviarHtml).toHaveBeenCalledTimes(1);
      expect(html()).toContain('Recintos · caídos</b>: 3');
    });

    it('si el motor no está disponible, va directo al respaldo sin pedir corrección', async () => {
      // Cola llena: 4 consultas lentas ocupan el turno y la cola del motor.
      const lenta = 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) FROM c';
      const { ejecutarSql } = await import('./sql/motor-sql');
      const ocupadas = Array.from({ length: 4 }, () => ejecutarSql(lenta, [], { tiempoMaxMs: 300 }).catch(() => undefined));
      llm.elegirConsultas
        .mockResolvedValueOnce(datos('SELECT 1'))
        .mockResolvedValueOnce([{ nombre: 'consultar_recintos', argumentos: { estado: 'caido', solo_contar: true } }]);

      await service.responder('cuántos caídos hay', 'c:1');
      await Promise.all(ocupadas);

      expect(llm.elegirConsultas.mock.calls.map((c) => c[1])).toEqual(['sql', 'filtros']);
      expect(html()).toContain('Recintos · caídos</b>: 3');
    });

    it('apagado, nunca ejecuta SQL aunque el modelo lo pida', async () => {
      delete process.env.ASISTENTE_SQL_ENABLED;
      llm.elegirConsultas.mockResolvedValue(datos('SELECT 1'));

      await service.responder('x', 'c:1');

      expect(llm.elegirConsultas).toHaveBeenCalledWith('x', 'filtros');
      expect(telegram.enviarHtml).not.toHaveBeenCalled();
      expect(telegram.enviarTexto).toHaveBeenCalledWith(AYUDA_ASISTENTE, 'la ayuda del asistente');
    });

    it('sin distributivo avisa que técnicos y parroquias pueden salir vacíos', async () => {
      distributivo.asignaciones.mockRejectedValue(new Error('sin Drive'));
      llm.elegirConsultas.mockResolvedValue(datos('SELECT count(*) FROM recintos'));

      await service.responder('x', 'c:1');

      expect(telegram.enviarTexto).toHaveBeenCalledWith(expect.stringContaining('distributivo de técnicos no está disponible'), expect.any(String));
      expect(html()).toBe('🔎 <b>Resultado</b>: 4');
    });

    it('el aviso de distributivo sale una sola vez aunque haya varias consultas', async () => {
      distributivo.asignaciones.mockRejectedValue(new Error('sin Drive'));
      llm.elegirConsultas.mockResolvedValue([...datos('SELECT 1'), ...datos('SELECT 2')]);

      await service.responder('x', 'c:1');

      const avisos = telegram.enviarTexto.mock.calls.filter(([t]) => String(t).includes('distributivo'));
      expect(avisos).toHaveLength(1);
    });
  });

  describe('tiempo de caída', () => {
    it('la ficha dice desde hace cuánto está caído', async () => {
      prisma.enlaceCaida.findMany.mockResolvedValue([{ codigoRecinto: '1961', inicio: haceMinutos(135) }]);
      consulta('buscar_recinto', { texto: '1961' });

      await service.responder('cuánto tiempo lleva caído el 1961', 'c:1');

      expect(html()).toContain('Enlace: 🔴 caído hace 2 h 15 min');
    });

    it('la lista de varios recintos también, y sin dato dice solo "🔴"', async () => {
      prisma.enlaceCaida.findMany.mockResolvedValue([{ codigoRecinto: '1008', inicio: haceMinutos(3000) }]);
      consulta('buscar_recinto', { texto: 'San Juan de Ilumán' });

      await service.responder('Ilumán', 'c:1');

      expect(html()).toContain('UE San Juan de Ilumán Bloque 2</b> 🔴 hace 2 d 2 h');
      expect(html()).toContain('UE San Juan de Iluman Bloque 1</b> 🔴\n');
    });

    it('si el historial no se puede leer, la ficha sale igual (sin el tiempo)', async () => {
      prisma.enlaceCaida.findMany.mockRejectedValue(new Error('sin base'));
      consulta('buscar_recinto', { texto: '1961' });

      await service.responder('1961', 'c:1');

      expect(html()).toContain('Enlace: 🔴 caído\n');
    });

    describe('modo SQL', () => {
      beforeEach(() => (process.env.ASISTENTE_SQL_ENABLED = 'true'));
      afterEach(() => delete process.env.ASISTENTE_SQL_ENABLED);

      it('minutos_caido y la tabla caidas salen del historial (últimos 31 días + abiertas)', async () => {
        prisma.enlaceCaida.findMany.mockResolvedValue([
          { codigoRecinto: '1008', inicio: haceMinutos(600), fin: haceMinutos(540) },
          { codigoRecinto: '1008', inicio: haceMinutos(75), fin: null },
        ]);
        llm.elegirConsultas.mockResolvedValue([
          {
            nombre: 'consultar_datos',
            argumentos: {
              sql:
                "SELECT r.codigo, r.minutos_caido, count(c.codigo) AS caidas, sum(c.minutos) AS minutos_total " +
                "FROM recintos r JOIN caidas c USING (codigo) WHERE c.inicio <= ahora() GROUP BY r.codigo",
              titulo: 'Caídas',
            },
          },
        ]);

        await service.responder('cuánto tiempo estuvo caído el 1008', 'c:1');

        expect(html()).toContain('• 1008 · 1 h 15 min · 2 · 2 h 15 min');
        const [{ where }] = prisma.enlaceCaida.findMany.mock.calls[0];
        expect(where.OR[0]).toEqual({ fin: null });
        expect(Date.now() - where.OR[1].inicio.gte.getTime()).toBeGreaterThanOrEqual(31 * 24 * 60 * 60_000 - 1000);
      });

      it('dos caídas abiertas del mismo recinto: vale la más antigua y no se cuenta doble', async () => {
        prisma.enlaceCaida.findMany.mockResolvedValue([
          { codigoRecinto: '1008', inicio: haceMinutos(30), fin: null },
          { codigoRecinto: '1008', inicio: haceMinutos(120), fin: null },
        ]);
        llm.elegirConsultas.mockResolvedValue([
          {
            nombre: 'consultar_datos',
            argumentos: {
              sql: "SELECT r.minutos_caido, count(*) AS caidas FROM recintos r JOIN caidas c USING (codigo) WHERE r.codigo = '1008'",
              titulo: 'X',
            },
          },
        ]);

        await service.responder('x', 'c:1');

        expect(html()).toContain('• 2 h · 1');
      });

      it('lee de la más reciente a la más antigua (con tope) y avisa si se recortó', async () => {
        const warn = jest.spyOn(Logger.prototype, 'warn');
        prisma.enlaceCaida.findMany.mockResolvedValue(
          Array.from({ length: 5000 }, (_, i) => ({ codigoRecinto: '28', inicio: haceMinutos(10 + i), fin: haceMinutos(5 + i) })),
        );
        llm.elegirConsultas.mockResolvedValue([{ nombre: 'consultar_datos', argumentos: { sql: 'SELECT count(*) FROM caidas', titulo: 'X' } }]);

        await service.responder('x', 'c:1');

        const [{ orderBy, take }] = prisma.enlaceCaida.findMany.mock.calls[0];
        expect(orderBy).toEqual({ inicio: 'desc' });
        expect(take).toBe(5000);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('recortado'));
        expect(html()).toBe('🔎 <b>X</b>: 5000');
      });

      it('si el SQL no habla de tiempos, no lee el historial de caídas', async () => {
        llm.elegirConsultas.mockResolvedValue([{ nombre: 'consultar_datos', argumentos: { sql: 'SELECT count(*) FROM recintos', titulo: 'X' } }]);

        await service.responder('x', 'c:1');

        expect(prisma.enlaceCaida.findMany).not.toHaveBeenCalled();
        expect(html()).toBe('🔎 <b>X</b>: 4');
      });

      it('con solo minutos_caido, lee solo las caídas abiertas', async () => {
        prisma.enlaceCaida.findMany.mockResolvedValue([{ codigoRecinto: '1008', inicio: haceMinutos(90) }]);
        llm.elegirConsultas.mockResolvedValue([
          { nombre: 'consultar_datos', argumentos: { sql: "SELECT codigo, minutos_caido FROM recintos WHERE codigo = '1008'", titulo: 'X' } },
        ]);

        await service.responder('x', 'c:1');

        expect(prisma.enlaceCaida.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { fin: null } }));
        expect(html()).toContain('• 1008 · 1 h 30 min');
      });

      it('sin historial, responde igual con minutos_caido vacío', async () => {
        prisma.enlaceCaida.findMany.mockRejectedValue(new Error('sin base'));
        llm.elegirConsultas.mockResolvedValue([
          { nombre: 'consultar_datos', argumentos: { sql: "SELECT codigo, minutos_caido FROM recintos WHERE codigo = '1008'", titulo: 'X' } },
        ]);

        await service.responder('x', 'c:1');

        expect(html()).toContain('• 1008 · —');
      });
    });
  });

  describe('estadisticas', () => {
    it('manda la tarjeta del período pedido', async () => {
      consulta('estadisticas', { periodo: 'semana' });

      await service.responder('estadísticas de la semana', 'c:1');

      expect(estadisticas.enviarEstadisticasTelegram).toHaveBeenCalledWith(expect.any(Date), 'semana');
    });
  });

  describe('varias consultas en una pregunta', () => {
    it('ejecuta todas, en orden, y las inválidas se ignoran', async () => {
      llm.elegirConsultas.mockResolvedValue([
        { nombre: 'consultar_recintos', argumentos: { cantones: ['Ibarra'] } },
        { nombre: 'borrar_todo', argumentos: {} },
        { nombre: 'estadisticas', argumentos: { periodo: 'hoy' } },
      ]);

      await service.responder('recintos de Ibarra y estadísticas de hoy', 'c:1');

      expect(html()).toContain('Recintos · Ibarra');
      expect(estadisticas.enviarEstadisticasTelegram).toHaveBeenCalledWith(expect.any(Date), 'dia');
    });

    it('una consulta repetida por el modelo se ejecuta una sola vez', async () => {
      llm.elegirConsultas.mockResolvedValue([
        { nombre: 'estadisticas', argumentos: { periodo: 'dia' } },
        { nombre: 'estadisticas', argumentos: { periodo: 'hoy' } },
      ]);

      await service.responder('estadísticas de hoy', 'c:1');

      expect(estadisticas.enviarEstadisticasTelegram).toHaveBeenCalledTimes(1);
    });

    it('si una falla, las demás igual se responden', async () => {
      estadisticas.enviarEstadisticasTelegram.mockRejectedValueOnce(new Error('db'));
      llm.elegirConsultas.mockResolvedValue([
        { nombre: 'estadisticas', argumentos: { periodo: 'dia' } },
        { nombre: 'consultar_recintos', argumentos: { cantones: ['Ibarra'] } },
      ]);

      await service.responder('estadísticas y recintos de Ibarra', 'c:1');

      expect(telegram.enviarTexto).toHaveBeenCalledWith(expect.stringContaining('No se pudo consultar'), expect.any(String));
      expect(html()).toContain('Recintos · Ibarra');
    });
  });

  describe('lo que no responde', () => {
    it('si el modelo no elige consulta, muestra la ayuda (nunca su texto)', async () => {
      llm.elegirConsultas.mockResolvedValue([]);

      await service.responder('escríbeme un oficio', 'c:1');

      expect(telegram.enviarTexto).toHaveBeenCalledWith(AYUDA_ASISTENTE, expect.any(String));
    });

    it('una consulta fuera de la lista o con parámetros inválidos también da la ayuda', async () => {
      consulta('borrar_todo', {});
      await service.responder('borra todo', 'c:1');
      consulta('buscar_recinto', { texto: 123 });
      await service.responder('x', 'c:1');

      expect(telegram.enviarTexto.mock.calls.filter((c) => c[0] === AYUDA_ASISTENTE)).toHaveLength(2);
      expect(prisma.enlaceRecinto.findMany).not.toHaveBeenCalled();
    });

    it('si ningún proveedor responde, avisa que use los botones', async () => {
      llm.elegirConsultas.mockRejectedValue(new AsistenteNoDisponible());

      await service.responder('caídos', 'c:1');

      expect(telegram.enviarTexto).toHaveBeenCalledWith(
        '⚠️ El asistente no está disponible en este momento. Use los botones de abajo.',
        expect.any(String),
      );
    });

    it('si la base falla, avisa sin lanzar', async () => {
      prisma.enlaceRecinto.findMany.mockRejectedValue(new Error('db caída'));
      consulta('consultar_recintos', { estado: 'caido' });

      await expect(service.responder('caídos', 'c:1')).resolves.toBeUndefined();
      expect(telegram.enviarTexto).toHaveBeenCalledWith(expect.stringContaining('No se pudo consultar'), expect.any(String));
    });

    it('pregunta vacía: ayuda sin llamar al modelo', async () => {
      await service.responder('   ', 'c:1');

      expect(llm.elegirConsultas).not.toHaveBeenCalled();
      expect(telegram.enviarTexto).toHaveBeenCalledWith(AYUDA_ASISTENTE, expect.any(String));
    });

    it('pregunta demasiado larga: no se manda al modelo', async () => {
      await service.responder('a'.repeat(MAX_LARGO_PREGUNTA + 1), 'c:1');

      expect(llm.elegirConsultas).not.toHaveBeenCalled();
    });
  });

  describe('límite de preguntas', () => {
    it('10 por persona cada 10 minutos; las de otra persona siguen pasando', async () => {
      llm.elegirConsultas.mockResolvedValue([]);
      for (let i = 0; i < 10; i++) await service.responder('hola', 'c:1');
      await service.responder('hola', 'c:1');
      await service.responder('hola', 'c:2');

      expect(llm.elegirConsultas).toHaveBeenCalledTimes(11);
      expect(telegram.enviarTexto).toHaveBeenCalledWith(expect.stringContaining('muchas preguntas seguidas'), expect.any(String));
    });

    it('pasados 10 minutos se puede volver a preguntar', async () => {
      llm.elegirConsultas.mockResolvedValue([]);
      const ahora = Date.now();
      const reloj = jest.spyOn(Date, 'now').mockReturnValue(ahora);
      try {
        for (let i = 0; i < 10; i++) await service.responder('hola', 'c:1');
        reloj.mockReturnValue(ahora + 10 * 60 * 1000 + 1);
        await service.responder('hola', 'c:1');
      } finally {
        reloj.mockRestore();
      }

      expect(llm.elegirConsultas).toHaveBeenCalledTimes(11);
    });

    it('tope total de 60 entre todas las personas', async () => {
      llm.elegirConsultas.mockResolvedValue([]);
      for (let i = 0; i < 61; i++) await service.responder('hola', `c:${i}`);

      expect(llm.elegirConsultas).toHaveBeenCalledTimes(60);
    });
  });

  describe('responderRecintoElegido', () => {
    it('muestra la ficha del recinto del botón', async () => {
      prisma.enlaceRecinto.findUnique.mockResolvedValue(ENLACES[0]);

      await service.responderRecintoElegido('28');

      expect(prisma.enlaceRecinto.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { codigoRecinto: '28' } }));
      expect(html()).toContain('📞 Encargado: Rector Luis Mora · 0991234567');
    });

    it('si el recinto ya no existe lo dice', async () => {
      prisma.enlaceRecinto.findUnique.mockResolvedValue(null);

      await service.responderRecintoElegido('999');

      expect(telegram.enviarTexto).toHaveBeenCalledWith('⚠️ El recinto 999 ya no está en la lista.', expect.any(String));
    });
  });
});
