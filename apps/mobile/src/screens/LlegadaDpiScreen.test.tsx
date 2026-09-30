import { act, create, ReactTestRenderer, TestInstance } from 'react-test-renderer';
import { Pressable } from 'react-native';
import type { MiAsignacionResponse } from '@cne/shared-types';

// Mismo enfoque que EnTransitoScreen.test.tsx: react-test-renderer directo.
jest.setTimeout(30000);

jest.mock('../lib/queries/tracking', () => ({ getMiAsignacion: jest.fn() }));
jest.mock('../lib/queries/retorno', () => ({ postLlegadaDpi: jest.fn() }));
jest.mock('../lib/location', () => {
  class LocationPermissionDeniedError extends Error {}
  class LocationServicesDisabledError extends Error {}
  return {
    LocationPermissionDeniedError,
    LocationServicesDisabledError,
    detenerRastreo: jest.fn(),
    obtenerUbicacionPuntual: jest.fn(),
  };
});
jest.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { nombres: 'Ana', apellidos: 'Perez' }, logout: jest.fn() }),
}));
jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));
jest.mock('../components/AppBar', () => ({ AppBar: () => null }));

import { LlegadaDpiScreen } from './LlegadaDpiScreen';
import { getMiAsignacion } from '../lib/queries/tracking';

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

const asignacion = {
  kits: [
    { id: 'k1', codigoUnico: 'KIT-001', nombre: 'Kit Junta 1', contenidos: null, items: [], recibido: true },
  ],
  yaRegistroLlegadaDpi: false,
} as unknown as MiAsignacionResponse;

function checkboxes(renderer: ReactTestRenderer): TestInstance[] {
  return renderer.root.findAll((n) => n.type === Pressable && n.props.accessibilityRole === 'checkbox');
}

describe('LlegadaDpiScreen — accesibilidad del checkbox de kit (WCAG 4.1.2)', () => {
  it('expone rol checkbox, nombre del kit y estado marcado/desmarcado', async () => {
    (getMiAsignacion as jest.Mock).mockResolvedValue(asignacion);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<LlegadaDpiScreen onLlegadaRegistrada={jest.fn()} />);
      await flushPromises();
    });

    const [kit] = checkboxes(renderer);
    expect(kit).toBeDefined();
    expect(kit.props.accessibilityLabel).toMatch(/Kit Junta 1.*KIT-001/);
    expect(kit.props.accessibilityState).toEqual({ checked: false });

    await act(async () => kit.props.onPress());
    expect(checkboxes(renderer)[0].props.accessibilityState).toEqual({ checked: true });
  });
});
