import { AppController } from './app.controller';

describe('AppController', () => {
  it('health responde status ok', () => {
    const controller = new AppController();
    expect(controller.health()).toEqual({ status: 'ok' });
  });
});
