import { act, create, ReactTestRenderer, TestInstance } from 'react-test-renderer';
import { Alert, Pressable } from 'react-native';
import type { MiAsignacionResponse } from '@cne/shared-types';

// react-native-testing-library no está instalado en este proyecto; se usa
// react-test-renderer directamente (ya disponible como dependencia transitiva
// de jest-expo). El render inicial de un árbol RN completo es lento la primera
// vez que se transforma cada módulo nativo mockeado.
jest.setTimeout(30000);

jest.mock('../lib/queries/tracking', () => ({
  getMiAsignacion: jest.fn(),
  postSalidaDpi: jest.fn(),
}));

jest.mock('../lib/location', () => {
  class LocationPermissionDeniedError extends Error {}
  class LocationServicesDisabledError extends Error {}
  return {
    LocationPermissionDeniedError,
    LocationServicesDisabledError,
    obtenerUbicacionPuntual: jest.fn(),
    solicitarPermisoBackground: jest.fn(),
    iniciarRastreo: jest.fn(),
  };
});

jest.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { nombres: 'Ana', apellidos: 'Perez' }, logout: jest.fn() }),
}));

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));

jest.mock('../components/AppBar', () => ({ AppBar: () => null }));

import { SalidaDpiScreen } from './SalidaDpiScreen';
import { getMiAsignacion, postSalidaDpi } from '../lib/queries/tracking';
import { obtenerUbicacionPuntual, solicitarPermisoBackground, iniciarRastreo } from '../lib/location';

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

const asignacionFixture: MiAsignacionResponse = {
  eventoId: 'ev1',
  eventoNombre: 'Elecciones 2026',
  recinto: {
    id: 'r1',
    codigoRecinto: 'R001',
    nombre: 'Escuela Central',
    direccion: null,
    cantonNombre: null,
    parroquia: null,
    juntasFemeninas: null,
    juntasMasculinas: null,
    llegadaRegistradaEn: null,
    latitud: null,
    longitud: null,
  },
  noCdas: [],
  militar: null,
  kits: [{ id: 'k1', codigoUnico: 'K001', nombre: 'Kit 1', contenidos: null, recibido: false }],
  yaRegistroSalida: false,
  yaRegistroLlegada: false,
  yaRegistroSalidaRecinto: false,
  yaRegistroLlegadaDpi: false,
  fotoMilitarUrl: null,
  margenLlegadaMetros: 100,
};

/** Sube por el árbol desde un nodo (p.ej. el Text de un botón) hasta el <Pressable> que lo contiene. */
function pressableAncestor(instance: TestInstance): TestInstance {
  let node: TestInstance | null = instance;
  while (node && node.type !== Pressable) node = node.parent;
  if (!node) throw new Error('No se encontró un <Pressable> ancestro');
  return node;
}

async function presionarRegistrarSalida(renderer: ReactTestRenderer) {
  const boton = renderer.root.findByProps({ children: 'Registrar Salida de Delegación' });
  await act(async () => {
    pressableAncestor(boton).props.onPress();
    await flushPromises();
  });
}

describe('SalidaDpiScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getMiAsignacion as jest.Mock).mockResolvedValue(asignacionFixture);
    (obtenerUbicacionPuntual as jest.Mock).mockResolvedValue({ latitud: 1, longitud: 2, precisionMetros: 5 });
    (postSalidaDpi as jest.Mock).mockResolvedValue({ id: 'salida-1' });
    (solicitarPermisoBackground as jest.Mock).mockResolvedValue(undefined);
    (iniciarRastreo as jest.Mock).mockResolvedValue(undefined);
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const target = (buttons ?? []).find((b) => b.text !== 'Cancelar');
      target?.onPress?.();
    });
  });

  it('tras registrar la salida exitosamente, solicita el permiso en segundo plano e inicia el rastreo', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<SalidaDpiScreen onSalidaRegistrada={jest.fn()} />);
      await flushPromises();
    });

    await presionarRegistrarSalida(renderer);

    expect(postSalidaDpi).toHaveBeenCalledTimes(1);
    expect(solicitarPermisoBackground).toHaveBeenCalledTimes(1);
    expect(iniciarRastreo).toHaveBeenCalledTimes(1);
  });

  it('si el rastreo en segundo plano falla, avisa con una alerta pero no bloquea el flujo', async () => {
    (solicitarPermisoBackground as jest.Mock).mockRejectedValue(new Error('sin permiso de background'));
    const onSalidaRegistrada = jest.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<SalidaDpiScreen onSalidaRegistrada={onSalidaRegistrada} />);
      await flushPromises();
    });

    await presionarRegistrarSalida(renderer);

    expect(iniciarRastreo).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Rastreo en segundo plano no disponible',
      expect.any(String),
    );
    // Best-effort: la salida ya registrada permite continuar el flujo igual.
    expect(onSalidaRegistrada).toHaveBeenCalledTimes(1);
  });
});
