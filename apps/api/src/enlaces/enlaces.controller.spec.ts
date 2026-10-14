import { EnlacesController } from './enlaces.controller';
import type { EnlacesService } from './enlaces.service';

describe('EnlacesController — webhook de Telegram', () => {
  it('contesta a Telegram sin esperar a que salga la respuesta del bot', () => {
    // Un envío que nunca termina (Telegram colgado) no debe frenar la respuesta.
    const procesarComandoTelegram = jest.fn().mockReturnValue(new Promise(() => undefined));
    const controller = new EnlacesController({ procesarComandoTelegram } as unknown as EnlacesService, {} as never);
    const update = { message: { text: '/caidos', chat: { id: 1 } } };

    expect(controller.telegramWebhook('secreto', update)).toEqual({ ok: true });
    expect(procesarComandoTelegram).toHaveBeenCalledWith('secreto', update);
  });

  it('un error al procesar el update queda en el log y no rompe la respuesta', async () => {
    const procesarComandoTelegram = jest.fn().mockRejectedValue(new Error('base caída'));
    const controller = new EnlacesController({ procesarComandoTelegram } as unknown as EnlacesService, {} as never);
    const log = jest.spyOn((controller as any).log, 'error').mockImplementation(() => undefined);

    expect(controller.telegramWebhook('secreto', {})).toEqual({ ok: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(log).toHaveBeenCalledWith(expect.stringContaining('base caída'));
  });
});
