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

    it('varios resultados (hasta 5): botones para elegir', async () => {
      consulta('buscar_recinto', { texto: 'San Juan de Ilumán' });

      await service.responder('encargado de San Juan de Ilumán', 'c:1');

      const [texto, , botones] = telegram.enviarHtml.mock.calls[0];
      expect(texto).toBe('🔍 Encontré 2 recintos para "San Juan de Ilumán". ¿Cuál?');
      expect(botones.inline_keyboard).toEqual([
        [{ text: '1008 · UE San Juan de Ilumán Bloque 2', callback_data: 'asis:rec:1008' }],
        [{ text: '1009 · UE San Juan de Iluman Bloque 1', callback_data: 'asis:rec:1009' }],
      ]);
    });

    it('más de 5 resultados: lista y pide más detalle, sin botones', async () => {
      prisma.enlaceRecinto.findMany.mockResolvedValue(
        Array.from({ length: 12 }, (_, i) => ({ codigoRecinto: String(100 + i), nombreRecinto: `Escuela Mira ${i}`, canton: 'Ibarra', estado: 'ACTIVO' })),
      );
      consulta('buscar_recinto', { texto: 'mira' });

      await service.responder('escuela mira', 'c:1');

      const [texto, , botones] = telegram.enviarHtml.mock.calls[0];
      expect(texto).toContain('Encontré 12 recintos');
      expect(texto).toContain('… y 2 más');
      expect(texto).toContain('Pregunte con más detalle');
      expect(botones).toBeUndefined();
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
