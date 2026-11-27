jest.mock('../lib/queries/tracking', () => ({ getMiAsignacion: jest.fn(), postLlegadaNoCda: jest.fn() }));
jest.mock('../lib/offline-queue', () => ({ hayPendiente: jest.fn() }));
jest.mock('../theme/ThemeContext', () => ({ useTheme: () => ({ colors: {} }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { BLOQUEO_ANTES_DE_LLEGAR, BLOQUEO_TRAS_SALIDA, bloqueoNoCda } from './NoCdaChecklist';

describe('bloqueoNoCda (Mi recinto)', () => {
  it('antes de llegar al CDA, los NO CDA quedan bloqueados', () => {
    expect(bloqueoNoCda({ yaRegistroLlegada: false, yaRegistroSalidaRecinto: false })).toBe(BLOQUEO_ANTES_DE_LLEGAR);
  });

  it('con la llegada al CDA aún en la cola (sin señal), ya se pueden marcar', () => {
    expect(bloqueoNoCda({ yaRegistroLlegada: false, yaRegistroSalidaRecinto: false }, true)).toBeNull();
  });

  it('en el CDA se pueden marcar', () => {
    expect(bloqueoNoCda({ yaRegistroLlegada: true, yaRegistroSalidaRecinto: false })).toBeNull();
  });

  it('tras la salida del CDA vuelven a bloquearse', () => {
    expect(bloqueoNoCda({ yaRegistroLlegada: true, yaRegistroSalidaRecinto: true })).toBe(BLOQUEO_TRAS_SALIDA);
  });
});
