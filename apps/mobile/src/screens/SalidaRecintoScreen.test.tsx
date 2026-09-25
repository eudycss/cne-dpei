import { act, create, ReactTestRenderer, TestInstance } from 'react-test-renderer';
import { Alert, Pressable } from 'react-native';
import type { MiAsignacionResponse } from '@cne/shared-types';

// react-native-testing-library no está instalado en este proyecto; se usa
// react-test-renderer directamente (mismo patrón que LlegadaRecintoScreen.test.tsx).
jest.setTimeout(30000);

jest.mock('../lib/queries/tracking', () => ({
  getMiAsignacion: jest.fn(),
}));

jest.mock('../lib/queries/retorno', () => ({
  postSalidaRecinto: jest.fn(),
}));

jest.mock('../lib/offline-actas', () => ({
  restaurarActas: jest.fn(),
  capturarYSubirActa: jest.fn(),
  reintentarSubidaActa: jest.fn(),
  limpiarActas: jest.fn(),
}));

jest.mock('../lib/location', () => {
  class LocationPermissionDeniedError extends Error {}
  class LocationServicesDisabledError extends Error {}
  return {
    LocationPermissionDeniedError,
    LocationServicesDisabledError,
    asegurarServiciosUbicacion: jest.fn(),
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
jest.mock('../components/CameraFoto', () => ({ CameraFoto: () => null }));

import { SalidaRecintoScreen } from './SalidaRecintoScreen';
import { getMiAsignacion } from '../lib/queries/tracking';
import { postSalidaRecinto } from '../lib/queries/retorno';
import {
  restaurarActas,
  capturarYSubirActa,
  reintentarSubidaActa,
  limpiarActas,
} from '../lib/offline-actas';
import { asegurarServiciosUbicacion, obtenerUbicacionPuntual } from '../lib/location';
import { CameraFoto } from '../components/CameraFoto';

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

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
  kits: [{ id: 'k1', codigoUnico: 'K001', nombre: 'Kit 1', contenidos: null, items: [], recibido: true }],
  yaRegistroSalida: true,
  yaRegistroLlegada: true,
  yaRegistroSalidaRecinto: false,
  yaRegistroLlegadaDpi: false,
  fotoMilitarUrl: null,
  margenLlegadaMetros: 100,
  delegacion: null,
  margenLlegadaDpiMetros: 150,
};

// Solo hay un <CameraFoto> compartido en el árbol (un solo Modal); qué acta
// recibe la foto la decide el estado `mostrarCamara`, fijado al presionar el
// botón "Tomar foto" de la tarjeta correspondiente. Se ubica la tarjeta por su
// título en vez de por índice, porque la etiqueta del botón cambia según el
// estado (Tomar foto / Reintentar subida / Reemplazar foto).
function cardPorTitulo(renderer: ReactTestRenderer, titulo: string): TestInstance {
  const tituloText = renderer.root.findByProps({ children: titulo });
  const card = tituloText.parent;
  if (!card) throw new Error(`No se encontró la tarjeta "${titulo}"`);
  return card;
}

async function tomarFoto(renderer: ReactTestRenderer, titulo: string, uri: string) {
  const card = cardPorTitulo(renderer, titulo);
  const boton = pressableAncestor(card.findByProps({ children: 'Tomar foto' }));
  await act(async () => {
    boton.props.onPress();
  });
  const camara = renderer.root.findByType(CameraFoto);
  await act(async () => {
    camara.props.onCapture(uri);
    await flushPromises();
  });
}

async function reintentarActa(renderer: ReactTestRenderer, titulo: string) {
  const card = cardPorTitulo(renderer, titulo);
  const boton = pressableAncestor(card.findByProps({ children: 'Reintentar subida' }));
  await act(async () => {
    boton.props.onPress();
    await flushPromises();
  });
}

describe('SalidaRecintoScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getMiAsignacion as jest.Mock).mockResolvedValue(asignacionFixture);
    (obtenerUbicacionPuntual as jest.Mock).mockResolvedValue({ latitud: 1, longitud: 2 });
    (postSalidaRecinto as jest.Mock).mockResolvedValue({ id: 'salida-1' });
    (restaurarActas as jest.Mock).mockResolvedValue({}); // sin actas pendientes de una sesión anterior
    (limpiarActas as jest.Mock).mockResolvedValue(undefined);
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const target = (buttons ?? []).find((b) => b.text !== 'Cancelar');
      target?.onPress?.();
    });
  });

  it('el botón "Continuar" está deshabilitado hasta subir ambas actas', async () => {
    (capturarYSubirActa as jest.Mock).mockImplementation((tipo: string, uri: string) =>
      Promise.resolve({ uri, url: `actas/${tipo}.bin`, error: null }),
    );
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<SalidaRecintoScreen onSalidaRegistrada={jest.fn()} />);
      await flushPromises();
    });

    let continuar = pressableAncestor(renderer.root.findByProps({ children: 'Continuar' }));
    expect(continuar.props.disabled).toBe(true);

    await tomarFoto(renderer, 'Acta de instalación', 'file://instalacion.jpg');
    continuar = pressableAncestor(renderer.root.findByProps({ children: 'Continuar' }));
    expect(continuar.props.disabled).toBe(true); // falta la de escrutinio

    await tomarFoto(renderer, 'Acta de escrutinio', 'file://escrutinio.jpg');
    continuar = pressableAncestor(renderer.root.findByProps({ children: 'Continuar' }));
    expect(continuar.props.disabled).toBe(false);
    expect(capturarYSubirActa).toHaveBeenCalledTimes(2);
    // La persistencia se namespacea por recinto+evento (eventoId_recintoId de
    // la asignación activa) para no reusar por error actas de otro CDA.
    expect(capturarYSubirActa).toHaveBeenCalledWith('ev1_r1', 'instalacion', 'file://instalacion.jpg');
    expect(capturarYSubirActa).toHaveBeenCalledWith('ev1_r1', 'escrutinio', 'file://escrutinio.jpg');
  });

  it('si falla la subida muestra "Reintentar subida" y el reintento manual funciona', async () => {
    (capturarYSubirActa as jest.Mock).mockResolvedValueOnce({
      uri: 'file://instalacion.jpg',
      url: null,
      error: 'Sin conexión',
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<SalidaRecintoScreen onSalidaRegistrada={jest.fn()} />);
      await flushPromises();
    });

    await tomarFoto(renderer, 'Acta de instalación', 'file://instalacion.jpg');

    expect(renderer.root.findByProps({ children: 'Sin conexión' })).toBeTruthy();

    (reintentarSubidaActa as jest.Mock).mockResolvedValueOnce({
      uri: 'file://instalacion.jpg',
      url: 'actas/instalacion.bin',
      error: null,
    });
    await reintentarActa(renderer, 'Acta de instalación');

    expect(renderer.root.findByProps({ children: 'Foto guardada de forma segura' })).toBeTruthy();
  });

  it('al confirmar la salida, envía las URLs de ambas actas al backend y limpia la cola local', async () => {
    (capturarYSubirActa as jest.Mock)
      .mockResolvedValueOnce({ uri: 'file://instalacion.jpg', url: 'actas/instalacion.bin', error: null })
      .mockResolvedValueOnce({ uri: 'file://escrutinio.jpg', url: 'actas/escrutinio.bin', error: null });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<SalidaRecintoScreen onSalidaRegistrada={jest.fn()} />);
      await flushPromises();
    });

    await tomarFoto(renderer, 'Acta de instalación', 'file://instalacion.jpg');
    await tomarFoto(renderer, 'Acta de escrutinio', 'file://escrutinio.jpg');

    await act(async () => {
      pressableAncestor(renderer.root.findByProps({ children: 'Continuar' })).props.onPress();
      await flushPromises();
    });

    // Paso 2: marcar el único kit y confirmar.
    const kitRow = pressableAncestor(renderer.root.findByProps({ children: 'K001' }));
    await act(async () => {
      kitRow.props.onPress();
      await flushPromises();
    });

    const boton = renderer.root.findByProps({ children: 'Registrar Salida de Recinto Electoral' });
    await act(async () => {
      pressableAncestor(boton).props.onPress(); // el mock de Alert.alert ya dispara "Registrar Salida"
      await flushPromises();
    });

    expect(asegurarServiciosUbicacion).toHaveBeenCalledTimes(1);
    expect(postSalidaRecinto).toHaveBeenCalledWith(
      expect.objectContaining({
        actaInstalacionUrl: 'actas/instalacion.bin',
        actaEscrutinioUrl: 'actas/escrutinio.bin',
      }),
    );
    expect(limpiarActas).toHaveBeenCalledTimes(1);
    expect(limpiarActas).toHaveBeenCalledWith('ev1_r1');
  });

  it('al montar, restaura las actas persistidas con el contextoId correcto (recinto+evento activo)', async () => {
    (restaurarActas as jest.Mock).mockResolvedValue({
      instalacion: { uri: 'file:///persistente/instalacion.jpg', url: 'actas/instalacion.bin' },
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<SalidaRecintoScreen onSalidaRegistrada={jest.fn()} />);
      await flushPromises();
    });

    expect(restaurarActas).toHaveBeenCalledWith('ev1_r1');
    // Instalación ya venía con url confirmada de una sesión anterior; no debió reintentar su subida.
    expect(reintentarSubidaActa).not.toHaveBeenCalledWith('ev1_r1', 'instalacion');
    expect(renderer.root.findByProps({ children: 'Foto guardada de forma segura' })).toBeTruthy();
    // Sigue deshabilitado porque falta la de escrutinio.
    const continuar = pressableAncestor(renderer.root.findByProps({ children: 'Continuar' }));
    expect(continuar.props.disabled).toBe(true);
  });
});
