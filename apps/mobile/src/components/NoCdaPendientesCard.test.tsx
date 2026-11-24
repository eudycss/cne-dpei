import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import type { MiAsignacionRecinto } from '@cne/shared-types';

jest.mock('../lib/queries/tracking', () => ({ postLlegadaNoCda: jest.fn() }));
jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000' }) }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { NoCdaPendientesCard } from './NoCdaPendientesCard';
import { postLlegadaNoCda } from '../lib/queries/tracking';

const flush = () => new Promise((r) => setImmediate(r));

function nc(id: string, llegadaRegistradaEn: string | null = null): MiAsignacionRecinto {
  return {
    id,
    codigoRecinto: id,
    nombre: `Escuela ${id}`,
    parroquia: null,
    juntasFemeninas: 1,
    juntasMasculinas: 1,
    llegadaRegistradaEn,
  } as MiAsignacionRecinto;
}

function textos(r: ReactTestRenderer): string {
  return r.root
    .findAllByType(Text)
    .map((t) => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children)))
    .join(' | ');
}

describe('NoCdaPendientesCard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('no se muestra si el CDA no tiene NO CDA', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<NoCdaPendientesCard noCdas={[]} onMarcado={jest.fn()} />);
    });
    expect(r.toJSON()).toBeNull();
  });

  it('con pendientes muestra cuántos faltan, el contador y la lista abierta', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<NoCdaPendientesCard noCdas={[nc('1'), nc('2', '2026-11-23T15:00:00Z'), nc('3')]} onMarcado={jest.fn()} />);
    });
    const t = textos(r);
    expect(t).toContain('Faltan 2 recintos NO CDA por marcar');
    expect(t).toContain('1/3');
    expect(t).toContain('Escuela 1');
  });

  it('marcar un NO CDA llama a la API y avisa para recargar', async () => {
    (postLlegadaNoCda as jest.Mock).mockResolvedValue({});
    const onMarcado = jest.fn();
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<NoCdaPendientesCard noCdas={[nc('1')]} onMarcado={onMarcado} />);
    });
    const fila = r.root.find((n) => n.props.accessibilityRole === 'checkbox' && typeof n.props.onPress === 'function');
    await act(async () => {
      fila.props.onPress();
      await flush();
    });
    expect(postLlegadaNoCda).toHaveBeenCalledWith('1');
    expect(onMarcado).toHaveBeenCalledTimes(1);
  });

  it('si falla la marca muestra el error y no recarga', async () => {
    (postLlegadaNoCda as jest.Mock).mockRejectedValue(new Error('500'));
    const onMarcado = jest.fn();
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<NoCdaPendientesCard noCdas={[nc('1')]} onMarcado={onMarcado} />);
    });
    const fila = r.root.find((n) => n.props.accessibilityRole === 'checkbox' && typeof n.props.onPress === 'function');
    await act(async () => {
      fila.props.onPress();
      await flush();
    });
    expect(onMarcado).not.toHaveBeenCalled();
    expect(textos(r)).toContain('No se pudo registrar la llegada');
  });

  it('completa: mensaje verde y la lista plegada hasta tocar "Ver lista"', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<NoCdaPendientesCard noCdas={[nc('1', '2026-11-23T15:00:00Z')]} onMarcado={jest.fn()} />);
    });
    expect(textos(r)).toContain('Llegaron los 1 NO CDA');
    expect(textos(r)).not.toContain('Escuela 1');
    const ver = r.root.find((n) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function');
    act(() => ver.props.onPress());
    expect(textos(r)).toContain('Escuela 1');
  });
});
