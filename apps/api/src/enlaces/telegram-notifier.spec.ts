import { Logger } from '@nestjs/common';
import {
  abreviarCanton,
  TelegramNotifier,
  TEXTO_BOTON_ASIGNACIONES,
  TEXTO_BOTON_CAIDOS,
  TEXTO_BOTON_ESTADISTICAS,
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
  let esperar: jest.SpyInstance;

  beforeEach(() => {
    // El reintento espera de verdad 2 s; en las pruebas solo se registra cuánto.
    esperar = jest.spyOn(TelegramNotifier.prototype as any, 'esperar').mockResolvedValue(undefined);
  });

  afterEach(() => {
    esperar.mockRestore();
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
        keyboard: [
          [{ text: TEXTO_BOTON_CAIDOS }, { text: TEXTO_BOTON_INGRESAR_CODIGO }],
          [{ text: TEXTO_BOTON_ESTADISTICAS }, { text: TEXTO_BOTON_ASIGNACIONES }],
        ],
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

  describe('tarjeta de estadísticas', () => {
    const stats = {
      periodo: 'semana',
      desde: '2026-10-12T05:00:00.000Z',
      hasta: '2026-10-19T05:00:00.000Z',
      historialDesde: '2026-01-01T00:00:00.000Z',
      datosParciales: false,
      totalRecintos: 1,
      ranking: [],
      sinCaidas: [{ codigoRecinto: '1', nombreRecinto: 'x', canton: '' }],
    } as const;
    const tarjeta = {
      titulo: 'Esta semana',
      actual: { ...stats, ranking: [], sinCaidas: [...stats.sinCaidas] },
      anterior: null,
      comparaHastaAhora: true,
    };

    beforeEach(() => {
      process.env.TELEGRAM_BOT_TOKEN = 'tok123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';
      global.fetch = jest.fn().mockResolvedValue({ ok: true });
    });

    it('con botones, la tarjeta lleva Hoy/Semana/Mes en vez del teclado fijo', async () => {
      await new TelegramNotifier().enviarTarjetaEstadisticas(tarjeta, true);

      const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(url).toBe('https://api.telegram.org/bottok123/sendMessage');
      expect(body.parse_mode).toBe('HTML');
      expect(body.reply_markup.inline_keyboard[0].map((b: { callback_data: string }) => b.callback_data)).toEqual([
        'est:dia',
        'est:semana',
        'est:mes',
      ]);
    });

    it('sin botones (resumen diario), lleva el teclado fijo como los demás mensajes', async () => {
      await new TelegramNotifier().enviarTarjetaEstadisticas(tarjeta, false);

      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(body.reply_markup.keyboard).toBeDefined();
    });

    it('editar cambia el mismo mensaje del chat configurado', async () => {
      await new TelegramNotifier().editarTarjetaEstadisticas(77, tarjeta);

      const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(url).toBe('https://api.telegram.org/bottok123/editMessageText');
      expect(body).toEqual(
        expect.objectContaining({ chat_id: '-100200300', message_id: 77, parse_mode: 'HTML' }),
      );
      expect(body.text).toContain('Esta semana');
      expect(body.reply_markup.inline_keyboard[0][1].text).toBe('• Semana •');
    });

    it('tocar el período que ya se ve (Telegram: "message is not modified") no es un error ni se reintenta', async () => {
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ ok: false, description: 'Bad Request: message is not modified: specified new message content and reply markup are exactly the same' }),
      });

      await new TelegramNotifier().editarTarjetaEstadisticas(77, tarjeta);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(error).not.toHaveBeenCalled();
      error.mockRestore();
    });

    it('otro 400 al editar sí se registra', async () => {
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ description: 'Bad Request: message to edit not found' }) });

      await new TelegramNotifier().editarTarjetaEstadisticas(77, tarjeta);

      expect(error).toHaveBeenCalledWith(expect.stringContaining('HTTP 400'));
      error.mockRestore();
    });

    it('responder un botón usa answerCallbackQuery con su id', async () => {
      await new TelegramNotifier().responderBoton('cb-1');

      const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://api.telegram.org/bottok123/answerCallbackQuery');
      expect(JSON.parse(opts.body)).toEqual({ callback_query_id: 'cb-1' });
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
        keyboard: [
          [{ text: TEXTO_BOTON_CAIDOS }, { text: TEXTO_BOTON_INGRESAR_CODIGO }],
          [{ text: TEXTO_BOTON_ESTADISTICAS }, { text: TEXTO_BOTON_ASIGNACIONES }],
        ],
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

  describe('límite de tiempo y reintento', () => {
    const respuesta = (status: number, json: unknown = {}) => ({ ok: status < 300, status, json: async () => json });

    beforeEach(() => {
      process.env.TELEGRAM_BOT_TOKEN = 'tok123';
      process.env.TELEGRAM_CHAT_ID = '-100200300';
    });

    it('cada envío lleva un límite de tiempo', async () => {
      global.fetch = jest.fn().mockResolvedValue(respuesta(200));
      await new TelegramNotifier().enviarTexto('hola', 'un texto');

      const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
      expect(opts.signal).toBeInstanceOf(AbortSignal);
    });

    it('si Telegram no responde a tiempo, reintenta una vez tras 2 s', async () => {
      const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
      global.fetch = jest.fn().mockRejectedValueOnce(timeout).mockResolvedValueOnce(respuesta(200));

      await new TelegramNotifier().enviarTexto('hola', 'un texto');

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(esperar).toHaveBeenCalledWith(2000);
    });

    it('un 5xx (ej. 504) se reintenta una vez', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce(respuesta(504)).mockResolvedValueOnce(respuesta(200));

      await new TelegramNotifier().enviarListaActual([]);

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('si el reintento también falla, no insiste más ni lanza', async () => {
      global.fetch = jest.fn().mockResolvedValue(respuesta(502));

      await expect(new TelegramNotifier().enviarTexto('hola', 'un texto')).resolves.toBeUndefined();
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it.each([400, 401, 403])('un %i no se reintenta (repetir no lo arregla)', async (status) => {
      global.fetch = jest.fn().mockResolvedValue(respuesta(status));

      await new TelegramNotifier().enviarTexto('hola', 'un texto');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(esperar).not.toHaveBeenCalled();
    });

    it('un error de red cualquiera (no timeout) también se reintenta', async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(respuesta(200));

      await new TelegramNotifier().enviarTexto('hola', 'un texto');

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('un 429 espera lo que pide Telegram (retry_after)', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(respuesta(429, { parameters: { retry_after: 3 } }))
        .mockResolvedValueOnce(respuesta(200));

      await new TelegramNotifier().enviarTexto('hola', 'un texto');

      expect(esperar).toHaveBeenCalledWith(3000);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('un 429 que pide más de 5 s no se reintenta (solo traería otro 429)', async () => {
      global.fetch = jest.fn().mockResolvedValue(respuesta(429, { parameters: { retry_after: 40 } }));

      await new TelegramNotifier().enviarTexto('hola', 'un texto');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(esperar).not.toHaveBeenCalled();
    });

    it('un 429 sin retry_after o con un cuerpo ilegible espera 1 s', async () => {
      const ilegible = { ok: false, status: 429, json: async () => Promise.reject(new SyntaxError('x')) };
      global.fetch = jest.fn().mockResolvedValueOnce(respuesta(429)).mockResolvedValueOnce(respuesta(200));
      await new TelegramNotifier().enviarTexto('hola', 'un texto');
      expect(esperar).toHaveBeenLastCalledWith(1000);

      global.fetch = jest.fn().mockResolvedValueOnce(ilegible).mockResolvedValueOnce(respuesta(200));
      await new TelegramNotifier().enviarTexto('hola', 'un texto');
      expect(esperar).toHaveBeenLastCalledWith(1000);
    });

    it('un 429 en el segundo intento no provoca un tercero', async () => {
      global.fetch = jest.fn().mockResolvedValue(respuesta(429, { parameters: { retry_after: 1 } }));

      await expect(new TelegramNotifier().enviarTexto('hola', 'un texto')).resolves.toBeUndefined();
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('los logs de error nunca incluyen el token, aunque el error traiga la URL', async () => {
      const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const conUrl = Object.assign(new TypeError('fetch failed https://api.telegram.org/bottok123/sendMessage'), {
        cause: { code: 'ECONNRESET' },
      });
      global.fetch = jest.fn().mockRejectedValue(conUrl);

      await new TelegramNotifier().enviarTexto('hola', 'un texto');

      const mensajes = log.mock.calls.map((c) => String(c[0])).join(' | ');
      expect(mensajes).toContain('ECONNRESET');
      expect(mensajes).not.toContain('tok123');
      log.mockRestore();
    });

    it('un 4xx avisa en el log que no se reintenta', async () => {
      const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      global.fetch = jest.fn().mockResolvedValue(respuesta(403));

      await new TelegramNotifier().enviarTexto('hola', 'un texto');

      expect(log).toHaveBeenCalledWith(expect.stringContaining('HTTP 403 — no se reintenta'));
      log.mockRestore();
    });
  });
});
