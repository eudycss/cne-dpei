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
}));

jest.mock('../lib/queries/llegada', () => {
  class KitNoEnAsignacionError extends Error {}
  return {
    KitNoEnAsignacionError,
    confirmarRecepcionKit: jest.fn(),
    registrarLlegadaRecinto: jest.fn(),
    validarKitConRespaldo: jest.fn(),
  };
});

jest.mock('../lib/offline-foto-militar', () => {
  const PREFIJO = 'pendiente:foto-militar:';
  class FotoMilitarPerdidaError extends Error {}
  return {
    FotoMilitarPerdidaError,
    guardarYSubirFotoMilitar: jest.fn(),
    restaurarFotoMilitar: jest.fn(),
    esMarcadorFotoPendiente: (v: unknown) => typeof v === 'string' && v.startsWith(PREFIJO),
  };
});

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
jest.mock('../components/CameraFoto', () => ({ CameraFoto: function CameraFoto() { return null; } }));
jest.mock('../components/CameraQr', () => ({ CameraQr: function CameraQr() { return null; } }));

import { LlegadaRecintoScreen } from './LlegadaRecintoScreen';
import { getMiAsignacion } from '../lib/queries/tracking';
import {
  confirmarRecepcionKit,
  KitNoEnAsignacionError,
  registrarLlegadaRecinto,
  validarKitConRespaldo,
} from '../lib/queries/llegada';
import {
  FotoMilitarPerdidaError,
  guardarYSubirFotoMilitar,
  restaurarFotoMilitar,
} from '../lib/offline-foto-militar';
import { CameraFoto } from '../components/CameraFoto';
import { CameraQr } from '../components/CameraQr';
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
  kits: [{ id: 'k1', codigoUnico: 'K001', nombre: 'Kit 1', contenidos: null, items: [], recibido: true }],
  yaRegistroSalida: true,
  yaRegistroLlegada: false,
  yaRegistroPruebaConexion: false,
  yaRegistroSalidaRecinto: true,
  yaRegistroLlegadaDpi: false,
  fotoMilitarUrl: 'https://storage.example.com/foto.jpg',
  margenLlegadaMetros: 100,
  delegacion: null,
  margenLlegadaDpiMetros: 150,
};

