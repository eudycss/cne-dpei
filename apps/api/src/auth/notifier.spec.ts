import { BrevoNotifier, ConsoleNotifier } from './notifier';

describe('ConsoleNotifier', () => {
  it('sendEnlaceCaido no lanza y resuelve', async () => {
    const notifier = new ConsoleNotifier();
    await expect(
      notifier.sendEnlaceCaido(['a@b.com'], [{ codigoRecinto: '978', nombreRecinto: 'Escuela Central' }]),
    ).resolves.toBeUndefined();
  });

  it('sendEnlaceRecuperado no lanza y resuelve', async () => {
    const notifier = new ConsoleNotifier();
    await expect(
      notifier.sendEnlaceRecuperado(['a@b.com'], [{ codigoRecinto: '978', nombreRecinto: 'Escuela Central' }]),
    ).resolves.toBeUndefined();
  });
});

describe('BrevoNotifier', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.BREVO_API_KEY = 'test-key';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.BREVO_API_KEY;
  });

  it('sendEnlaceCaido envía un correo a cada destinatario con codigo y nombre del recinto', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    const notifier = new BrevoNotifier();

    await notifier.sendEnlaceCaido(
      ['a@b.com', 'c@d.com'],
      [{ codigoRecinto: '978', nombreRecinto: 'Escuela Central' }],
    );

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.to).toEqual([{ email: 'a@b.com' }]);
    expect(body.htmlContent).toContain('978');
    expect(body.htmlContent).toContain('Escuela Central');
  });

  it('sendEnlaceCaido arma un solo correo con todos los recintos caídos cuando hay más de uno', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    const notifier = new BrevoNotifier();

    await notifier.sendEnlaceCaido(
      ['a@b.com'],
      [
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central' },
        { codigoRecinto: '982', nombreRecinto: 'Unidad Educativa Zaldumbide' },
      ],
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.subject).toContain('2 enlaces caídos');
    expect(body.htmlContent).toContain('978');
    expect(body.htmlContent).toContain('Escuela Central');
    expect(body.htmlContent).toContain('982');
    expect(body.htmlContent).toContain('Unidad Educativa Zaldumbide');
  });

  it('sendEnlaceCaido escapa HTML en codigoRecinto/nombreRecinto para evitar inyección desde la hoja de cálculo', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    const notifier = new BrevoNotifier();

    await notifier.sendEnlaceCaido(
      ['a@b.com'],
      [{ codigoRecinto: '978', nombreRecinto: '<img src=x onerror=alert(1)>' }],
    );

    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.htmlContent).not.toContain('<img src=x onerror=alert(1)>');
    expect(body.htmlContent).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('sendEnlaceCaido lanza si Brevo responde con error', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const notifier = new BrevoNotifier();

    await expect(
      notifier.sendEnlaceCaido(['a@b.com'], [{ codigoRecinto: '978', nombreRecinto: 'Escuela Central' }]),
    ).rejects.toThrow('a@b.com');
  });

  it('sendEnlaceCaido sigue con el resto de destinatarios aunque uno falle', async () => {
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ ok: true });
    const notifier = new BrevoNotifier();

    await expect(
      notifier.sendEnlaceCaido(
        ['falla@b.com', 'ok@d.com'],
        [{ codigoRecinto: '978', nombreRecinto: 'Escuela Central' }],
      ),
    ).rejects.toThrow('falla@b.com');

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const [, opts] = (global.fetch as jest.Mock).mock.calls[1];
    const body = JSON.parse(opts.body);
    expect(body.to).toEqual([{ email: 'ok@d.com' }]);
  });

  it('sendEnlaceRecuperado envía un correo a cada destinatario con codigo y nombre del recinto', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    const notifier = new BrevoNotifier();

    await notifier.sendEnlaceRecuperado(
      ['a@b.com', 'c@d.com'],
      [{ codigoRecinto: '978', nombreRecinto: 'Escuela Central' }],
    );

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.to).toEqual([{ email: 'a@b.com' }]);
    expect(body.subject).toContain('recuperado');
    expect(body.htmlContent).toContain('978');
    expect(body.htmlContent).toContain('Escuela Central');
    expect(body.htmlContent).toContain('ACTIVO');
  });

  it('sendEnlaceRecuperado arma un solo correo con todos los recintos recuperados cuando hay más de uno', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    const notifier = new BrevoNotifier();

    await notifier.sendEnlaceRecuperado(
      ['a@b.com'],
      [
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central' },
        { codigoRecinto: '982', nombreRecinto: 'Unidad Educativa Zaldumbide' },
      ],
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.subject).toContain('2 enlaces recuperados');
  });

  it('sendEnlaceRecuperado lanza si Brevo responde con error', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const notifier = new BrevoNotifier();

    await expect(
      notifier.sendEnlaceRecuperado(['a@b.com'], [{ codigoRecinto: '978', nombreRecinto: 'Escuela Central' }]),
    ).rejects.toThrow('a@b.com');
  });
});
