import { act, create, ReactTestRenderer, TestInstance } from 'react-test-renderer';
import { AccessibilityInfo, Alert, Pressable, Text, TextInput } from 'react-native';
import type { KitCustodiaResponse, MilitarResumen } from '@cne/shared-types';

jest.setTimeout(30000);

jest.mock('../lib/queries/custodia', () => ({
  validarKitCustodia: jest.fn(),
  registrarEntrega: jest.fn(),
  corregirMilitar: jest.fn(),
  cambiarOperador: jest.fn(),
  buscarMilitares: jest.fn().mockResolvedValue([]),
  buscarOperadores: jest.fn().mockResolvedValue([]),
}));
jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));
jest.mock('../components/AppBar', () => ({ AppBar: () => null }));
jest.mock('../components/CameraQr', () => ({ CameraQr: () => null }));

import { EntregaMilitarScreen } from './EntregaMilitarScreen';
import {
  cambiarOperador,
  corregirMilitar,
  registrarEntrega,
  validarKitCustodia,
} from '../lib/queries/custodia';

const flush = () => new Promise((r) => setImmediate(r));

const recintoId = 'rec-1';
const militar: MilitarResumen = {
  id: 'mil-1',
  cedula: '1002003004',
  nombres: 'Juan',
  apellidos: 'Paz',
  recintoId,
  recintoNombre: 'Escuela Central',
};

function kit(overrides: Partial<KitCustodiaResponse> = {}): KitCustodiaResponse {
  return {
    kitId: 'kit-1',
    codigoUnico: 'ABCD2345',
    nombre: '28 — Escuela Central',
    estado: 'ASIGNADO',
    recinto: { id: recintoId, codigo: '28', nombre: 'Escuela Central' },
    operador: { id: 'op-1', cedula: '1', nombres: 'Ana', apellidos: 'Pérez' },
    militaresRecinto: [militar],
    entrega: null,
    editable: true,
    ...overrides,
  };
}

const entrega = {
  militar,
  entregadoEn: '2026-11-16T12:00:00.000Z',
  entregadoPorNombre: 'Jairo Leal',
  militarDeOtroRecinto: false,
};

async function render(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<EntregaMilitarScreen />);
  });
  return r;
}

const textoDe = (n: TestInstance) => n.findAllByType(Text).map((t) => [t.props.children].flat().join('')).join('');
const boton = (r: ReactTestRenderer, texto: string) =>
  r.root.find((n) => n.type === Pressable && n.props.accessibilityRole === 'button' && textoDe(n) === texto);
/** Todo el texto visible, con los fragmentos de cada <Text> unidos. */
const texto = (r: ReactTestRenderer) =>
  r.root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat().join(''))
    .join(' | ');
const radios = (r: ReactTestRenderer) =>
  r.root.findAll((n) => n.type === Pressable && n.props.accessibilityRole === 'radio');

async function escanear(r: ReactTestRenderer, codigo = 'ABCD2345') {
  await act(async () => r.root.findByProps({ accessibilityLabel: 'Código del kit' }).props.onChangeText(codigo));
  await act(async () => {
    r.root.find((n) => n.type === Pressable && n.props.accessibilityLabel === 'Validar código').props.onPress();
    await flush();
  });
}

