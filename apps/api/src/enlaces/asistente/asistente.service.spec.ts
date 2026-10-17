import { Logger } from '@nestjs/common';
import { AsistenteService, AYUDA_ASISTENTE, MAX_LARGO_PREGUNTA } from './asistente.service';
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
  const prisma = { enlaceRecinto: { findMany: jest.fn(), findUnique: jest.fn() } };
  const telegram = {
    enviarTexto: jest.fn().mockResolvedValue(undefined),
    enviarHtml: jest.fn().mockResolvedValue(undefined),
    enviarListaActual: jest.fn().mockResolvedValue(undefined),
    enviarAsignaciones: jest.fn().mockResolvedValue(undefined),
    indicarEscribiendo: jest.fn().mockResolvedValue(undefined),
  };
  const distributivo = { asignaciones: jest.fn() };
  const encargados = { encargados: jest.fn() };
  const llm = { elegirConsulta: jest.fn() };
  let service: AsistenteService;
  let logs: jest.SpyInstance[];

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.enlaceRecinto.findMany.mockResolvedValue(ENLACES);
    distributivo.asignaciones.mockResolvedValue(ASIGNACIONES);
    encargados.encargados.mockResolvedValue(new Map([['28', { nombre: 'Rector Luis Mora', telefono: '0991234567' }]]));
    service = new AsistenteService(prisma as any, telegram as any, distributivo as any, encargados as any, llm as any);
    logs = (['log', 'warn', 'error'] as const).map((m) => jest.spyOn(Logger.prototype, m).mockImplementation(() => undefined));
  });

  afterEach(() => logs.forEach((l) => l.mockRestore()));

  const consulta = (nombre: string, argumentos: unknown) => llm.elegirConsulta.mockResolvedValue({ nombre, argumentos });
  const html = () => telegram.enviarHtml.mock.calls.map((c) => c[0]).join('\n---\n');

  describe('buscar_recinto', () => {
    it('un solo resultado: ficha con estado, encargado y técnico', async () => {
      consulta('buscar_recinto', { texto: 'colegio Ibarra' });

      await service.responder('dame el número del encargado del colegio Ibarra', 'c:1');

      expect(llm.elegirConsulta).toHaveBeenCalledWith('dame el número del encargado del colegio Ibarra');
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

      expect(llm.elegirConsulta).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(llm.elegirConsulta.mock.calls)).not.toContain('0991234567');
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

  describe('recintos_caidos', () => {
    it('sin cantón: la lista completa de caídos, con el mismo formato de /caidos', async () => {
      consulta('recintos_caidos', {});

      await service.responder('qué está caído', 'c:1');

      expect(telegram.enviarListaActual.mock.calls[0][0].map((e: any) => e.codigoRecinto)).toEqual(['1008', '1009', '1961']);
    });

    it('con cantón (sin importar tildes): solo los de ese cantón', async () => {
      consulta('recintos_caidos', { canton: 'cotacachí' });

      await service.responder('caídos en Cotacachi', 'c:1');

      const [lista, , canton] = telegram.enviarListaActual.mock.calls[0];
      expect(lista.map((e: any) => e.codigoRecinto)).toEqual(['1961']);
      expect(canton).toBe('Cotacachi');
    });

    it('con un cantón real sin caídos, manda la lista vacía con el cantón en el título', async () => {
      consulta('recintos_caidos', { canton: 'Ibarra' });

      await service.responder('caídos en Ibarra', 'c:1');

      expect(telegram.enviarListaActual).toHaveBeenCalledWith([], undefined, 'Ibarra');
    });

    it.each(['Imbabura', 'Quito', 'Ibarra y Otavalo'])(
      'con un cantón que no existe ("%s") NO dice "no hay caídos": lo avisa y muestra todos',
      async (canton) => {
        consulta('recintos_caidos', { canton });

        await service.responder(`caídos en ${canton}`, 'c:1');

        expect(html()).toContain(`No reconozco el cantón "${canton}"`);
        expect(html()).toContain('Cantones con recintos: Ibarra, Otavalo, Cotacachi.');
        const [lista, , filtro] = telegram.enviarListaActual.mock.calls[0];
        expect(lista).toHaveLength(3);
        expect(filtro).toBeUndefined();
      },
    );
  });

  describe('recintos_de_tecnico', () => {
    it('un técnico: sus recintos con el formato de Asignaciones CDA', async () => {
      consulta('recintos_de_tecnico', { nombre: 'ana' });

      await service.responder('recintos de Ana', 'c:1');

      const [[grupo]] = telegram.enviarAsignaciones.mock.calls[0];
      expect(grupo).toEqual({
        numeroTecnico: 2,
        tecnico: 'Ana Torres',
        recintos: [
          { codigoRecinto: '1008', nombreRecinto: 'UE San Juan de Ilumán Bloque 2', canton: 'Otavalo', estado: 'FALLO' },
          { codigoRecinto: '1009', nombreRecinto: 'UE San Juan de Iluman Bloque 1', canton: 'Otavalo', estado: 'FALLO' },
          { codigoRecinto: '3000', nombreRecinto: 'Escuela sin enlace', canton: null, estado: null },
        ],
      });
    });

    it('varios técnicos con ese nombre: pide el nombre completo', async () => {
      consulta('recintos_de_tecnico', { nombre: 'Juan' });

      await service.responder('recintos de Juan', 'c:1');

      expect(telegram.enviarAsignaciones).not.toHaveBeenCalled();
      expect(html()).toContain('Juan Pérez');
      expect(html()).toContain('Juan Andrade');
    });

    it('tolera mayúsculas y un error de tipeo ("WILLI" encuentra a Willy)', async () => {
      distributivo.asignaciones.mockResolvedValue([
        ...ASIGNACIONES,
        { codigoRecinto: '1961', localidad: '', parroquia: 'GARCIA MORENO', numeroTecnico: 4, tecnico: 'Willy' },
      ]);
      consulta('recintos_de_tecnico', { nombre: 'WILLI' });

      await service.responder('Que recintos tiene WILLI', 'c:1');

      const [[grupo]] = telegram.enviarAsignaciones.mock.calls[0];
      expect(grupo.tecnico).toBe('Willy');
      expect(html()).toContain('No encontré "WILLI" tal cual');
    });

    it('si el nombre coincide tal cual, no se mezclan los parecidos', async () => {
      distributivo.asignaciones.mockResolvedValue([
        ...ASIGNACIONES,
        { codigoRecinto: '1961', localidad: '', parroquia: '', numeroTecnico: 4, tecnico: 'Ana Torrez' },
      ]);
      consulta('recintos_de_tecnico', { nombre: 'Ana Torres' });

      await service.responder('recintos de Ana Torres', 'c:1');

      const [[grupo]] = telegram.enviarAsignaciones.mock.calls[0];
      expect(grupo.tecnico).toBe('Ana Torres');
    });

    it('solo caídos: muestra únicamente los recintos con el enlace caído', async () => {
      prisma.enlaceRecinto.findMany.mockResolvedValue(
        ENLACES.map((e) => (e.codigoRecinto === '1009' ? { ...e, estado: 'ACTIVO' } : e)),
      );
      consulta('recintos_de_tecnico', { nombre: 'Ana', solo_caidos: true });

      await service.responder('solo los caídos de Ana', 'c:1');

      const [[grupo]] = telegram.enviarAsignaciones.mock.calls[0];
      expect(grupo.recintos.map((r: any) => r.codigoRecinto)).toEqual(['1008']);
    });

    it('solo caídos sin ninguno caído lo dice', async () => {
      consulta('recintos_de_tecnico', { nombre: 'Juan Pérez', solo_caidos: true });

      await service.responder('caídos de Juan Pérez', 'c:1');

      expect(telegram.enviarAsignaciones).not.toHaveBeenCalled();
      expect(html()).toBe('✅ Juan Pérez no tiene recintos con el enlace caído ahora.');
    });

    it('solo caídos: los recintos sin enlace monitoreado no se dan por activos', async () => {
      prisma.enlaceRecinto.findMany.mockResolvedValue(ENLACES.map((e) => ({ ...e, estado: 'ACTIVO' })));
      consulta('recintos_de_tecnico', { nombre: 'Ana', solo_caidos: true });

      await service.responder('caídos de Ana', 'c:1');

      expect(html()).toBe('✅ Ana Torres no tiene recintos con el enlace caído ahora.\n(1 de sus recintos no tienen enlace monitoreado.)');
    });

    it('nadie con ese nombre', async () => {
      consulta('recintos_de_tecnico', { nombre: 'Zoila' });

      await service.responder('recintos de Zoila', 'c:1');

      expect(html()).toContain('No encontré a ningún técnico "Zoila"');
    });

    it('distributivo no disponible', async () => {
      distributivo.asignaciones.mockRejectedValue(new Error('no configurado'));
      consulta('recintos_de_tecnico', { nombre: 'Ana' });

      await service.responder('recintos de Ana', 'c:1');

      expect(telegram.enviarTexto).toHaveBeenCalledWith('El distributivo de técnicos no está disponible ahora.', expect.any(String));
    });
  });

  describe('tecnicos_de_canton', () => {
    const ENLACES_COTACACHI = [
      ...ENLACES,
      { codigoRecinto: '1962', nombreRecinto: 'Escuela Quiroga', canton: 'Cotacachi', estado: 'ACTIVO' },
      { codigoRecinto: '1963', nombreRecinto: 'Escuela Imantag', canton: 'Cotacachi', estado: 'ACTIVO' },
    ];
    const ASIGNACIONES_COTACACHI = [
      ...ASIGNACIONES,
      { codigoRecinto: '1962', localidad: '', parroquia: 'QUIROGA', numeroTecnico: 4, tecnico: 'Willy <Chávez>' },
      { codigoRecinto: '1963', localidad: '', parroquia: 'IMANTAG', numeroTecnico: 4, tecnico: 'Willy <Chávez>' },
    ];

    it('lista los técnicos del cantón con cuántos recintos tiene cada uno (el de más recintos primero)', async () => {
      prisma.enlaceRecinto.findMany.mockResolvedValue(ENLACES_COTACACHI);
      distributivo.asignaciones.mockResolvedValue(ASIGNACIONES_COTACACHI);
      consulta('tecnicos_de_canton', { canton: 'cotacachi' });

      await service.responder('¿qué técnico está en Cotacachi?', 'c:1');

      expect(html()).toBe(
        '👷 <b>Técnicos en Cotacachi</b>\n' +
          '• Willy &lt;Chávez&gt;: 2 recintos\n' +
          '• Juan Andrade: 1 recinto\n\n' +
          'Para ver los recintos de uno, pregunte: "recintos de" y su nombre.',
      );
    });

    it('no cuenta recintos de otros cantones ni los que no tienen enlace monitoreado', async () => {
      consulta('tecnicos_de_canton', { canton: 'Otavalo' });

      await service.responder('técnicos de Otavalo', 'c:1');

      // Ana Torres tiene 1008 y 1009 en Otavalo; el 3000 no tiene enlace y no se cuenta.
      expect(html()).toContain('• Ana Torres: 2 recintos');
      expect(html()).not.toContain('Juan');
    });

    it('con un cantón que no existe lo dice, sin inventar técnicos', async () => {
      consulta('tecnicos_de_canton', { canton: 'Quito' });

      await service.responder('técnico de Quito', 'c:1');

      expect(html()).toBe('No reconozco el cantón "Quito". Cantones con recintos: Ibarra, Otavalo, Cotacachi.');
    });

    it('un recinto repetido en el Excel se cuenta una sola vez', async () => {
      distributivo.asignaciones.mockResolvedValue([...ASIGNACIONES, ASIGNACIONES[1]]);
      consulta('tecnicos_de_canton', { canton: 'Otavalo' });

      await service.responder('técnicos de Otavalo', 'c:1');

      expect(html()).toContain('• Ana Torres: 2 recintos');
    });

    it('con empate de recintos, ordena por nombre', async () => {
      prisma.enlaceRecinto.findMany.mockResolvedValue([
        ...ENLACES,
        { codigoRecinto: '1962', nombreRecinto: 'Escuela Quiroga', canton: 'Cotacachi', estado: 'ACTIVO' },
      ]);
      distributivo.asignaciones.mockResolvedValue([
        ...ASIGNACIONES,
        { codigoRecinto: '1962', localidad: '', parroquia: 'QUIROGA', numeroTecnico: 4, tecnico: 'Bruno Vega' },
      ]);
      consulta('tecnicos_de_canton', { canton: 'Cotacachi' });

      await service.responder('técnicos de Cotacachi', 'c:1');

      expect(html()).toContain('• Bruno Vega: 1 recinto\n• Juan Andrade: 1 recinto');
    });

    it('una parte del nombre que calza con varios cantones no elige ninguno', async () => {
      consulta('tecnicos_de_canton', { canton: 'a' });

      await service.responder('técnico de a', 'c:1');

      expect(html()).toBe('No reconozco el cantón "a". Cantones con recintos: Ibarra, Otavalo, Cotacachi.');
    });

    it('una parte del nombre que calza con un solo cantón sí lo elige', async () => {
      consulta('tecnicos_de_canton', { canton: 'cota' });

      await service.responder('técnico de cota', 'c:1');

      expect(html()).toContain('<b>Técnicos en Cotacachi</b>');
    });

    it('cantón sin técnicos en el distributivo', async () => {
      prisma.enlaceRecinto.findMany.mockResolvedValue([
        ...ENLACES,
        { codigoRecinto: '5000', nombreRecinto: 'Escuela Urcuquí', canton: 'Urcuquí', estado: 'ACTIVO' },
      ]);
      consulta('tecnicos_de_canton', { canton: 'Urcuqui' });

      await service.responder('técnico de Urcuquí', 'c:1');

      expect(html()).toBe('👷 No hay técnicos asignados a recintos de Urcuquí en el distributivo.');
    });

    it('distributivo no disponible', async () => {
      distributivo.asignaciones.mockRejectedValue(new Error('no configurado'));
      consulta('tecnicos_de_canton', { canton: 'Ibarra' });

      await service.responder('técnico de Ibarra', 'c:1');

      expect(telegram.enviarTexto).toHaveBeenCalledWith('El distributivo de técnicos no está disponible ahora.', expect.any(String));
      expect(telegram.enviarHtml).not.toHaveBeenCalled();
    });
  });

  describe('recintos_de_canton', () => {
    it('lista los recintos del cantón por técnico, con los que no tienen técnico al final', async () => {
      prisma.enlaceRecinto.findMany.mockResolvedValue([
        ...ENLACES,
        { codigoRecinto: '1962', nombreRecinto: 'Escuela Quiroga', canton: 'Cotacachi', estado: 'ACTIVO' },
      ]);
      consulta('recintos_de_canton', { canton: 'cotacachi' });

      await service.responder('Listar recintos de Cotacachi', 'c:1');

      expect(html()).toBe('🏫 <b>Recintos de Cotacachi</b>: 2 (1 caído), por técnico:');
      const [grupos] = telegram.enviarAsignaciones.mock.calls[0];
      expect(grupos).toEqual([
        {
          numeroTecnico: 3,
          tecnico: 'Juan Andrade',
          recintos: [{ codigoRecinto: '1961', nombreRecinto: 'UE García Moreno <b>', canton: 'Cotacachi', estado: 'FALLO' }],
        },
        {
          numeroTecnico: null,
          tecnico: '',
          recintos: [{ codigoRecinto: '1962', nombreRecinto: 'Escuela Quiroga', canton: 'Cotacachi', estado: 'ACTIVO' }],
        },
      ]);
    });

    it('sin caídos no dice "0 caídos"', async () => {
      consulta('recintos_de_canton', { canton: 'Ibarra' });

      await service.responder('recintos de Ibarra', 'c:1');

      expect(html()).toBe('🏫 <b>Recintos de Ibarra</b>: 1, por técnico:');
    });

    it('con un cantón que no existe lo dice y no lista nada', async () => {
      consulta('recintos_de_canton', { canton: 'Quito' });

      await service.responder('recintos de Quito', 'c:1');

      expect(html()).toContain('No reconozco el cantón "Quito"');
      expect(telegram.enviarAsignaciones).not.toHaveBeenCalled();
    });

    it('si el distributivo no está, igual lista los recintos (sin técnico)', async () => {
      distributivo.asignaciones.mockRejectedValue(new Error('Drive 500'));
      consulta('recintos_de_canton', { canton: 'Otavalo' });

      await service.responder('recintos de Otavalo', 'c:1');

      const [grupos] = telegram.enviarAsignaciones.mock.calls[0];
      expect(grupos).toHaveLength(1);
      expect(grupos[0].numeroTecnico).toBeNull();
      expect(grupos[0].recintos).toHaveLength(2);
    });
  });

  describe('lo que no responde', () => {
    it('si el modelo no elige consulta, muestra la ayuda (nunca su texto)', async () => {
      llm.elegirConsulta.mockResolvedValue(null);

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
      llm.elegirConsulta.mockRejectedValue(new AsistenteNoDisponible());

      await service.responder('caídos', 'c:1');

      expect(telegram.enviarTexto).toHaveBeenCalledWith(
        '⚠️ El asistente no está disponible en este momento. Use los botones de abajo.',
        expect.any(String),
      );
    });

    it('si la base falla, avisa sin lanzar', async () => {
      prisma.enlaceRecinto.findMany.mockRejectedValue(new Error('db caída'));
      consulta('recintos_caidos', {});

      await expect(service.responder('caídos', 'c:1')).resolves.toBeUndefined();
      expect(telegram.enviarTexto).toHaveBeenCalledWith(expect.stringContaining('No se pudo consultar'), expect.any(String));
    });

    it('pregunta vacía: ayuda sin llamar al modelo', async () => {
      await service.responder('   ', 'c:1');

      expect(llm.elegirConsulta).not.toHaveBeenCalled();
      expect(telegram.enviarTexto).toHaveBeenCalledWith(AYUDA_ASISTENTE, expect.any(String));
    });

    it('pregunta demasiado larga: no se manda al modelo', async () => {
      await service.responder('a'.repeat(MAX_LARGO_PREGUNTA + 1), 'c:1');

      expect(llm.elegirConsulta).not.toHaveBeenCalled();
    });
  });

  describe('límite de preguntas', () => {
    it('10 por persona cada 10 minutos; las de otra persona siguen pasando', async () => {
      llm.elegirConsulta.mockResolvedValue(null);
      for (let i = 0; i < 10; i++) await service.responder('hola', 'c:1');
      await service.responder('hola', 'c:1');
      await service.responder('hola', 'c:2');

      expect(llm.elegirConsulta).toHaveBeenCalledTimes(11);
      expect(telegram.enviarTexto).toHaveBeenCalledWith(expect.stringContaining('muchas preguntas seguidas'), expect.any(String));
    });

    it('pasados 10 minutos se puede volver a preguntar', async () => {
      llm.elegirConsulta.mockResolvedValue(null);
      const ahora = Date.now();
      const reloj = jest.spyOn(Date, 'now').mockReturnValue(ahora);
      try {
        for (let i = 0; i < 10; i++) await service.responder('hola', 'c:1');
        reloj.mockReturnValue(ahora + 10 * 60 * 1000 + 1);
        await service.responder('hola', 'c:1');
      } finally {
        reloj.mockRestore();
      }

      expect(llm.elegirConsulta).toHaveBeenCalledTimes(11);
    });

    it('tope total de 60 entre todas las personas', async () => {
      llm.elegirConsulta.mockResolvedValue(null);
      for (let i = 0; i < 61; i++) await service.responder('hola', `c:${i}`);

      expect(llm.elegirConsulta).toHaveBeenCalledTimes(60);
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
