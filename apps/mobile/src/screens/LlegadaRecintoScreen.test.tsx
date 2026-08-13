import { act, create, ReactTestRenderer, TestInstance } from 'react-test-renderer';
import { Pressable } from 'react-native';
import type { MiAsignacionResponse } from '@cne/shared-types';

// react-native-testing-library no está instalado en este proyecto; se usa
// react-test-renderer directamente (ya disponible como dependencia transitiva
// de jest-expo). El render inicial de un árbol RN completo es lento la primera
// vez que se transforma cada módulo nativo mockeado.
jest.setTimeout(30000);

jest.mock('../lib/queries/tracking', () => ({
  getMiAsignacion: jest.fn(),
}));

jest.mock('../lib/queries/llegada', () => ({
  confirmarRecepcionKit: jest.fn(),
  registrarLlegadaRecinto: jest.fn(),
  subirFotoMilitar: jest.fn(),
  validarKit: jest.fn(),
}));

jest.mock('../lib/location', () => {
  class LocationPermissionDeniedError extends Error {}
  class LocationServicesDisabledError extends Error {}
  return {
    LocationPermissionDeniedError,
    LocationServicesDisabledError,
    obtenerUbicacionPuntual: jest.fn(),
    detenerRastreo: jest.fn(),
  };
});

jest.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { nombres: 'Ana', apellidos: 'Perez' }, logout: jest.fn() }),
}));

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));

jest.mock('../components/AppBar', () => ({ AppBar: () => null }));
jest.mock('../components/CameraFoto', () => ({ CameraFoto: () => null }));
jest.mock('../components/CameraQr', () => ({ CameraQr: () => null }));

import { LlegadaRecintoScreen } from './LlegadaRecintoScreen';
import { getMiAsignacion } from '../lib/queries/tracking';
import { registrarLlegadaRecinto } from '../lib/queries/llegada';
import { obtenerUbicacionPuntual, detenerRastreo } from '../lib/location';

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

/** Sube por el árbol desde un nodo (p.ej. el Text de un botón) hasta el <Pressable> que lo contiene. */
function pressableAncestor(instance: TestInstance): TestInstance {
  let node: TestInstance | null = instance;
  while (node && node.type !== Pressable) node = node.parent;
  if (!node) throw new Error('No se encontró un <Pressable> ancestro');
  return node;
}

// fotoMilitarUrl presente + todos los kits recibidos hace que la pantalla
// entre directo al paso 3 ("Confirmar"), que es el que nos interesa probar.
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
  militar: { id: 'm1', nombres: 'Juan', apellidos: 'Perez', cedula: '1234567890' },
  kits: [{ id: 'k1', codigoUnico: 'K001', nombre: 'Kit 1', contenidos: null, recibido: true }],
  yaRegistroSalida: true,
  yaRegistroLlegada: false,
  yaRegistroSalidaRecinto: true,
  yaRegistroLlegadaDpi: false,
  fotoMilitarUrl: 'https://storage.example.com/foto.jpg',
  margenLlegadaMetros: 100,
};

describe('LlegadaRecintoScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getMiAsignacion as jest.Mock).mockResolvedValue(asignacionFixture);
    (obtenerUbicacionPuntual as jest.Mock).mockResolvedValue({ latitud: 1, longitud: 2, precisionMetros: 5 });
    (registrarLlegadaRecinto as jest.Mock).mockResolvedValue({ id: 'llegada-1' });
  });

  it('tras registrar la llegada exitosamente, detiene el rastreo GPS', async () => {
    const onLlegadaRegistrada = jest.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<LlegadaRecintoScreen onLlegadaRegistrada={onLlegadaRegistrada} />);
      await flushPromises();
    });

    const boton = renderer.root.findByProps({ children: 'Confirmar Llegada al Recinto' });
    await act(async () => {
      pressableAncestor(boton).props.onPress();
      await flushPromises();
    });

    expect(registrarLlegadaRecinto).toHaveBeenCalledTimes(1);
    expect(detenerRastreo).toHaveBeenCalledTimes(1);
    expect(onLlegadaRegistrada).toHaveBeenCalledTimes(1);
  });
});
