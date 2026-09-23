import { BrevoNotifier, ConsoleNotifier } from './notifier';

describe('ConsoleNotifier', () => {
  it('sendEnlaceCaido no lanza y resuelve', async () => {
    const notifier = new ConsoleNotifier();
    await expect(
      notifier.sendEnlaceCaido(['a@b.com'], '978', 'Escuela Central'),
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

    await notifier.sendEnlaceCaido(['a@b.com', 'c@d.com'], '978', 'Escuela Central');

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.to).toEqual([{ email: 'a@b.com' }]);
    expect(body.htmlContent).toContain('978');
    expect(body.htmlContent).toContain('Escuela Central');
  });

  it('sendEnlaceCaido lanza si Brevo responde con error', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const notifier = new BrevoNotifier();

    await expect(
      notifier.sendEnlaceCaido(['a@b.com'], '978', 'Escuela Central'),
    ).rejects.toThrow('Brevo 500: boom');
  });
});
