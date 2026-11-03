import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { AppState, AppStateStatus, Pressable, Text, TextInput } from 'react-native';
import type { KitRetornoEstado } from '@cne/shared-types';

jest.mock('../lib/queries/retorno', () => ({ getRetornoKits: jest.fn() }));
jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));
jest.mock('../components/AppBar', () => ({ AppBar: () => null }));

import { RetornoKitsScreen } from './RetornoKitsScreen';
import { getRetornoKits } from '../lib/queries/retorno';

const kit = (over: Partial<KitRetornoEstado>): KitRetornoEstado => ({
  kitId: 'k',
  codigoUnico: 'AAAA1111',
  recinto: { codigo: '1133', nombre: 'CECIB Manuel J. Calle' },
  operadorNombre: 'Carlos Pérez',
  asistenteNombre: null,
  estado: 'FALTA_LLEGAR',
  confirmadoEn: null,
  ...over,
});

const DATOS = {
  registrados: 1,
  faltan: 2,
  items: [
    kit({ kitId: 'k1', operadorNombre: 'Carlos Pérez', asistenteNombre: 'MUÑOZ ANDRADE MARÍA' }),
    kit({
      kitId: 'k2',
      recinto: { codigo: '1198', nombre: 'Unidad Educativa Juan Montalvo' },
      operadorNombre: 'Ana López',
      estado: 'LLEGO_SIN_VERIFICAR',
    }),
    kit({
      kitId: 'k3',
      recinto: { codigo: '971', nombre: 'Unidad Educativa Chaltura' },
      operadorNombre: 'Luis Gudiño',
      estado: 'REGISTRADO',
      confirmadoEn: '2026-11-03T22:30:00.000Z',
    }),
  ],
};

async function render(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<RetornoKitsScreen />);
  });
  return r;
}

const textos = (r: ReactTestRenderer) => r.root.findAllByType(Text).map((t) => [t.props.children].flat().join(''));
const recintosVisibles = (r: ReactTestRenderer) => textos(r).filter((t) => / · /.test(t) && /^\d/.test(t));

async function buscar(r: ReactTestRenderer, texto: string) {
  await act(async () => {
    r.root.findByType(TextInput).props.onChangeText(texto);
  });
}

async function elegirFiltro(r: ReactTestRenderer, inicio: string) {
  const btn = r.root
    .findAllByType(Pressable)
    .find((p) => p.findAllByType(Text).some((t) => String([t.props.children].flat().join('')).startsWith(inicio)));
  await act(async () => {
    btn!.props.onPress();
  });
}

describe('RetornoKitsScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (getRetornoKits as jest.Mock).mockReset().mockResolvedValue(DATOS);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('muestra los totales y, por defecto, solo a quienes faltan (sin llegar o sin verificar)', async () => {
    const r = await render();

    expect(textos(r)).toEqual(expect.arrayContaining(['Faltan (2)', 'Registrados (1)', 'Todos (3)']));
    expect(recintosVisibles(r)).toEqual(['1133 · CECIB Manuel J. Calle', '1198 · Unidad Educativa Juan Montalvo']);
    expect(textos(r)).toEqual(expect.arrayContaining(['Falta llegar', 'Llegó · falta verificar', 'Asistente: MUÑOZ ANDRADE MARÍA']));
  });

  it('el filtro Registrados muestra solo los verificados, con la hora', async () => {
    const r = await render();
    await elegirFiltro(r, 'Registrados');

    expect(recintosVisibles(r)).toEqual(['971 · Unidad Educativa Chaltura']);
    expect(textos(r).some((t) => t.startsWith('Registrado · '))).toBe(true);
  });

  it.each([
    ['munoz maria', '1133', 'el asistente, sin tildes'],
    ['gudino', '971', 'el operador, sin tilde (aunque ya esté registrado)'],
    ['1198', '1198', 'el código del recinto'],
    ['chaltura unidad', '971', 'el nombre del recinto con las palabras al revés'],
  ])('buscar "%s" encuentra el recinto %s (%s)', async (consulta, codigo) => {
    const r = await render();
    await buscar(r, consulta);

    const visibles = recintosVisibles(r);
    expect(visibles).toHaveLength(1);
    expect(visibles[0].startsWith(`${codigo} · `)).toBe(true);
  });

  it('una búsqueda sin coincidencias lo dice', async () => {
    const r = await render();
    await buscar(r, 'zzz');

    expect(textos(r)).toContain('Ningún recinto o persona coincide con la búsqueda.');
  });

  it('si ya se registraron todos, lo dice en la lista de faltantes', async () => {
    (getRetornoKits as jest.Mock).mockResolvedValue({ registrados: 1, faltan: 0, items: [DATOS.items[2]] });
    const r = await render();

    expect(textos(r)).toContain('Ya llegaron y se registraron todos los kits.');
  });

  it('muestra el error del servidor', async () => {
    (getRetornoKits as jest.Mock).mockRejectedValue({ response: { data: { message: 'No autorizado' } } });
    const r = await render();

    expect(textos(r)).toContain('No autorizado');
  });

  it('si falla un refresco, conserva la última lista y avisa encima', async () => {
    const r = await render();
    (getRetornoKits as jest.Mock).mockRejectedValueOnce(new Error('sin red'));
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    expect(textos(r)).toContain('No se pudo cargar el retorno de los kits. Se muestra la última lista recibida.');
    expect(recintosVisibles(r)).toHaveLength(2);
  });

  it('no lanza otra consulta mientras la anterior sigue en curso', async () => {
    let resolver!: (v: unknown) => void;
    (getRetornoKits as jest.Mock).mockReturnValueOnce(new Promise((res) => (resolver = res)));
    await render();
    await act(async () => {
      jest.advanceTimersByTime(90_000);
    });
    expect(getRetornoKits).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolver(DATOS);
    });
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(getRetornoKits).toHaveBeenCalledTimes(2);
  });

  it('en segundo plano no se refresca; al volver, se actualiza enseguida', async () => {
    let oyente!: (e: AppStateStatus) => void;
    const remove = jest.fn();
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, fn) => {
      oyente = fn as (e: AppStateStatus) => void;
      return { remove } as never;
    });
    const r = await render();

    await act(async () => {
      oyente('background');
      jest.advanceTimersByTime(90_000);
    });
    expect(getRetornoKits).toHaveBeenCalledTimes(1);

    await act(async () => {
      oyente('active');
    });
    expect(getRetornoKits).toHaveBeenCalledTimes(2);

    act(() => r.unmount());
    expect(remove).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('cada fila se anuncia con el recinto, las personas y el estado', async () => {
    const r = await render();
    const etiquetas = r.root.findAll((n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.includes('1133'));

    expect(etiquetas[0].props.accessibilityLabel).toBe(
      '1133 CECIB Manuel J. Calle, Carlos Pérez, MUÑOZ ANDRADE MARÍA, Falta llegar',
    );
  });

  it('se refresca solo cada 30 s y deja de hacerlo al salir', async () => {
    const r = await render();
    expect(getRetornoKits).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(getRetornoKits).toHaveBeenCalledTimes(2);

    act(() => r.unmount());
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(getRetornoKits).toHaveBeenCalledTimes(2);
  });
});
