import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Modal, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MiAsignacionRecinto } from '@cne/shared-types';

jest.mock('../lib/queries/tracking', () => ({ postLlegadaNoCda: jest.fn() }));
jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000' }) }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

import { bienvenidaVista, marcarBienvenidaVista, NoCdaPanel } from './NoCdaPanel';
import { resumenNoCda } from './NoCdaBarra';
import { BLOQUEO_ANTES_DE_LLEGAR, BLOQUEO_TRAS_SALIDA } from './NoCdaChecklist';

const flush = () => new Promise((r) => setTimeout(r, 5));

function nc(id: string, llegadaRegistradaEn: string | null = null): MiAsignacionRecinto {
  return { id, codigoRecinto: id, nombre: `Escuela ${id}`, juntasFemeninas: 1, juntasMasculinas: 1, llegadaRegistradaEn } as MiAsignacionRecinto;
}

function textos(r: ReactTestRenderer): string {
  return r.root
    .findAllByType(Text)
    .map((t) => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children)))
    .join(' | ');
}

const modal = (r: ReactTestRenderer) => r.root.findByType(Modal);
const barra = (r: ReactTestRenderer) => r.root.findByProps({ testID: 'barra-no-cda' });

async function montar(props: Partial<Parameters<typeof NoCdaPanel>[0]> = {}) {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <NoCdaPanel
        noCdas={[nc('1'), nc('2', '2026-11-29T15:00:00Z')]}
        bloqueo={null}
        onMarcado={jest.fn()}
        pausaBienvenidaMs={0}
        {...props}
      />,
    );
    await flush();
    await flush();
  });
  return r;
}

describe('resumenNoCda', () => {
  it('pendiente, completo y bloqueado', () => {
    expect(resumenNoCda([nc('1'), nc('2', 'x')], null)).toMatchObject({ estado: 'pendiente', titulo: 'NO CDA: llegaron 1 de 2' });
    expect(resumenNoCda([nc('1', 'x')], null)).toMatchObject({ estado: 'completo', titulo: 'Llegaron los 1 NO CDA' });
    expect(resumenNoCda([nc('1'), nc('2')], BLOQUEO_ANTES_DE_LLEGAR)).toMatchObject({
      estado: 'bloqueado',
      titulo: '2 NO CDA a su cargo',
      detalle: 'Se habilitan al llegar al recinto',
    });
    expect(resumenNoCda([nc('1')], BLOQUEO_TRAS_SALIDA).detalle).toBe('Ya no se marcan: registró la salida');
  });
});

describe('NoCdaPanel', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('sin NO CDA no muestra nada', async () => {
    const r = await montar({ noCdas: [] });
    expect(r.root.findAllByProps({ testID: 'barra-no-cda' })).toHaveLength(0);
  });

  it('la barra dice cuántos llegaron y al tocarla abre el listado con "Marcar llegada"', async () => {
    const r = await montar();
    expect(barra(r).props.accessibilityLabel).toBe('NO CDA: llegaron 1 de 2. Toque para marcar los que llegan');
    expect(modal(r).props.visible).toBe(false);
    await act(async () => barra(r).props.onPress());
    expect(modal(r).props.visible).toBe(true);
    expect(textos(r)).toContain('Marcar llegada');
  });

  it('la flecha hacia abajo cierra el listado y el botón "Cerrar" sigue ahí', async () => {
    const r = await montar({ bloqueo: BLOQUEO_ANTES_DE_LLEGAR });
    await act(async () => barra(r).props.onPress());
    expect(textos(r)).toContain('Cerrar');
    await act(async () => r.root.findByProps({ accessibilityLabel: 'Cerrar la lista de recintos NO CDA' }).props.onPress());
    expect(modal(r).props.visible).toBe(false);
  });

  it('en tránsito: la barra se ve con candado y el listado sale bloqueado', async () => {
    const r = await montar({ bloqueo: BLOQUEO_ANTES_DE_LLEGAR });
    expect(barra(r).props.accessibilityLabel).toBe('2 NO CDA a su cargo. Se habilitan al llegar al recinto');
    await act(async () => barra(r).props.onPress());
    expect(textos(r)).toContain(BLOQUEO_ANTES_DE_LLEGAR);
    expect(textos(r)).not.toContain('Marcar llegada');
  });

  it('al llegar al recinto la ventana se abre sola con la bienvenida; al cerrarla no vuelve a salir', async () => {
    const r = await montar({ bienvenidaClave: 'ev_rec' });
    expect(modal(r).props.visible).toBe(true);
    expect(textos(r)).toContain('Tiene 2 recintos NO CDA a su cargo');
    await act(async () => {
      modal(r).props.onRequestClose();
      await flush();
    });
    expect(modal(r).props.visible).toBe(false);

    const otraVez = await montar({ bienvenidaClave: 'ev_rec' });
    expect(modal(otraVez).props.visible).toBe(false);
  });

  it('si la pantalla se desmonta antes de cerrarla (p. ej. al recargar), la bienvenida vuelve a salir', async () => {
    const r = await montar({ bienvenidaClave: 'ev_x' });
    expect(modal(r).props.visible).toBe(true);
    act(() => r.unmount());
    const deNuevo = await montar({ bienvenidaClave: 'ev_x' });
    expect(modal(deNuevo).props.visible).toBe(true);
  });

  it('no se abre sola si está bloqueada o si ya llegaron todos', async () => {
    expect(modal(await montar({ bienvenidaClave: 'a', bloqueo: BLOQUEO_ANTES_DE_LLEGAR })).props.visible).toBe(false);
    expect(modal(await montar({ bienvenidaClave: 'b', noCdas: [nc('1', 'x')] })).props.visible).toBe(false);
  });

  it('bienvenidaVista solo cambia al marcarla', async () => {
    expect(await bienvenidaVista('k')).toBe(false);
    await marcarBienvenidaVista('k');
    expect(await bienvenidaVista('k')).toBe(true);
  });
});
