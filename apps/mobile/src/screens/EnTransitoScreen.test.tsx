import { act, create, ReactTestRenderer } from 'react-test-renderer';

// react-native-testing-library no está instalado en este proyecto; se usa
// react-test-renderer directamente (ya disponible como dependencia transitiva
// de jest-expo). El render inicial de un árbol RN completo es lento la primera
// vez que se transforma cada módulo nativo mockeado.
jest.setTimeout(30000);

jest.mock('../lib/location', () => ({
  iniciarRastreoPrimerPlano: jest.fn(),
}));

jest.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { nombres: 'Ana', apellidos: 'Perez' }, logout: jest.fn() }),
}));

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));

jest.mock('../components/AppBar', () => ({ AppBar: () => null }));

import { EnTransitoScreen } from './EnTransitoScreen';
import { iniciarRastreoPrimerPlano } from '../lib/location';

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

describe('EnTransitoScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('arranca el rastreo GPS en primer plano al montar', async () => {
    const remove = jest.fn();
    (iniciarRastreoPrimerPlano as jest.Mock).mockResolvedValue({ remove });

    await act(async () => {
      create(<EnTransitoScreen onMarcarLlegada={jest.fn()} />);
      await flushPromises();
    });

    expect(iniciarRastreoPrimerPlano).toHaveBeenCalledTimes(1);
  });

  it('limpia la suscripción de rastreo al desmontar', async () => {
    const remove = jest.fn();
    (iniciarRastreoPrimerPlano as jest.Mock).mockResolvedValue({ remove });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<EnTransitoScreen onMarcarLlegada={jest.fn()} />);
      await flushPromises();
    });

    await act(async () => {
      renderer.unmount();
    });

    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('no falla si no se pudo iniciar el rastreo (sin permiso o servicios desactivados)', async () => {
    (iniciarRastreoPrimerPlano as jest.Mock).mockResolvedValue(null);

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<EnTransitoScreen onMarcarLlegada={jest.fn()} />);
      await flushPromises();
    });

    expect(() => renderer.unmount()).not.toThrow();
  });
});