describe('EntregaMilitarScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('con un solo militar en el recinto lo propone y registra la entrega', async () => {
    (validarKitCustodia as jest.Mock)
      .mockResolvedValueOnce(kit())
      .mockResolvedValueOnce(kit({ entrega }));
    (registrarEntrega as jest.Mock).mockResolvedValue(entrega);
    const anuncio = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const r = await render();

    await escanear(r);
    expect(radios(r)[0].props.accessibilityState).toEqual({ checked: true });

    await act(async () => {
      boton(r, 'Registrar entrega').props.onPress();
      await flush();
    });

    expect(registrarEntrega).toHaveBeenCalledWith({ kitId: 'kit-1', militarId: 'mil-1' });
    expect(anuncio).toHaveBeenCalledWith('Entrega registrada: kit ABCD2345 a Paz Juan');
    expect(validarKitCustodia).toHaveBeenLastCalledWith('ABCD2345'); // recarga la ficha
    expect(texto(r)).toContain('registró Jairo Leal');
  });

  it('con varios militares no propone ninguno: el botón queda deshabilitado hasta elegir', async () => {
    (validarKitCustodia as jest.Mock).mockResolvedValueOnce(
      kit({ militaresRecinto: [militar, { ...militar, id: 'mil-2', nombres: 'Pedro' }] }),
    );
    const r = await render();
    await escanear(r);

    expect(radios(r).every((x) => !x.props.accessibilityState.checked)).toBe(true);
    expect(boton(r, 'Registrar entrega').props.disabled).toBe(true);

    await act(async () => radios(r)[1].props.onPress());
    expect(boton(r, 'Registrar entrega').props.disabled).toBe(false);
  });

  it('cambiar el militar exige un motivo de al menos 5 caracteres', async () => {
    (validarKitCustodia as jest.Mock).mockResolvedValue(
      kit({ entrega, militaresRecinto: [militar, { ...militar, id: 'mil-2', nombres: 'Pedro' }] }),
    );
    (corregirMilitar as jest.Mock).mockResolvedValue(entrega);
    const r = await render();
    await escanear(r);

    await act(async () => boton(r, 'Cambiar militar').props.onPress());
    await act(async () => radios(r)[1].props.onPress());
    const guardar = () => boton(r, 'Guardar cambio de militar');
    expect(guardar().props.disabled).toBe(true);

    await act(async () => r.root.findByProps({ accessibilityLabel: 'Motivo del cambio' }).props.onChangeText('Reemplazo'));
    expect(guardar().props.disabled).toBe(false);
    await act(async () => {
      guardar().props.onPress();
      await flush();
    });

    expect(corregirMilitar).toHaveBeenCalledWith('kit-1', { militarId: 'mil-2', motivo: 'Reemplazo' });
  });

  it('cambiar el operador busca operadores y manda el motivo', async () => {
    // setImmediate queda real: lo usa flush() para esperar las promesas.
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      const { buscarOperadores } = jest.requireMock('../lib/queries/custodia');
      (buscarOperadores as jest.Mock).mockResolvedValue([{ id: 'op-2', cedula: '2', nombres: 'Luis', apellidos: 'Mora' }]);
      (validarKitCustodia as jest.Mock).mockResolvedValue(kit());
      (cambiarOperador as jest.Mock).mockResolvedValue({});
      const r = await render();
      await escanear(r);

      await act(async () => boton(r, 'Cambiar operador').props.onPress());
      const buscador = r.root.findByProps({ accessibilityLabel: 'Buscar operador por cédula o nombre' });
      await act(async () => buscador.props.onChangeText('mora'));
      await act(async () => {
        jest.advanceTimersByTime(400);
      });
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => radios(r).find((x) => x.props.accessibilityLabel.startsWith('Mora Luis'))!.props.onPress());
      await act(async () => r.root.findByProps({ accessibilityLabel: 'Motivo del cambio' }).props.onChangeText('No se presentó'));
      await act(async () => {
        boton(r, 'Guardar cambio de operador').props.onPress();
      });

      expect(buscarOperadores).toHaveBeenCalledWith('mora');
      expect(cambiarOperador).toHaveBeenCalledWith('kit-1', { operadorId: 'op-2', motivo: 'No se presentó' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('si el CDA ya recibió el kit, no ofrece cambios y lo explica', async () => {
    (validarKitCustodia as jest.Mock).mockResolvedValue(kit({ entrega, editable: false, estado: 'ENTREGADO' }));
    const r = await render();
    await escanear(r);

    const json = texto(r);
    expect(json).toContain('Las correcciones las hace un administrador');
    expect(json).not.toContain('Cambiar militar');
    expect(json).not.toContain('Cambiar operador');
    expect(r.root.findAllByType(TextInput)).toHaveLength(1); // solo el código del kit
  });

  it('un militar de otro recinto se señala en la entrega', async () => {
    (validarKitCustodia as jest.Mock).mockResolvedValue(
      kit({ entrega: { ...entrega, militarDeOtroRecinto: true, militar: { ...militar, recintoNombre: 'Colegio Norte' } } }),
    );
    const r = await render();
    await escanear(r);
    expect(texto(r)).toContain('Militar de otro recinto (');
  });

  it('un error del servidor se muestra al usuario', async () => {
    const alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    (validarKitCustodia as jest.Mock).mockRejectedValue({ response: { data: { message: 'Kit no encontrado en el evento activo' } } });
    const r = await render();
    await escanear(r, 'XXXX');
    expect(alerta).toHaveBeenCalledWith('Kit inválido', 'Kit no encontrado en el evento activo');
  });
});
