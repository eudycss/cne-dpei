import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Pressable, Text } from 'react-native';
import type { MiAsignacionRecinto } from '@cne/shared-types';

jest.mock('../lib/queries/tracking', () => ({ postLlegadaNoCda: jest.fn() }));
jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000' }) }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { juntasTotales, NoCdaChecklist } from './NoCdaChecklist';
import { postLlegadaNoCda } from '../lib/queries/tracking';

const flush = () => new Promise((r) => setImmediate(r));

function nc(id: string, llegadaRegistradaEn: string | null = null): MiAsignacionRecinto {
  return {
    id,
    codigoRecinto: id,
    nombre: `Escuela ${id}`,
    parroquia: 'Imantag',
    juntasFemeninas: 2,
    juntasMasculinas: 3,
    llegadaRegistradaEn,
  } as MiAsignacionRecinto;
}

function filas(r: ReactTestRenderer) {
  return r.root.findAllByType(Pressable);
}

function textos(r: ReactTestRenderer): string {
  return r.root
    .findAllByType(Text)
    .map((t) => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children)))
    .join(' | ');
}

describe('NoCdaChecklist', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sin NO CDA muestra el texto de lista vacía', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<NoCdaChecklist noCdas={[]} onMarcado={jest.fn()} />);
    });
    expect(textos(r)).toContain('Sin NO-CDAs asignados a este CDA.');
  });

  it('suma juntas femeninas y masculinas', () => {
    expect(juntasTotales(nc('1'))).toBe(5);
    expect(juntasTotales({ ...nc('1'), juntasFemeninas: null, juntasMasculinas: null })).toBe(0);
  });

  it('el ya marcado queda deshabilitado y anuncia la hora al lector de pantalla', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<NoCdaChecklist noCdas={[nc('1', '2026-11-23T15:05:00Z'), nc('2')]} onMarcado={jest.fn()} />);
    });
    const [marcado, pendiente] = filas(r);
    expect(marcado.props.disabled).toBe(true);
    expect(marcado.props.accessibilityState.checked).toBe(true);
    expect(marcado.props.accessibilityLabel).toMatch(/^Escuela 1, 1, llegó a las /);
    expect(pendiente.props.disabled).toBe(false);
    expect(pendiente.props.accessibilityLabel).toBe('Escuela 2, 2, sin marcar');
  });

  it('mientras marca uno, las demás filas quedan deshabilitadas', async () => {
    let resolver!: () => void;
    (postLlegadaNoCda as jest.Mock).mockImplementation(() => new Promise<void>((res) => (resolver = res)));
    const onMarcado = jest.fn();
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<NoCdaChecklist noCdas={[nc('1'), nc('2')]} onMarcado={onMarcado} />);
    });
    await act(async () => {
      filas(r)[0].props.onPress();
    });
    expect(filas(r).every((f) => f.props.disabled)).toBe(true);
    await act(async () => {
      resolver();
      await flush();
    });
    expect(onMarcado).toHaveBeenCalledTimes(1);
    expect(filas(r)[1].props.disabled).toBe(false);
  });

  it('si falla la marca muestra el error', async () => {
    (postLlegadaNoCda as jest.Mock).mockRejectedValue(new Error('500'));
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<NoCdaChecklist noCdas={[nc('1')]} onMarcado={jest.fn()} />);
    });
    await act(async () => {
      filas(r)[0].props.onPress();
      await flush();
    });
    expect(textos(r)).toContain('No se pudo registrar la llegada. Intente de nuevo.');
  });
});
