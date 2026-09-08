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

jest.mock('../lib/location', () => {
  class LocationPermissionDeniedError extends Error {}
  class LocationServicesDisabledError extends Error {}
  return {
    LocationPermissionDeniedError,
    LocationServicesDisabledError,
    iniciarRastreoPrimerPlano: jest.fn(),
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

import { EnRetornoScreen } from './EnRetornoScreen';
import { getMiAsignacion } from '../lib/queries/tracking';
import {
  iniciarRastreoPrimerPlano,
  obtenerUbicacionPuntual,
  LocationPermissionDeniedError,
} from '../lib/location';

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

/** Sube por el árbol desde un nodo (p.ej. el Text de un botón) hasta el <Pressable> que lo contiene. */
function pressableAncestor(instance: TestInstance): TestInstance {
  let node: TestInstance | null = instance;
  while (node && node.type !== Pressable) node = node.parent;
  if (!node) throw new Error('No se encontró un <Pressable> ancestro');
  return node;
}

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
  kits: [],
  yaRegistroSalida: true,
  yaRegistroLlegada: true,
  yaRegistroSalidaRecinto: true,
  yaRegistroLlegadaDpi: false,
  fotoMilitarUrl: null,
  margenLlegadaMetros: 100,
  delegacion: { latitud: 0.35849, longitud: -78.11886 },
  margenLlegadaDpiMetros: 150,
};

describe('EnRetornoScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getMiAsignacion as jest.Mock).mockResolvedValue(asignacionFixture);
  });

  it('arranca el rastreo GPS en primer plano al montar', async () => {
    (iniciarRastreoPrimerPlano as jest.Mock).mockResolvedValue({ remove: jest.fn() });
    (obtenerUbicacionPuntual as jest.Mock).mockResolvedValue({ latitud: 0.35849, longitud: -78.11886, precisionMetros: 5 });

    await act(async () => {
      create(<EnRetornoScreen onMarcarLlegada={jest.fn()} />);
      await flushPromises();
    });

    expect(iniciarRastreoPrimerPlano).toHaveBeenCalledTimes(1);
  });

  it('limpia la suscripción de rastreo al desmontar', async () => {
    const remove = jest.fn();
    (iniciarRastreoPrimerPlano as jest.Mock).mockResolvedValue({ remove });
    (obtenerUbicacionPuntual as jest.Mock).mockResolvedValue({ latitud: 0.35849, longitud: -78.11886, precisionMetros: 5 });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<EnRetornoScreen onMarcarLlegada={jest.fn()} />);
      await flushPromises();
    });

    await act(async () => {
      renderer.unmount();
    });

    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('deshabilita "Ya llegué al DPI" cuando la ubicación está lejos de la Delegación', async () => {
    (iniciarRastreoPrimerPlano as jest.Mock).mockResolvedValue({ remove: jest.fn() });
    // Punto lejos de la delegación fixture — fuera del margen de 150m.
    (obtenerUbicacionPuntual as jest.Mock).mockResolvedValue({ latitud: 0.40, longitud: -78.20, precisionMetros: 5 });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<EnRetornoScreen onMarcarLlegada={jest.fn()} />);
      await flushPromises();
    });

    const boton = pressableAncestor(renderer.root.findByProps({ children: 'Ya llegué al DPI' }));
    expect(boton.props.disabled).toBe(true);
  });

  it('habilita "Ya llegué al DPI" y lo dispara al confirmar cercanía', async () => {
    (iniciarRastreoPrimerPlano as jest.Mock).mockResolvedValue({ remove: jest.fn() });
    // Mismo punto que la delegación fixture — dentro del margen.
    (obtenerUbicacionPuntual as jest.Mock).mockResolvedValue({ latitud: 0.35849, longitud: -78.11886, precisionMetros: 5 });

    const onMarcarLlegada = jest.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<EnRetornoScreen onMarcarLlegada={onMarcarLlegada} />);
      await flushPromises();
    });

    const boton = pressableAncestor(renderer.root.findByProps({ children: 'Ya llegué al DPI' }));
    expect(boton.props.disabled).toBe(false);

    await act(async () => {
      boton.props.onPress();
      await flushPromises();
    });

    expect(onMarcarLlegada).toHaveBeenCalledTimes(1);
  });

  it('no bloquea el botón cuando la Delegación todavía no tiene coordenada configurada', async () => {
    (iniciarRastreoPrimerPlano as jest.Mock).mockResolvedValue({ remove: jest.fn() });
    (getMiAsignacion as jest.Mock).mockResolvedValue({ ...asignacionFixture, delegacion: null });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<EnRetornoScreen onMarcarLlegada={jest.fn()} />);
      await flushPromises();
    });

    const boton = pressableAncestor(renderer.root.findByProps({ children: 'Ya llegué al DPI' }));
    expect(boton.props.disabled).toBe(false);
    expect(obtenerUbicacionPuntual).not.toHaveBeenCalled();
  });

  it('no bloquea el botón si no se pudo verificar la ubicación (sin permiso de GPS)', async () => {
    (iniciarRastreoPrimerPlano as jest.Mock).mockResolvedValue({ remove: jest.fn() });
    (obtenerUbicacionPuntual as jest.Mock).mockRejectedValue(new LocationPermissionDeniedError());

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<EnRetornoScreen onMarcarLlegada={jest.fn()} />);
      await flushPromises();
    });

    const boton = pressableAncestor(renderer.root.findByProps({ children: 'Ya llegué al DPI' }));
    expect(boton.props.disabled).toBe(false);
  });
});
