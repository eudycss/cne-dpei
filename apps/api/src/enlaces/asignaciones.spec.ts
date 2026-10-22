import { Test } from '@nestjs/testing';
import { EnlacesService } from './enlaces.service';
import { EnlacesEstadisticasService } from './enlaces-estadisticas.service';
import { PrismaService } from '../db/prisma.service';
import { SheetsEnlacesClient } from './sheets-enlaces.client';
import { formatearAsignaciones, TelegramNotifier, TEXTO_BOTON_ASIGNACIONES, type GrupoAsignacion } from './telegram-notifier';
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
    enviarAsignaciones: jest.fn().mockResolvedValue(undefined),
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

  it('agrupa por técnico en orden, con el estado de cada enlace, y deja al final los que no tienen técnico (menos el CPE)', async () => {
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
      { codigoRecinto: '777', nombreRecinto: 'UE Nueva', canton: 'Otavalo', estado: 'FALLO' },
      { codigoRecinto: 'CPE', nombreRecinto: 'CPE - IMBABURA', canton: 'Internet', estado: 'ACTIVO' },
    ]);

    await tocar(TEXTO_BOTON_ASIGNACIONES);

    const [grupos] = telegram.enviarAsignaciones.mock.calls[0] as [GrupoAsignacion[]];
    expect(grupos.map((g) => [g.numeroTecnico, g.tecnico, g.recintos.map((r) => [r.codigoRecinto, r.estado])])).toEqual([
      [1, 'Ana Pérez', [['1126', 'FALLO'], ['323', 'ACTIVO']]],
      [2, 'Luis Mora', [['1272', 'ACTIVO'], ['9999', null]]],
      // El CPE no sale en el bot: no es un recinto ni tiene técnico.
      [null, '', [['777', 'FALLO']]],
    ]);
    // Sin enlace monitoreado: se usa el nombre de la localidad del distributivo.
    expect(grupos[1].recintos[1].nombreRecinto).toBe('UE Sin Enlace');
  });

  it('también responde a /asignaciones', async () => {
    distributivo.asignaciones.mockResolvedValue([{ codigoRecinto: '1', localidad: 'X', numeroTecnico: 1, tecnico: 'A' }]);
    prisma.enlaceRecinto.findMany.mockResolvedValue([]);

    await tocar('/asignaciones');

    expect(telegram.enviarAsignaciones).toHaveBeenCalledTimes(1);
  });

  it('desde otro chat se ignora', async () => {
    await tocar(TEXTO_BOTON_ASIGNACIONES, '-999');

    expect(distributivo.asignaciones).not.toHaveBeenCalled();
    expect(telegram.enviarAsignaciones).not.toHaveBeenCalled();
  });

  it('sin asignaciones cargadas lo dice en vez de mandar un mensaje vacío', async () => {
    distributivo.asignaciones.mockResolvedValue([]);
    prisma.enlaceRecinto.findMany.mockResolvedValue([]);

    await tocar(TEXTO_BOTON_ASIGNACIONES);

    expect(telegram.enviarAsignaciones).not.toHaveBeenCalled();
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

describe('TelegramNotifier.enviarAsignaciones', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  it('manda cada parte en orden, en HTML, con el escape real de comillas y símbolos', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'tok';
    process.env.TELEGRAM_CHAT_ID = '-100';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const grupos = [1, 2, 3, 4, 5].map((n) => ({
      numeroTecnico: n,
      tecnico: n === 1 ? `O'Brien "<x>" & Co` : `Técnico ${n}`,
      recintos: Array.from({ length: 20 }, (_, i) => ({
        codigoRecinto: String(n * 100 + i),
        nombreRecinto: 'N'.repeat(60),
        canton: null,
        estado: 'ACTIVO' as const,
      })),
    }));

    await new TelegramNotifier().enviarAsignaciones(grupos);

    const cuerpos = (global.fetch as jest.Mock).mock.calls.map(([, o]) => JSON.parse(o.body));
    expect(cuerpos.length).toBe(formatearAsignaciones(grupos).length);
    expect(cuerpos.every((b) => b.parse_mode === 'HTML')).toBe(true);
    expect(cuerpos[0].text).toContain('<b>1. O&#39;Brien &quot;&lt;x&gt;&quot; &amp; Co</b>');
    expect(cuerpos[cuerpos.length - 1].text).toContain('519');
  });
});
