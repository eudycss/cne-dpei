jest.mock('../lib/queries/incidencias', () => ({
  misIncidencias: jest.fn(),
  reportarIncidencia: jest.fn(),
}));
jest.mock('../lib/location', () => ({ obtenerUbicacionPuntual: jest.fn() }));
jest.mock('../lib/comprimir-foto', () => ({ comprimirFoto: jest.fn() }));
// La cámara se reemplaza por un componente que expone su onCapture a la prueba.
let mockCapturar: ((uri: string, base64?: string) => void) | null = null;
jest.mock('./CameraFoto', () => ({
  CameraFoto: ({ onCapture }: { onCapture: (uri: string, base64?: string) => void }) => {
    mockCapturar = onCapture;
    return null;
  },
}));
jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));

import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Pressable, Text } from 'react-native';
import { mensajeErrorIncidencia, ReportarIncidenciaModal } from './ReportarIncidenciaModal';
import { misIncidencias, reportarIncidencia } from '../lib/queries/incidencias';
import { obtenerUbicacionPuntual } from '../lib/location';
import { comprimirFoto } from '../lib/comprimir-foto';

const misIncidenciasMock = misIncidencias as jest.Mock;
const reportarMock = reportarIncidencia as jest.Mock;
const ubicacionMock = obtenerUbicacionPuntual as jest.Mock;
const comprimirMock = comprimirFoto as jest.Mock;

describe('mensajeErrorIncidencia', () => {
  it('traduce el 413 del servidor (foto demasiado grande) al español', () => {
    const msg = mensajeErrorIncidencia({
      response: { status: 413, data: { message: 'request entity too large' } },
    });
    expect(msg).toBe('La foto es demasiado grande para enviarla. Toma otra foto e intenta de nuevo.');
  });

  it('usa el mensaje del servidor en otros errores', () => {
    const msg = mensajeErrorIncidencia({
      response: { status: 404, data: { message: 'No hay un evento electoral activo' } },
    });
    expect(msg).toBe('No hay un evento electoral activo');
  });

  it('usa un mensaje genérico si no hay respuesta', () => {
    expect(mensajeErrorIncidencia(new Error('Network Error'))).toBe(
      'No se pudo reportar la incidencia. Intenta de nuevo.',
    );
  });
});

describe('ReportarIncidenciaModal — foto comprimida', () => {
  let tree: ReactTestRenderer;

  const textos = () =>
    tree.root
      .findAllByType(Text)
      .map((t) => [t.props.children].flat().join(''))
      .join(' | ');
  const boton = (texto: string) =>
    tree.root.findAllByType(Pressable).find((p) => p.findAllByType(Text).some((t) => t.props.children === texto))!;
  const botonGuardar = () =>
    tree.root.findAllByType(Pressable).find((p) => p.props.accessibilityRole === 'button')!;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCapturar = null;
    misIncidenciasMock.mockResolvedValue({ items: [] });
    ubicacionMock.mockRejectedValue(new Error('sin gps'));
    reportarMock.mockResolvedValue({ id: 'i1' });
    await act(async () => {
      tree = create(<ReportarIncidenciaModal visible onClose={jest.fn()} />);
    });
    await act(async () => boton('Kit dañado').props.onPress());
    await act(async () => boton('Agregar foto').props.onPress());
  });

  it('envía la versión comprimida de la foto', async () => {
    comprimirMock.mockResolvedValue({ uri: 'file:///chica.jpg', base64: 'CHICA' });

    await act(async () => mockCapturar!('file:///grande.jpg', 'GRANDE'));

    expect(comprimirMock).toHaveBeenCalledWith('file:///grande.jpg');
    expect(textos()).toContain('Foto adjuntada.');
    await act(async () => botonGuardar().props.onPress());
    expect(reportarMock).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'KIT_DANADO', fotoBase64: 'CHICA' }));
  });

  it('si la compresión falla envía la foto original', async () => {
    comprimirMock.mockResolvedValue(null);

    await act(async () => mockCapturar!('file:///grande.jpg', 'GRANDE'));
    await act(async () => botonGuardar().props.onPress());

    expect(reportarMock).toHaveBeenCalledWith(expect.objectContaining({ fotoBase64: 'GRANDE' }));
  });

  it('mientras prepara la foto avisa y no deja guardar', async () => {
    let terminar!: (v: { uri: string; base64: string }) => void;
    comprimirMock.mockReturnValue(new Promise((r) => (terminar = r)));

    await act(async () => {
      mockCapturar!('file:///grande.jpg', 'GRANDE');
    });

    expect(textos()).toContain('Preparando foto…');
    expect(botonGuardar().props.disabled).toBe(true);
    expect(botonGuardar().props.accessibilityState).toEqual({ disabled: true, busy: true });

    await act(async () => terminar({ uri: 'file:///chica.jpg', base64: 'CHICA' }));
    expect(botonGuardar().props.disabled).toBe(false);
  });
});
