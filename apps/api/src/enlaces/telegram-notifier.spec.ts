import { TelegramNotifier } from './telegram-notifier';

describe('TelegramNotifier', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  describe('enviarListaActual', () => {
    it('no llama a fetch si faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID', async () => {
      global.fetch = jest.fn();
      const notifier = new TelegramNotifier();

      await notifier.enviarListaActual([{ codigoRecinto: '978', nombreRecinto: 'Escuela Central' }]);

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('manda un solo mensaje con todos los recintos caídos', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'tok123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';
      global.fetch = jest.fn().mockResolvedValue({ ok: true });
      const notifier = new TelegramNotifier();

      await notifier.enviarListaActual([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central' },
        { codigoRecinto: '982', nombreRecinto: 'Unidad Educativa Zaldumbide' },
      ]);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bottok123/sendMessage',
        expect.objectContaining({ method: 'POST' }),
      );
      const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.chat_id).toBe('-100200300');
      expect(body.text).toContain('978');
      expect(body.text).toContain('Escuela Central');
      expect(body.text).toContain('982');
      expect(body.text).toContain('Unidad Educativa Zaldumbide');
      expect(body.text).toContain('2');
    });

    it('marca con 🆕 solo los recintos que acaban de caer, dejando el resto sin marcar', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'tok123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';
      global.fetch = jest.fn().mockResolvedValue({ ok: true });
      const notifier = new TelegramNotifier();

      await notifier.enviarListaActual(
        [
          { codigoRecinto: '978', nombreRecinto: 'Escuela Central' },
          { codigoRecinto: '982', nombreRecinto: 'Unidad Educativa Zaldumbide' },
        ],
        new Set(['982']),
      );

      const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.text).toContain('🆕 982 — Unidad Educativa Zaldumbide');
      expect(body.text).not.toContain('🆕 978');
      expect(body.text).toContain('978 — Escuela Central');
    });

    it('avisa que no hay caídos en vez de mandar una lista vacía', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'tok123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';
      global.fetch = jest.fn().mockResolvedValue({ ok: true });
      const notifier = new TelegramNotifier();

      await notifier.enviarListaActual([]);

      const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.text).toMatch(/no hay enlaces caídos/i);
    });

    it('no lanza si fetch rechaza (error de red)', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'tok123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';
      global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
      const notifier = new TelegramNotifier();

      await expect(notifier.enviarListaActual([])).resolves.not.toThrow();
    });
  });

  describe('enviarRecuperados', () => {
    it('no llama a fetch si la lista de recuperados está vacía', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'tok123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';
      global.fetch = jest.fn();
      const notifier = new TelegramNotifier();

      await notifier.enviarRecuperados([]);

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('manda un mensaje con los recintos que volvieron a ACTIVO', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'tok123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';
      global.fetch = jest.fn().mockResolvedValue({ ok: true });
      const notifier = new TelegramNotifier();

      await notifier.enviarRecuperados([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central' },
      ]);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.text).toContain('✅');
      expect(body.text).toContain('978');
      expect(body.text).toContain('Escuela Central');
    });

    it('no lanza si fetch rechaza (error de red)', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'tok123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';
      global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
      const notifier = new TelegramNotifier();

      await expect(
        notifier.enviarRecuperados([{ codigoRecinto: '978', nombreRecinto: 'Escuela Central' }]),
      ).resolves.not.toThrow();
    });
  });
});
