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

import { EnTransitoScreen } from './EnTransitoScreen';
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
    latitud: -0.35,
    longitud: -78.12,
  },
  noCdas: [],
  militar: null,
  kits: [],
  yaRegistroSalida: true,
  yaRegistroLlegada: false,
  yaRegistroSalidaRecinto: false,
  yaRegistroLlegadaDpi: false,
  fotoMilitarUrl: null,
  margenLlegadaMetros: 100,
  delegacion: null,
  margenLlegadaDpiMetros: 150,
};

describe('EnTransitoScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getMiAsignacion as jest.Mock).mockResolvedValue(asignacionFixture);
  });

  it('arranca el rastreo GPS en primer plano al montar', async () => {
    const remove = jest.fn();
    (iniciarRastreoPrimerPlano as jest.Mock).mockResolvedValue({ remove });
    (obtenerUbicacionPuntual as jest.Mock).mockResolvedValue({ latitud: -0.35, longitud: -78.12, precisionMetros: 5 });

    await act(async () => {
      create(<EnTransitoScreen onMarcarLlegada={jest.fn()} />);
      await flushPromises();
    });

    expect(iniciarRastreoPrimerPlano).toHaveBeenCalledTimes(1);
  });

  it('limpia la suscripción de rastreo al desmontar', async () => {
    const remove = jest.fn();
    (iniciarRastreoPrimerPlano as jest.Mock).mockResolvedValue({ remove });
    (obtenerUbicacionPuntual as jest.Mock).mockResolvedValue({ latitud: -0.35, longitud: -78.12, precisionMetros: 5 });

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
    (obtenerUbicacionPuntual as jest.Mock).mockResolvedValue({ latitud: -0.35, longitud: -78.12, precisionMetros: 5 });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<EnTransitoScreen onMarcarLlegada={jest.fn()} />);
      await flushPromises();
    });

    expect(() => renderer.unmount()).not.toThrow();
  });

  it('deshabilita "Ya estoy en el recinto" cuando la ubicación está lejos del recinto', async () => {
    (iniciarRastreoPrimerPlano as jest.Mock).mockResolvedValue({ remove: jest.fn() });
    // Punto lejos de -0.35/-78.12 (recinto fixture) — fuera del margen de 100m.
    (obtenerUbicacionPuntual as jest.Mock).mockResolvedValue({ latitud: -0.40, longitud: -78.20, precisionMetros: 5 });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<EnTransitoScreen onMarcarLlegada={jest.fn()} />);
      await flushPromises();
    });

    const boton = pressableAncestor(renderer.root.findByProps({ children: 'Ya estoy en el recinto' }));
    expect(boton.props.disabled).toBe(true);
  });

  it('habilita "Ya estoy en el recinto" y lo dispara al confirmar cercanía', async () => {
    (iniciarRastreoPrimerPlano as jest.Mock).mockResolvedValue({ remove: jest.fn() });
    // Mismo punto que el recinto fixture — dentro del margen.
    (obtenerUbicacionPuntual as jest.Mock).mockResolvedValue({ latitud: -0.35, longitud: -78.12, precisionMetros: 5 });

    const onMarcarLlegada = jest.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<EnTransitoScreen onMarcarLlegada={onMarcarLlegada} />);
      await flushPromises();
    });

    const boton = pressableAncestor(renderer.root.findByProps({ children: 'Ya estoy en el recinto' }));
    expect(boton.props.disabled).toBe(false);

    await act(async () => {
      boton.props.onPress();
      await flushPromises();
    });

    expect(onMarcarLlegada).toHaveBeenCalledTimes(1);
  });

  it('no bloquea el botón si no se pudo verificar la ubicación (sin permiso de GPS)', async () => {
    (iniciarRastreoPrimerPlano as jest.Mock).mockResolvedValue({ remove: jest.fn() });
    (obtenerUbicacionPuntual as jest.Mock).mockRejectedValue(new LocationPermissionDeniedError());

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<EnTransitoScreen onMarcarLlegada={jest.fn()} />);
      await flushPromises();
    });

    const boton = pressableAncestor(renderer.root.findByProps({ children: 'Ya estoy en el recinto' }));
    expect(boton.props.disabled).toBe(false);
  });

  it('no bloquea el botón si el recinto todavía no tiene coordenadas configuradas', async () => {
    (iniciarRastreoPrimerPlano as jest.Mock).mockResolvedValue({ remove: jest.fn() });
    (getMiAsignacion as jest.Mock).mockResolvedValue({
      ...asignacionFixture,
      recinto: { ...asignacionFixture.recinto, latitud: null, longitud: null },
    });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<EnTransitoScreen onMarcarLlegada={jest.fn()} />);
      await flushPromises();
    });

    const boton = pressableAncestor(renderer.root.findByProps({ children: 'Ya estoy en el recinto' }));
    expect(boton.props.disabled).toBe(false);
    expect(obtenerUbicacionPuntual).not.toHaveBeenCalled();
  });

  it('muestra un aviso discreto (no bloqueante) cuando getMiAsignacion falla por red', async () => {
    (iniciarRastreoPrimerPlano as jest.Mock).mockResolvedValue({ remove: jest.fn() });
    (getMiAsignacion as jest.Mock).mockRejectedValue({ isAxiosError: true, response: undefined });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<EnTransitoScreen onMarcarLlegada={jest.fn()} />);
      await flushPromises();
    });

    expect(renderer.root.findByProps({ children: 'Sin conexión, reintentando…' })).toBeTruthy();
    const boton = pressableAncestor(renderer.root.findByProps({ children: 'Ya estoy en el recinto' }));
    expect(boton.props.disabled).toBe(false);
  });

  it('no muestra el aviso de sin conexión cuando la falla de getMiAsignacion no es por red', async () => {
    (iniciarRastreoPrimerPlano as jest.Mock).mockResolvedValue({ remove: jest.fn() });
    (getMiAsignacion as jest.Mock).mockRejectedValue({ isAxiosError: true, response: { status: 500 } });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<EnTransitoScreen onMarcarLlegada={jest.fn()} />);
      await flushPromises();
    });

    expect(renderer.root.findAllByProps({ children: 'Sin conexión, reintentando…' })).toHaveLength(0);
  });
});
