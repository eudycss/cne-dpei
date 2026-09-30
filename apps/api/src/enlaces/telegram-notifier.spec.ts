import {
  abreviarCanton,
  TelegramNotifier,
  TEXTO_BOTON_CAIDOS,
  TEXTO_BOTON_INGRESAR_CODIGO,
} from './telegram-notifier';

describe('abreviarCanton', () => {
  it.each([
    ['Ibarra', 'Iba'],
    ['Otavalo', 'Ota'],
    ['Cotacachi', 'Cot'],
    ['Antonio Ante', 'Ant'],
    ['Urcuqui', 'Urc'],
    ['Urcuquí', 'Urc'],
    ['San Miguel De Urcuquí', 'Urc'],
    ['Pimampiro', 'Pim'],
    ['  COTACACHI ', 'Cot'],
  ])('%s → %s', (canton, esperado) => {
    expect(abreviarCanton(canton)).toBe(esperado);
  });

  it.each([['Internet'], [''], [null], [undefined]])('%p → sin abreviatura', (canton) => {
    expect(abreviarCanton(canton)).toBe('');
  });

  it('un cantón que no está en el mapa usa sus 3 primeras letras', () => {
    expect(abreviarCanton('MIRA')).toBe('Mir');
  });

  it.each([
    ['<b>x', 'Bx'],
    ['&amp', 'Amp'],
    ['123', ''],
    ['-', ''],
  ])('un valor raro de la hoja (%p) solo deja letras → %p', (canton, esperado) => {
    expect(abreviarCanton(canton)).toBe(esperado);
  });
});

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

    it('destaca con 🚨 y negrita solo los recintos que acaban de caer, dejando el resto sin marcar', async () => {
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
      expect(body.parse_mode).toBe('HTML');
      expect(body.text).toContain('🚨 <b>982 — Unidad Educativa Zaldumbide</b>');
      expect(body.text).not.toContain('🚨 <b>978');
      expect(body.text).toContain('\n978 — Escuela Central');
    });

    it('muestra el cantón abreviado después del código, y nada para el CPE ("Internet")', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'tok123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';
      global.fetch = jest.fn().mockResolvedValue({ ok: true });
      const notifier = new TelegramNotifier();

      await notifier.enviarListaActual(
        [
          { codigoRecinto: '1207', nombreRecinto: 'Escuela Guallupe', canton: 'Cotacachi' },
          { codigoRecinto: '1969', nombreRecinto: 'UE Apuela', canton: 'Cotacachi' },
          { codigoRecinto: 'CPE', nombreRecinto: 'CPE - IMBABURA', canton: 'Internet' },
        ],
        new Set(['1969']),
      );

      const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.text).toContain('1207 (Cot) — Escuela Guallupe');
      expect(body.text).toContain('🚨 <b>1969 (Cot) — UE Apuela</b>');
      expect(body.text).toContain('\nCPE — CPE - IMBABURA');
    });

    it('escapa HTML del código y nombre (vienen de una hoja editada a mano)', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'tok123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';
      global.fetch = jest.fn().mockResolvedValue({ ok: true });
      const notifier = new TelegramNotifier();

      await notifier.enviarListaActual(
        [{ codigoRecinto: '<b>1', nombreRecinto: 'Escuela <script>x</script> & Co', canton: 'Ibarra' }],
        new Set(['<b>1']),
      );

      const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.text).toContain(
        '🚨 <b>&lt;b&gt;1 (Iba) — Escuela &lt;script&gt;x&lt;/script&gt; &amp; Co</b>',
      );
      expect(body.text).not.toContain('<script>');
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

    it('adjunta los botones fijos de "Caídos" e "Ingresar código" en el teclado del mensaje', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'tok123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';
      global.fetch = jest.fn().mockResolvedValue({ ok: true });
      const notifier = new TelegramNotifier();

      await notifier.enviarListaActual([]);

      const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.reply_markup).toEqual({
        keyboard: [[{ text: TEXTO_BOTON_CAIDOS }, { text: TEXTO_BOTON_INGRESAR_CODIGO }]],
        resize_keyboard: true,
      });
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

    it('muestra el cantón abreviado y escapa el contenido (va con parse_mode HTML)', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'tok123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';
      global.fetch = jest.fn().mockResolvedValue({ ok: true });
      const notifier = new TelegramNotifier();

      await notifier.enviarRecuperados([
        { codigoRecinto: '1221', nombreRecinto: 'UE Otavalo & Anexo', canton: 'Otavalo' },
      ]);

      const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.parse_mode).toBe('HTML');
      expect(body.text).toContain('1221 (Ota) — UE Otavalo &amp; Anexo');
    });

    it('un cantón fuera del mapa con símbolos HTML no rompe el mensaje', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'tok123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';
      global.fetch = jest.fn().mockResolvedValue({ ok: true });
      const notifier = new TelegramNotifier();

      await notifier.enviarRecuperados([{ codigoRecinto: '1', nombreRecinto: 'Escuela', canton: '<i&x' }]);

      const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.text).toContain('1 (Ix) — Escuela');
      expect(body.text).not.toMatch(/[<&]/);
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

  describe('enviarTexto', () => {
    it('manda el texto tal cual, con el mismo teclado fijo que los demás mensajes', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'tok123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';
      global.fetch = jest.fn().mockResolvedValue({ ok: true });
      const notifier = new TelegramNotifier();

      await notifier.enviarTexto('📍 978 — Escuela Central\nEstado: 🔴 FALLO', 'el resultado de búsqueda');

      const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.text).toBe('📍 978 — Escuela Central\nEstado: 🔴 FALLO');
      // Texto libre sin escapar: con parse_mode HTML, un "<" del usuario rompería el envío.
      expect(body.parse_mode).toBeUndefined();
      expect(body.reply_markup).toEqual({
        keyboard: [[{ text: TEXTO_BOTON_CAIDOS }, { text: TEXTO_BOTON_INGRESAR_CODIGO }]],
        resize_keyboard: true,
      });
    });

    it('no llama a fetch si faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID', async () => {
      global.fetch = jest.fn();
      const notifier = new TelegramNotifier();

      await notifier.enviarTexto('hola', 'un texto');

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('no lanza si fetch rechaza (error de red)', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'tok123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';
      global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
      const notifier = new TelegramNotifier();

      await expect(notifier.enviarTexto('hola', 'un texto')).resolves.not.toThrow();
    });
  });
});