describe('LlegadaRecintoScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getMiAsignacion as jest.Mock).mockResolvedValue(asignacionFixture);
    (obtenerUbicacionPuntual as jest.Mock).mockResolvedValue({ latitud: 1, longitud: 2, precisionMetros: 5 });
    (registrarLlegadaRecinto as jest.Mock).mockResolvedValue({ id: 'llegada-1' });
    (restaurarFotoMilitar as jest.Mock).mockResolvedValue(null);
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  async function montar() {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<LlegadaRecintoScreen onLlegadaRegistrada={jest.fn()} />);
      await flushPromises();
    });
    return renderer;
  }

  async function presionar(renderer: ReactTestRenderer, texto: string) {
    await act(async () => {
      pressableAncestor(renderer.root.findByProps({ children: texto })).props.onPress();
      await flushPromises();
    });
  }

  const sinFotoNiKits: MiAsignacionResponse = {
    ...asignacionFixture,
    fotoMilitarUrl: null,
    kits: [{ id: 'k1', codigoUnico: 'K001', nombre: 'Kit 1', contenidos: null, items: [], recibido: false }],
  };

  it('sin señal, la foto del militar queda guardada en el celular y deja seguir con los kits', async () => {
    (getMiAsignacion as jest.Mock).mockResolvedValue(sinFotoNiKits);
    (guardarYSubirFotoMilitar as jest.Mock).mockResolvedValue({
      fotoUrl: 'pendiente:foto-militar:ev1_r1',
      pendiente: true,
    });
    const renderer = await montar();

    await presionar(renderer, 'Tomar foto del militar');
    await act(async () => {
      renderer.root.findByType(CameraFoto).props.onCapture('file:///cache/foto.jpg');
      await flushPromises();
    });

    expect(guardarYSubirFotoMilitar).toHaveBeenCalledWith('ev1_r1', 'file:///cache/foto.jpg');
    expect(Alert.alert).toHaveBeenCalledWith('Sin señal', expect.stringContaining('guardada en el celular'));
    expect(renderer.root.findAllByProps({ children: 'Escanear Kit Electoral' }).length).toBeGreaterThan(0);
  });

  it('al reabrir sin señal restaura la foto pendiente y no la vuelve a pedir', async () => {
    (getMiAsignacion as jest.Mock).mockResolvedValue(sinFotoNiKits);
    (restaurarFotoMilitar as jest.Mock).mockResolvedValue('pendiente:foto-militar:ev1_r1');

    const renderer = await montar();

    expect(restaurarFotoMilitar).toHaveBeenCalledWith('ev1_r1');
    expect(renderer.root.findAllByProps({ children: 'Escanear Kit Electoral' }).length).toBeGreaterThan(0);
  });

  it('confirma el kit validado sin señal usando el marcador de la foto pendiente', async () => {
    (getMiAsignacion as jest.Mock).mockResolvedValue(sinFotoNiKits);
    (restaurarFotoMilitar as jest.Mock).mockResolvedValue('pendiente:foto-militar:ev1_r1');
    (validarKitConRespaldo as jest.Mock).mockResolvedValue({
      kit: { id: 'k1', codigoUnico: 'K001', nombre: 'Kit 1', contenidos: null, items: [], yaRecibido: false },
      sinSenal: true,
    });
    (confirmarRecepcionKit as jest.Mock).mockResolvedValue(null);
    const renderer = await montar();

    await presionar(renderer, 'Escanear Kit Electoral');
    await act(async () => {
      renderer.root.findByType(CameraQr).props.onScan('K001');
      await flushPromises();
    });
    expect(
      renderer.root.findAllByProps({
        children: 'Validado sin conexión con tu lista de kits. El servidor lo confirmará al recuperar señal.',
      }).length,
    ).toBeGreaterThan(0);
    await presionar(renderer, 'Confirmar Recepción de Kit Electoral');

    expect(validarKitConRespaldo).toHaveBeenCalledWith('K001', sinFotoNiKits.kits);
    expect(confirmarRecepcionKit).toHaveBeenCalledWith(
      expect.objectContaining({ kitId: 'k1', fotoMilitarUrl: 'pendiente:foto-militar:ev1_r1' }),
    );
    expect(renderer.root.findAllByProps({ children: 'Confirmar Llegada al Recinto' }).length).toBeGreaterThan(0);
  });

  it('si la foto guardada se perdió al confirmar un kit, vuelve al paso 1 para tomarla de nuevo', async () => {
    (getMiAsignacion as jest.Mock).mockResolvedValue(sinFotoNiKits);
    (restaurarFotoMilitar as jest.Mock).mockResolvedValue('pendiente:foto-militar:ev1_r1');
    (validarKitConRespaldo as jest.Mock).mockResolvedValue({
      kit: { id: 'k1', codigoUnico: 'K001', nombre: 'Kit 1', contenidos: null, items: [], yaRecibido: false },
      sinSenal: false,
    });
    (confirmarRecepcionKit as jest.Mock).mockRejectedValue(
      Object.assign(new FotoMilitarPerdidaError(), { message: 'La foto ya no existe.' }),
    );
    const renderer = await montar();

    await presionar(renderer, 'Escanear Kit Electoral');
    await act(async () => {
      renderer.root.findByType(CameraQr).props.onScan('K001');
      await flushPromises();
    });
    await presionar(renderer, 'Confirmar Recepción de Kit Electoral');

    expect(Alert.alert).toHaveBeenCalledWith('Vuelve a tomar la foto', 'La foto ya no existe.');
    expect(renderer.root.findAllByProps({ children: 'Tomar foto del militar' }).length).toBeGreaterThan(0);
  });

  it('sin señal avisa si el código no está en la lista de kits', async () => {
    (getMiAsignacion as jest.Mock).mockResolvedValue({ ...sinFotoNiKits, fotoMilitarUrl: 'militares/abc.bin' });
    (validarKitConRespaldo as jest.Mock).mockRejectedValue(Object.assign(new KitNoEnAsignacionError(), { message: 'no está en tu lista' }));
    const renderer = await montar();

    await presionar(renderer, 'Escanear Kit Electoral');
    await act(async () => {
      renderer.root.findByType(CameraQr).props.onScan('OTRO');
      await flushPromises();
    });

    expect(Alert.alert).toHaveBeenCalledWith('Kit no encontrado', 'no está en tu lista');
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

  it('si registrarLlegadaRecinto devuelve null (sin señal), avisa y detiene el rastreo igual', async () => {
    (registrarLlegadaRecinto as jest.Mock).mockResolvedValue(null);
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

    expect(Alert.alert).toHaveBeenCalledWith('Sin señal', expect.stringContaining('sincronizará'));
    expect(detenerRastreo).toHaveBeenCalledTimes(1);
    expect(onLlegadaRegistrada).toHaveBeenCalledTimes(1);
  });
});
