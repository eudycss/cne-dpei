import { TelegramNotifier } from './telegram-notifier';

describe('TelegramNotifier', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  it('no llama a fetch si faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID', async () => {
    global.fetch = jest.fn();
    const notifier = new TelegramNotifier();

    await notifier.enviarEnlaceCaido('978', 'Escuela Central');

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('envía el mensaje con codigo y nombre del recinto al chat configurado', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'tok123';
    process.env.TELEGRAM_CHAT_ID = '-100200300';
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    const notifier = new TelegramNotifier();

    await notifier.enviarEnlaceCaido('978', 'Escuela Central');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.telegram.org/bottok123/sendMessage',
      expect.objectContaining({ method: 'POST' }),
    );
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.chat_id).toBe('-100200300');
    expect(body.text).toContain('978');
    expect(body.text).toContain('Escuela Central');
  });

  it('no lanza si fetch rechaza (error de red)', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'tok123';
    process.env.TELEGRAM_CHAT_ID = '-100200300';
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    const notifier = new TelegramNotifier();

    await expect(notifier.enviarEnlaceCaido('978', 'Escuela Central')).resolves.not.toThrow();
  });
});
