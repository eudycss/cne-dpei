import { Test } from '@nestjs/testing';
import { EnlacesService } from './enlaces.service';
import { EnlacesEstadisticasService } from './enlaces-estadisticas.service';
import { PrismaService } from '../db/prisma.service';
import { SheetsEnlacesClient } from './sheets-enlaces.client';
import {
  formatearAsignaciones,
  formatearMenuAsignaciones,
  tecladoTecnicos,
  TelegramNotifier,
  TEXTO_BOTON_ASIGNACIONES,
  type GrupoAsignacion,
} from './telegram-notifier';
import { NotificationsService } from '../notifications/notifications.service';
import { DistributivoNoConfigurado, DistributivoTecnicosClient } from './distributivo-tecnicos.client';
import { EnlacesEscalamientoService } from './enlaces-escalamiento.service';
import { EncargadosRecintosClient } from './encargados-recintos.client';
import { AsistenteService } from './asistente/asistente.service';

// Solo se reemplaza el notificador de correo; escapeHtml es el real.
jest.mock('../auth/notifier', () => ({
  ...jest.requireActual('../auth/notifier'),
  resolveNotifier: () => ({ sendEnlaceCaido: jest.fn(), sendEnlaceRecuperado: jest.fn() }),
}));

describe('Asignaciones CDA — botón del bot', () => {
  let service: EnlacesService;
  const escalamiento = { escalar: jest.fn().mockResolvedValue(undefined) };
  const prisma = { enlaceRecinto: { findMany: jest.fn() } };
  const distributivo = { asignaciones: jest.fn() };
  const telegram = {
    enviarMenuAsignaciones: jest.fn().mockResolvedValue(undefined),
    mostrarAsignacionTecnico: jest.fn().mockResolvedValue(undefined),
    editarMenuAsignaciones: jest.fn().mockResolvedValue(undefined),
    responderBoton: jest.fn().mockResolvedValue(undefined),
    responderEn: jest.fn((_chatId: string, fn: () => Promise<unknown>) => fn()),
    enviarTexto: jest.fn().mockResolvedValue(undefined),
    enviarListaActual: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto123';
    process.env.TELEGRAM_CHAT_ID = '-100';
    const moduleRef = await Test.createTestingModule({
      providers: [
        EnlacesService,
        { provide: PrismaService, useValue: prisma },
        { provide: SheetsEnlacesClient, useValue: {} },
        { provide: TelegramNotifier, useValue: telegram },
        { provide: NotificationsService, useValue: {} },
        { provide: EnlacesEstadisticasService, useValue: {} },
        { provide: DistributivoTecnicosClient, useValue: distributivo },
        { provide: EncargadosRecintosClient, useValue: { encargados: jest.fn().mockResolvedValue(new Map()) } },
        { provide: EnlacesEscalamientoService, useValue: escalamiento },
        { provide: AsistenteService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(EnlacesService);
  });

  afterEach(() => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  const tocar = (texto: string, chat = '-100') =>
    service.procesarComandoTelegram('secreto123', { message: { text: texto, chat: { id: chat } } });

  it('agrupa por técnico en orden, con el estado de cada enlace, y deja al final los que no tienen técnico', async () => {
    distributivo.asignaciones.mockResolvedValue([
      { codigoRecinto: '1126', localidad: 'UE Uno', numeroTecnico: 1, tecnico: 'Ana Pérez' },
      { codigoRecinto: '323', localidad: 'Plaza Dos', numeroTecnico: 1, tecnico: 'Ana Pérez' },
      { codigoRecinto: '1272', localidad: 'UE Tres', numeroTecnico: 2, tecnico: 'Luis Mora' },
      { codigoRecinto: '9999', localidad: 'UE Sin Enlace', numeroTecnico: 2, tecnico: 'Luis Mora' },
    ]);
    prisma.enlaceRecinto.findMany.mockResolvedValue([
      { codigoRecinto: '1126', nombreRecinto: 'UE Cesar Borja', canton: 'Ibarra', estado: 'FALLO' },
      { codigoRecinto: '323', nombreRecinto: 'Plaza Central de Angochagua', canton: 'Ibarra', estado: 'ACTIVO' },
      { codigoRecinto: '1272', nombreRecinto: 'UE Diocesana Bilingue', canton: 'Ibarra', estado: 'ACTIVO' },
      { codigoRecinto: 'CPE', nombreRecinto: 'CPE - IMBABURA', canton: 'Internet', estado: 'ACTIVO' },
    ]);

    await tocar(TEXTO_BOTON_ASIGNACIONES);

    const [grupos] = telegram.enviarMenuAsignaciones.mock.calls[0] as [GrupoAsignacion[]];
    expect(grupos.map((g) => [g.numeroTecnico, g.tecnico, g.recintos.map((r) => [r.codigoRecinto, r.estado])])).toEqual([
      [1, 'Ana Pérez', [['1126', 'FALLO'], ['323', 'ACTIVO']]],
      [2, 'Luis Mora', [['1272', 'ACTIVO'], ['9999', null]]],
      [null, '', [['CPE', 'ACTIVO']]],
    ]);
    // Sin enlace monitoreado: se usa el nombre de la localidad del distributivo.
    expect(grupos[1].recintos[1].nombreRecinto).toBe('UE Sin Enlace');
  });

  it('también responde a /asignaciones', async () => {
    distributivo.asignaciones.mockResolvedValue([{ codigoRecinto: '1', localidad: 'X', numeroTecnico: 1, tecnico: 'A' }]);
    prisma.enlaceRecinto.findMany.mockResolvedValue([]);

    await tocar('/asignaciones');

    expect(telegram.enviarMenuAsignaciones).toHaveBeenCalledTimes(1);
  });

  it('desde otro chat se ignora', async () => {
    await tocar(TEXTO_BOTON_ASIGNACIONES, '-999');

    expect(distributivo.asignaciones).not.toHaveBeenCalled();
    expect(telegram.enviarMenuAsignaciones).not.toHaveBeenCalled();
  });

  it('sin asignaciones cargadas lo dice en vez de mandar un mensaje vacío', async () => {
    distributivo.asignaciones.mockResolvedValue([]);
    prisma.enlaceRecinto.findMany.mockResolvedValue([]);

    await tocar(TEXTO_BOTON_ASIGNACIONES);

    expect(telegram.enviarMenuAsignaciones).not.toHaveBeenCalled();
    expect(telegram.enviarTexto).toHaveBeenCalledWith(
      'El distributivo no tiene asignaciones de técnicos.',
      expect.any(String),
    );
  });

  it('si el distributivo no está configurado en el servidor, lo dice', async () => {
    distributivo.asignaciones.mockRejectedValue(new DistributivoNoConfigurado());
    prisma.enlaceRecinto.findMany.mockResolvedValue([]);

    await tocar(TEXTO_BOTON_ASIGNACIONES);

    expect(telegram.enviarTexto).toHaveBeenCalledWith(
      expect.stringContaining('no está configurado'),
      expect.any(String),
    );
  });

  describe('botones de técnico', () => {
    const boton = (data: string, chat = '-100') =>
      service.procesarComandoTelegram('secreto123', {
        callback_query: { id: 'cb-1', data, message: { message_id: 55, chat: { id: chat } } },
      });

    beforeEach(() => {
      distributivo.asignaciones.mockResolvedValue([
        { codigoRecinto: '1126', localidad: 'UE Uno', numeroTecnico: 1, tecnico: 'Ana Pérez' },
        { codigoRecinto: '1272', localidad: 'UE Tres', numeroTecnico: 2, tecnico: 'Luis Mora' },
      ]);
      prisma.enlaceRecinto.findMany.mockResolvedValue([
        { codigoRecinto: '1126', nombreRecinto: 'UE Uno', canton: 'Ibarra', estado: 'FALLO' },
        { codigoRecinto: '500', nombreRecinto: 'Recinto Suelto', canton: 'Otavalo', estado: 'ACTIVO' },
      ]);
    });

    it('"asig:2" contesta el toque y cambia ese mensaje a los recintos de ese técnico', async () => {
      await boton('asig:2');

      expect(telegram.responderBoton).toHaveBeenCalledWith('cb-1');
      const [messageId, grupos, grupo] = telegram.mostrarAsignacionTecnico.mock.calls[0];
      expect(messageId).toBe(55);
      expect(grupos).toHaveLength(3);
      expect(grupo).toMatchObject({ numeroTecnico: 2, tecnico: 'Luis Mora' });
    });

    it('"asig:sin" muestra los recintos sin técnico', async () => {
      await boton('asig:sin');

      const [, , grupo] = telegram.mostrarAsignacionTecnico.mock.calls[0];
      expect(grupo.numeroTecnico).toBeNull();
      expect(grupo.recintos.map((r: { codigoRecinto: string }) => r.codigoRecinto)).toEqual(['500']);
    });

    it('un técnico que ya no está en el distributivo lo dice, sin editar', async () => {
      await boton('asig:9');

      expect(telegram.mostrarAsignacionTecnico).not.toHaveBeenCalled();
      expect(telegram.enviarTexto).toHaveBeenCalledWith(expect.stringContaining('ya no figura'), expect.any(String));
    });

    it.each([['asig:'], ['asig:1;x'], ['asig:abc'], ['asig:1234'], ['asig:0'], ['asig:007']])(
      'callback_data inválido ("%s") solo se contesta',
      async (data) => {
        await boton(data);

        expect(telegram.responderBoton).toHaveBeenCalled();
        expect(distributivo.asignaciones).not.toHaveBeenCalled();
        expect(telegram.mostrarAsignacionTecnico).not.toHaveBeenCalled();
      },
    );

    it('"↩ Resumen" devuelve ese mensaje al menú de técnicos', async () => {
      await boton('asig:menu');

      const [messageId, grupos] = telegram.editarMenuAsignaciones.mock.calls[0];
      expect(messageId).toBe(55);
      expect(grupos).toHaveLength(3);
      expect(telegram.mostrarAsignacionTecnico).not.toHaveBeenCalled();
    });

    it('el mismo técnico tocado dos veces seguidas no relee el distributivo', async () => {
      await boton('asig:1');
      await boton('asig:1');

      expect(telegram.mostrarAsignacionTecnico).toHaveBeenCalledTimes(1);
    });

    it('pasar rápido de un técnico a otro sí se atiende', async () => {
      await boton('asig:1');
      await boton('asig:2');

      expect(telegram.mostrarAsignacionTecnico).toHaveBeenCalledTimes(2);
    });

    it('un botón sin mensaje (modo inline) solo se contesta', async () => {
      await service.procesarComandoTelegram('secreto123', { callback_query: { id: 'cb-1', data: 'asig:1' } });

      expect(distributivo.asignaciones).not.toHaveBeenCalled();
    });

    it('desde un grupo de consulta responde en ese grupo', async () => {
      process.env.TELEGRAM_CHAT_IDS_CONSULTA = '-100555';
      try {
        await boton('asig:1', '-100555');

        expect(telegram.responderEn).toHaveBeenCalledWith('-100555', expect.any(Function));
        expect(telegram.mostrarAsignacionTecnico).toHaveBeenCalledTimes(1);
      } finally {
        delete process.env.TELEGRAM_CHAT_IDS_CONSULTA;
      }
    });

    it('desde otro chat se ignora', async () => {
      await boton('asig:1', '-999');

      expect(telegram.responderBoton).not.toHaveBeenCalled();
      expect(distributivo.asignaciones).not.toHaveBeenCalled();
    });

    it('si Drive falla al tocar un técnico, avisa en el grupo', async () => {
      distributivo.asignaciones.mockRejectedValue(new Error('Drive caído'));

      await boton('asig:1');

      expect(telegram.enviarTexto).toHaveBeenCalledWith(
        expect.stringContaining('No se pudieron consultar las asignaciones'),
        expect.any(String),
      );
    });
  });

  it('si Drive o la base fallan, avisa en el grupo', async () => {
    distributivo.asignaciones.mockRejectedValue(new Error('Drive caído'));
    prisma.enlaceRecinto.findMany.mockResolvedValue([]);

    await tocar(TEXTO_BOTON_ASIGNACIONES);

    expect(telegram.enviarTexto).toHaveBeenCalledWith(
      expect.stringContaining('No se pudieron consultar las asignaciones'),
      expect.any(String),
    );
  });
});

describe('formatearAsignaciones', () => {
  const recinto = (codigo: string, estado: 'ACTIVO' | 'FALLO' | null, nombre = `Recinto ${codigo}`) => ({
    codigoRecinto: codigo,
    nombreRecinto: nombre,
    canton: 'Cotacachi',
    estado,
  });

  it('numera a cada técnico, cuenta caídos y marca el estado de cada recinto (HTML escapado)', () => {
    const [mensaje, ...resto] = formatearAsignaciones([
      { numeroTecnico: 1, tecnico: 'Ana Pérez', recintos: [recinto('1126', 'FALLO'), recinto('323', 'ACTIVO', 'A <b> & C')] },
      { numeroTecnico: null, tecnico: '', recintos: [recinto('CPE', null)] },
    ]);

    expect(resto).toEqual([]);
    expect(mensaje).toContain('<b>👷 Asignaciones CDA</b>');
    expect(mensaje).toContain('<b>1. Ana Pérez</b> (2 · 1 caído)');
    expect(mensaje).toContain('🔴 1126 (Cot) — Recinto 1126');
    expect(mensaje).toContain('✅ 323 (Cot) — A &lt;b&gt; &amp; C');
    expect(mensaje).toContain('<b>Sin técnico asignado</b> (1)');
    expect(mensaje).toContain('⚪ CPE (Cot) — Recinto CPE');
  });

  it('un grupo que por sí solo no cabe se parte por líneas con "(cont.)" y nunca sale el encabezado solo', () => {
    const sinTecnico = {
      numeroTecnico: null,
      tecnico: '',
      recintos: Array.from({ length: 150 }, (_, i) => recinto(String(1000 + i), 'ACTIVO', 'N'.repeat(45))),
    };

    const mensajes = formatearAsignaciones([sinTecnico]);

    expect(mensajes.length).toBeGreaterThan(1);
    for (const m of mensajes) expect(m.length).toBeLessThanOrEqual(4000);
    expect(mensajes[0]).toContain('<b>Sin técnico asignado</b> (150)\n');
    expect(mensajes[1]).toMatch(/^<b>Sin técnico asignado<\/b> \(150\) \(cont\.\)\n/);
    expect(mensajes.join('\n')).toContain('1149 (Cot)');
    expect(mensajes.some((m) => m === '<b>👷 Asignaciones CDA</b>')).toBe(false);
  });

  it('si no cabe en un mensaje, lo parte entre técnicos sin cortar ningún grupo', () => {
    const largo = 'N'.repeat(60);
    const grupos = [1, 2, 3, 4, 5].map((n) => ({
      numeroTecnico: n,
      tecnico: `Técnico ${n}`,
      recintos: Array.from({ length: 20 }, (_, i) => recinto(String(n * 100 + i), 'ACTIVO', largo)),
    }));

    const mensajes = formatearAsignaciones(grupos);

    expect(mensajes.length).toBeGreaterThan(1);
    for (const m of mensajes) expect(m.length).toBeLessThanOrEqual(4000);
    for (const n of [1, 2, 3, 4, 5]) {
      const conTitulo = mensajes.filter((m) => m.includes(`<b>${n}. Técnico ${n}</b>`));
      expect(conTitulo).toHaveLength(1);
      expect(conTitulo[0]).toContain(`${n * 100 + 19} (Cot)`);
    }
  });
});

describe('menú de técnicos', () => {
  const grupos: GrupoAsignacion[] = [
    {
      numeroTecnico: 1,
      tecnico: 'Ana Pérez',
      recintos: [
        { codigoRecinto: '1', nombreRecinto: 'A', canton: null, estado: 'FALLO' },
        { codigoRecinto: '2', nombreRecinto: 'B', canton: null, estado: 'ACTIVO' },
      ],
    },
    { numeroTecnico: 2, tecnico: 'Luis Mora', recintos: [{ codigoRecinto: '3', nombreRecinto: 'C', canton: null, estado: 'ACTIVO' }] },
    { numeroTecnico: null, tecnico: '', recintos: [{ codigoRecinto: '4', nombreRecinto: 'D', canton: null, estado: null }] },
  ];

  it('en el resumen: un botón por fila, con su conteo y caídos, sin "Resumen"', () => {
    expect(tecladoTecnicos(grupos)).toEqual({
      inline_keyboard: [
        [{ text: '1. Ana Pérez (2 · 1🔴)', callback_data: 'asig:1' }],
        [{ text: '2. Luis Mora (1)', callback_data: 'asig:2' }],
        [{ text: 'Sin técnico (1)', callback_data: 'asig:sin' }],
      ],
    });
  });

  it('viendo un técnico: lo marca y agrega "↩ Resumen" al final', () => {
    const { inline_keyboard } = tecladoTecnicos(grupos, 'sin');
    expect(inline_keyboard.map(([b]) => b.text)).toEqual([
      '1. Ana Pérez (2 · 1🔴)',
      '2. Luis Mora (1)',
      '• Sin técnico (1) •',
      '↩ Resumen',
    ]);
    expect(inline_keyboard[3][0].callback_data).toBe('asig:menu');
  });

  it('con muchos técnicos, todos los callback_data caben en el límite de Telegram (64 bytes)', () => {
    const muchos = Array.from({ length: 120 }, (_, i) => ({ ...grupos[1], numeroTecnico: i + 1 }));
    const botones = tecladoTecnicos(muchos, '120').inline_keyboard.flat();
    expect(botones).toHaveLength(121);
    for (const b of botones) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
  });

  it('recorta nombres muy largos para que el botón se lea', () => {
    const [[boton]] = tecladoTecnicos([{ ...grupos[1], tecnico: 'N'.repeat(60) }]).inline_keyboard;
    expect(boton.text).toBe(`2. ${'N'.repeat(27)}… (1)`);
  });

  it('el mensaje de entrada trae los totales y la indicación', () => {
    expect(formatearMenuAsignaciones(grupos)).toBe(
      '<b>👷 Asignaciones CDA</b>\n2 técnicos · 4 recintos · 1 caído 🔴\n\nToque un técnico para ver sus recintos CDA.',
    );
  });
});

describe('TelegramNotifier — menú de asignaciones', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'tok';
    process.env.TELEGRAM_CHAT_ID = '-100';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  });
  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });
  const llamadas = () =>
    (global.fetch as jest.Mock).mock.calls.map(([url, o]) => ({
      metodo: String(url).split('/').pop(),
      cuerpo: JSON.parse(o.body),
    }));
  const grupo = (n: number, tecnico: string, cuantos = 2): GrupoAsignacion => ({
    numeroTecnico: n,
    tecnico,
    recintos: Array.from({ length: cuantos }, (_, i) => ({
      codigoRecinto: String(n * 1000 + i),
      nombreRecinto: 'N'.repeat(60),
      canton: null,
      estado: 'ACTIVO' as const,
    })),
  });

  it('envía el menú en HTML con los botones de técnico', async () => {
    const grupos = [grupo(1, 'Ana Pérez'), grupo(2, 'Luis Mora')];

    await new TelegramNotifier().enviarMenuAsignaciones(grupos);

    const [{ metodo, cuerpo }] = llamadas();
    expect(metodo).toBe('sendMessage');
    expect(cuerpo.parse_mode).toBe('HTML');
    expect(cuerpo.reply_markup).toEqual(tecladoTecnicos(grupos));
  });

  it('edita ese mensaje con los recintos del técnico (escapados) y el botón marcado', async () => {
    const grupos = [grupo(1, `O'Brien "<x>"`), grupo(2, 'Luis Mora')];

    await new TelegramNotifier().mostrarAsignacionTecnico(55, grupos, grupos[0]);

    const [{ metodo, cuerpo }, ...resto] = llamadas();
    expect(resto).toEqual([]);
    expect(metodo).toBe('editMessageText');
    expect(cuerpo).toMatchObject({ chat_id: '-100', message_id: 55, parse_mode: 'HTML' });
    expect(cuerpo.text).toContain('<b>1. O&#39;Brien &quot;&lt;x&gt;&quot;</b> (2)');
    expect(cuerpo.text).toContain('1001');
    expect(cuerpo.text).not.toContain('2000');
    expect(cuerpo.reply_markup).toEqual(tecladoTecnicos(grupos, '1'));
  });

  it('"↩ Resumen" edita ese mensaje de vuelta al menú', async () => {
    const grupos = [grupo(1, 'Ana Pérez'), grupo(2, 'Luis Mora')];

    await new TelegramNotifier().editarMenuAsignaciones(55, grupos);

    const [{ metodo, cuerpo }] = llamadas();
    expect(metodo).toBe('editMessageText');
    expect(cuerpo).toMatchObject({ message_id: 55, text: formatearMenuAsignaciones(grupos), parse_mode: 'HTML' });
    expect(cuerpo.reply_markup).toEqual(tecladoTecnicos(grupos));
  });

  it('si Telegram rechaza la edición (p. ej. "message is not modified"), no lanza', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ description: 'Bad Request: message is not modified' }),
      text: async () => '',
    });
    const grupos = [grupo(1, 'Ana Pérez')];

    await expect(new TelegramNotifier().mostrarAsignacionTecnico(55, grupos, grupos[0])).resolves.toBeUndefined();
  });

  it('si la lista del técnico no cabe en un mensaje, edita con la primera parte y manda el resto', async () => {
    const grupos = [grupo(1, 'Ana Pérez', 150)];

    await new TelegramNotifier().mostrarAsignacionTecnico(55, grupos, grupos[0]);

    const [primera, ...resto] = llamadas();
    expect(primera.metodo).toBe('editMessageText');
    expect(resto.length).toBeGreaterThan(0);
    expect(resto.every((l) => l.metodo === 'sendMessage')).toBe(true);
    expect(resto[resto.length - 1].cuerpo.text).toContain('1149');
  });
});

