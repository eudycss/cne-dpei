import { act, create, ReactTestRenderer, TestInstance } from 'react-test-renderer';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ValidarKitRetornoResponse } from '@cne/shared-types';

jest.setTimeout(30000);

jest.mock('../lib/queries/retorno', () => ({
  validarKitRetorno: jest.fn(),
  verificarKitRetorno: jest.fn(),
}));
jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));
jest.mock('../components/AppBar', () => ({ AppBar: () => null }));
jest.mock('../components/CameraQr', () => ({ CameraQr: () => null }));

import { VerificacionDpiScreen } from './VerificacionDpiScreen';
import { validarKitRetorno, verificarKitRetorno } from '../lib/queries/retorno';

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

const kitCatalogo: ValidarKitRetornoResponse = {
  id: '33333333-3333-3333-3333-333333333333',
  codigoUnico: 'ABCD2345',
  nombre: '28 — Escuela Central',
  operadorNombre: 'Ana López',
  yaVerificado: false,
  items: [
    { texto: 'Computador', marcado: true, itemId: 'i1', serie: '5CD445577S', estado: 'BUENO' },
    { texto: 'Cargador', marcado: true, itemId: 'i2', serie: null, estado: 'BUENO' },
  ],
};

async function render(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<VerificacionDpiScreen />);
  });
  return r;
}

const porRol = (r: ReactTestRenderer, rol: string): TestInstance[] =>
  r.root.findAll((n) => n.type === Pressable && n.props.accessibilityRole === rol);
const textos = (r: ReactTestRenderer) => r.root.findAllByType(Text).map((t) => [t.props.children].flat().join(''));

async function validarManual(r: ReactTestRenderer, codigo: string) {
  const input = r.root.findByProps({ accessibilityLabel: 'Código del kit' });
  await act(async () => input.props.onChangeText(codigo));
  const boton = r.root.find((n) => n.type === Pressable && n.props.accessibilityLabel === 'Validar código');
  await act(async () => {
    boton.props.onPress();
    await flushPromises();
  });
}

describe('VerificacionDpiScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('valida un código escrito a mano (en mayúsculas) y muestra la serie de cada ítem (S/N si no tiene)', async () => {
    (validarKitRetorno as jest.Mock).mockResolvedValue(kitCatalogo);
    const r = await render();

    await validarManual(r, 'abcd2345');

    expect(validarKitRetorno).toHaveBeenCalledWith('ABCD2345');
    expect(textos(r)).toEqual(expect.arrayContaining(['Serie: 5CD445577S', 'Serie: S/N']));
    expect(porRol(r, 'checkbox').map((c) => c.props.accessibilityLabel)).toEqual([
      'Computador, serie 5CD445577S',
      'Cargador, serie S/N',
    ]);
  });

  it('con muchos artículos todos quedan en un solo desplazamiento y los botones siempre a la vista', async () => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      texto: `Artículo ${i}`,
      marcado: true,
      itemId: `i${i}`,
      serie: null,
      estado: 'BUENO' as const,
    }));
    (validarKitRetorno as jest.Mock).mockResolvedValue({ ...kitCatalogo, items });
    const r = await render();
    await validarManual(r, 'ABCD2345');

    expect(textos(r)).toContain('Contenido: 6 artículos');
    // Los 6 artículos están dentro del contenido desplazable del modal...
    const contenido = r.root.find((n) => n.type === ScrollView && n.props.testID === 'verificacion-contenido');
    expect(contenido.findAll((n) => n.type === Pressable && n.props.accessibilityRole === 'checkbox')).toHaveLength(6);
    // ...sin un alto fijo que esconda artículos sin avisar.
    expect(StyleSheet.flatten(contenido.props.style)).not.toHaveProperty('maxHeight');
    // Cancelar y Confirmar quedan fuera del desplazamiento: siempre a la vista.
    const acciones = r.root.find((n) => n.type === View && n.props.testID === 'verificacion-acciones');
    expect(contenido.findAll((n) => n === acciones)).toHaveLength(0);
    expect(acciones.findAll((n) => n.type === Pressable)).toHaveLength(2);
  });

  it('con un solo artículo lo dice en singular', async () => {
    (validarKitRetorno as jest.Mock).mockResolvedValue({ ...kitCatalogo, items: [kitCatalogo.items[0]] });
    const r = await render();
    await validarManual(r, 'ABCD2345');
    expect(textos(r)).toContain('Contenido: 1 artículo');
  });

  it('el botón Atrás de Android cierra el modal como Cancelar', async () => {
    (validarKitRetorno as jest.Mock).mockResolvedValue(kitCatalogo);
    const r = await render();
    await validarManual(r, 'ABCD2345');
    const modal = () => r.root.findAllByType(Modal).find((m) => m.props.onRequestClose)!;
    expect(modal().props.visible).toBe(true);
    await act(async () => modal().props.onRequestClose());
    expect(modal().props.visible).toBe(false);
  });

  it('el botón Validar está deshabilitado sin código', async () => {
    const r = await render();
    const boton = r.root.find((n) => n.type === Pressable && n.props.accessibilityLabel === 'Validar código');
    expect(boton.props.disabled).toBe(true);
    expect(r.root.findAllByType(TextInput)).toHaveLength(1);
  });

  it('cambiar el estado de un ítem al retorno se envía en la verificación', async () => {
    (validarKitRetorno as jest.Mock).mockResolvedValue(kitCatalogo);
    (verificarKitRetorno as jest.Mock).mockResolvedValue({ id: 'r1' });
    const r = await render();
    await validarManual(r, 'ABCD2345');

    const malo = porRol(r, 'radio').find((b) => b.props.accessibilityLabel === 'Cargador: Malo')!;
    await act(async () => malo.props.onPress());
    expect(
      porRol(r, 'radio').find((b) => b.props.accessibilityLabel === 'Cargador: Malo')!.props.accessibilityState,
    ).toEqual({ checked: true });

    const confirmar = r.root.find((n) => n.type === Pressable && n.props.onPress && textoDe(n) === 'Confirmar verificación');
    await act(async () => {
      confirmar.props.onPress();
      await flushPromises();
    });

    expect(verificarKitRetorno).toHaveBeenCalledWith({
      kitId: kitCatalogo.id,
      items: [
        kitCatalogo.items[0],
        { ...kitCatalogo.items[1], estado: 'MALO' },
      ],
      observaciones: null,
    });
  });

  it('los kits legacy (texto libre, sin itemId) no muestran serie ni selector de estado', async () => {
    (validarKitRetorno as jest.Mock).mockResolvedValue({
      ...kitCatalogo,
      items: [{ texto: 'Acta', marcado: true }],
    });
    const r = await render();
    await validarManual(r, 'ABCD2345');

    expect(porRol(r, 'radio')).toHaveLength(0);
    expect(textos(r).some((t) => t.startsWith('Serie:'))).toBe(false);
  });

  it('si el código no es válido muestra el mensaje del servidor', async () => {
    const alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    (validarKitRetorno as jest.Mock).mockRejectedValue({ response: { data: { message: 'Kit no encontrado' } } });
    const r = await render();
    await validarManual(r, 'XXXX');

    expect(alerta).toHaveBeenCalledWith('Kit inválido', 'Kit no encontrado');
  });
});

function textoDe(n: TestInstance): string {
  return n.findAllByType(Text).map((t) => [t.props.children].flat().join('')).join('');
}
