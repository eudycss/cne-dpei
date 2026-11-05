import type { Jornada, UnidadJornada } from './jornada';
import { JornadaResumenService } from './jornada-resumen.service';
import type { JornadaService } from './jornada.service';
import type { TelegramNotifier } from '../telegram-notifier';

const CHAT = '-100777';
// 15:00 UTC = 10:00 en Ecuador.
const AHORA = new Date('2026-11-29T15:00:00Z');
const minutos = (n: number) => new Date(AHORA.getTime() + n * 60_000);
const r = (en: Date) => ({ en, sinSenal: false });

function unidad(codigo: string, extra: Partial<UnidadJornada> = {}): UnidadJornada {
  return {
    codigoRecinto: codigo,
    nombreRecinto: `Recinto ${codigo}`,
    tecnico: { numero: 1, nombre: 'Jairo' },
    canton: { codigo: 30, nombre: 'IBARRA' },
    personas: [],
    registros: {},
    kitRecibido: null,
    ...extra,
  };
}

const jornada = (unidades: UnidadJornada[]): Jornada => ({ evento: 'Prueba', unidades, noCdas: [], sinKit: [], sinDistributivo: false });

describe('JornadaResumenService', () => {
  const cargar = jest.fn();
  const telegram = {
    enviarHtml: jest.fn().mockResolvedValue(undefined),
    responderEn: jest.fn((_chat: string, fn: () => Promise<unknown>) => fn()),
  };
  let service: JornadaResumenService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TELEGRAM_CHAT_ID_JORNADA = CHAT;
    service = new JornadaResumenService({ cargar } as unknown as JornadaService, telegram as unknown as TelegramNotifier);
  });

  afterEach(() => {
    delete process.env.TELEGRAM_CHAT_ID_JORNADA;
    delete process.env.ENLACES_CRON_ENABLED;
  });

  const enviados = () => telegram.enviarHtml.mock.calls.map(([texto, , , opciones]) => ({ texto, opciones }));

  it('manda el resumen sin sonido al grupo Jornada, con los botones de las vistas', async () => {
    cargar.mockResolvedValue(jornada([unidad('971', { registros: { SALIDA_DPI: r(AHORA) } }), unidad('1290')]));
    await service.enviarSiCambio(AHORA);
    expect(telegram.responderEn).toHaveBeenCalledWith(CHAT, expect.any(Function));
    const [texto, , botones, opciones] = telegram.enviarHtml.mock.calls[0];
    expect(texto).toContain('resumen automático');
    expect(texto).toContain('1/2 · faltan 1');
    expect(JSON.stringify(botones)).toContain('jor:nc:d:res:0');
    expect(opciones).toEqual({ silencioso: true });
  });

  it('si nada cambió no manda otro; si cambió, dice qué cambió desde el anterior', async () => {
    cargar.mockResolvedValue(jornada([unidad('971', { registros: { SALIDA_DPI: r(AHORA) } }), unidad('1290')]));
    await service.enviarSiCambio(AHORA);
    await service.enviarSiCambio(minutos(15));
    expect(telegram.enviarHtml).toHaveBeenCalledTimes(1);

    cargar.mockResolvedValue(
      jornada([unidad('971', { registros: { SALIDA_DPI: r(AHORA) } }), unidad('1290', { registros: { SALIDA_DPI: r(minutos(20)) } })]),
    );
    await service.enviarSiCambio(minutos(30));
    expect(telegram.enviarHtml).toHaveBeenCalledTimes(2);
    expect(enviados()[1].texto).toContain('Desde las 10:00: 🚐 +1 salieron del DPEI');
  });

  it('sin evento activo o antes de la primera salida del DPEI no manda nada', async () => {
    cargar.mockResolvedValue(null);
    await service.enviarSiCambio(AHORA);
    cargar.mockResolvedValue(jornada([unidad('971')]));
    await service.enviarSiCambio(AHORA);
    expect(telegram.enviarHtml).not.toHaveBeenCalled();
  });

  it('el cierre se manda una sola vez, con sonido, y ese día no se manda más', async () => {
    const cerrada = jornada([
      unidad('971', { registros: { SALIDA_DPI: r(AHORA), LLEGADA_DPI: r(minutos(5)) }, kitRecibido: minutos(6) }),
    ]);
    cargar.mockResolvedValue(cerrada);
    await service.enviarSiCambio(AHORA);
    await service.enviarSiCambio(minutos(15));
    expect(telegram.enviarHtml).toHaveBeenCalledTimes(1);
    expect(enviados()[0].texto).toContain('✅ Jornada cerrada');
    expect(enviados()[0].opciones).toEqual({ silencioso: false });
  });

  it('otro día de jornada empieza de cero (vuelve a mandar aunque los números sean iguales)', async () => {
    cargar.mockResolvedValue(jornada([unidad('971', { registros: { SALIDA_DPI: r(AHORA) } }), unidad('1290')]));
    await service.enviarSiCambio(AHORA);
    await service.enviarSiCambio(minutos(24 * 60));
    expect(telegram.enviarHtml).toHaveBeenCalledTimes(2);
    expect(enviados()[1].texto).not.toContain('Desde las');
  });

  it('sin el grupo Jornada configurado, o con el cron de enlaces apagado, no hace nada', async () => {
    cargar.mockResolvedValue(jornada([unidad('971', { registros: { SALIDA_DPI: r(AHORA) } })]));
    delete process.env.TELEGRAM_CHAT_ID_JORNADA;
    await service.enviarSiCambio(AHORA);
    process.env.TELEGRAM_CHAT_ID_JORNADA = CHAT;
    process.env.ENLACES_CRON_ENABLED = 'false';
    await service.cadaQuinceMinutos();
    expect(cargar).not.toHaveBeenCalled();
    expect(telegram.enviarHtml).not.toHaveBeenCalled();
  });

  it('si la base falla, el cron lo registra y no se cae', async () => {
    cargar.mockRejectedValue(new Error('base caída'));
    await expect(service.cadaQuinceMinutos()).resolves.toBeUndefined();
    expect(telegram.enviarHtml).not.toHaveBeenCalled();
  });
});
