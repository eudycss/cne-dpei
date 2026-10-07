import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { ActivityIndicator, Pressable, Text } from 'react-native';

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));

import { OpcionPersona, SelectorPersona } from './SelectorPersona';

const ana: OpcionPersona = { id: 'a', titulo: 'Pérez Ana', detalle: 'C.I. 1' };
const luis: OpcionPersona = { id: 'l', titulo: 'Mora Luis', detalle: 'C.I. 2', aviso: 'De otro recinto' };
const pedro: OpcionPersona = { id: 'p', titulo: 'Paz Pedro', detalle: 'C.I. 3' };

function render(props: Partial<Parameters<typeof SelectorPersona>[0]> = {}) {
  const onSeleccionar = jest.fn();
  const buscar = jest.fn().mockResolvedValue([]);
  let r!: ReactTestRenderer;
  const elemento = (extra: Partial<Parameters<typeof SelectorPersona>[0]> = {}) => (
    <SelectorPersona
      titulo="Militares"
      sugeridas={[ana]}
      seleccionado={null}
      onSeleccionar={onSeleccionar}
      buscar={buscar}
      etiquetaBuscador="Buscar militar"
      {...props}
      {...extra}
    />
  );
  act(() => {
    r = create(elemento());
  });
  return { r, onSeleccionar, buscar, rerender: (extra: Partial<Parameters<typeof SelectorPersona>[0]>) => act(() => r.update(elemento(extra))) };
}

const radios = (r: ReactTestRenderer) =>
  r.root.findAll((n) => n.type === Pressable && n.props.accessibilityRole === 'radio');
const etiquetas = (r: ReactTestRenderer) => radios(r).map((x) => x.props.accessibilityLabel as string);
const escribir = (r: ReactTestRenderer, t: string) =>
  act(() => r.root.findByProps({ accessibilityLabel: 'Buscar militar' }).props.onChangeText(t));

describe('SelectorPersona', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('muestra las sugeridas como radios con su detalle y el aviso en la etiqueta accesible', () => {
    const { r } = render({ sugeridas: [ana, luis] });
    expect(etiquetas(r)).toEqual(['Pérez Ana, C.I. 1', 'Mora Luis, C.I. 2, De otro recinto']);
  });

  it('espera a que se deje de escribir y no busca con menos de 2 caracteres', async () => {
    const { r, buscar } = render();
    escribir(r, 'p');
    act(() => jest.advanceTimersByTime(1000));
    expect(buscar).not.toHaveBeenCalled();

    escribir(r, 'pa');
    escribir(r, 'paz');
    expect(r.root.findAllByType(ActivityIndicator)[0].props.accessibilityLabel).toBe('Buscando');
    act(() => jest.advanceTimersByTime(400));
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(buscar).toHaveBeenCalledWith('paz');
  });

  it('una respuesta vieja que llega tarde no pisa la de la búsqueda más nueva', async () => {
    let resolverVieja!: (v: OpcionPersona[]) => void;
    const buscar = jest
      .fn()
      .mockImplementationOnce(() => new Promise((res) => (resolverVieja = res)))
      .mockResolvedValueOnce([pedro]);
    const { r } = render({ buscar });

    escribir(r, 'mo');
    act(() => jest.advanceTimersByTime(400));
    escribir(r, 'paz');
    act(() => jest.advanceTimersByTime(400));
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      resolverVieja([luis]);
      await Promise.resolve();
    });

    expect(etiquetas(r)).toEqual(['Pérez Ana, C.I. 1', 'Paz Pedro, C.I. 3']);
  });

  it('la persona elegida desde la búsqueda sigue a la vista aunque se borre el texto', () => {
    const { r, rerender } = render({ seleccionado: null });
    rerender({ seleccionado: luis });
    expect(etiquetas(r)).toContain('Mora Luis, C.I. 2, De otro recinto');
    expect(radios(r).find((x) => x.props.accessibilityLabel.startsWith('Mora'))!.props.accessibilityState).toEqual({
      checked: true,
    });
  });

  it('si la búsqueda falla muestra el error sin resultados viejos', async () => {
    const buscar = jest.fn().mockResolvedValueOnce([pedro]).mockRejectedValueOnce(new Error('red'));
    const { r } = render({ buscar });
    escribir(r, 'paz');
    act(() => jest.advanceTimersByTime(400));
    await act(async () => {
      await Promise.resolve();
    });
    escribir(r, 'pazx');
    act(() => jest.advanceTimersByTime(400));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const textos = r.root.findAllByType(Text).map((t) => [t.props.children].flat().join(''));
    expect(textos).toContain('No se pudo buscar. Revisa la conexión.');
    expect(etiquetas(r)).toEqual(['Pérez Ana, C.I. 1']);
  });
});
