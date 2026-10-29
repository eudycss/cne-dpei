import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

jest.mock('../lib/queries/retorno', () => ({ getKitsVerificadosRetorno: jest.fn() }));
jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));
jest.mock('../components/AppBar', () => ({ AppBar: () => null }));

import { KitsVerificadosScreen } from './KitsVerificadosScreen';
import { getKitsVerificadosRetorno } from '../lib/queries/retorno';

const base = {
  nombre: '28 — Escuela Central',
  operadorId: 'op1',
  operadorNombre: 'Ana López',
  confirmadoEn: '2026-10-28T18:30:00.000Z',
};

async function render(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<KitsVerificadosScreen />);
  });
  return r;
}

const textos = (r: ReactTestRenderer) => r.root.findAllByType(Text).map((t) => [t.props.children].flat().join(''));

describe('KitsVerificadosScreen', () => {
  it('marca los kits verificados antes de que llegara la salida del recinto', async () => {
    (getKitsVerificadosRetorno as jest.Mock).mockResolvedValue({
      total: 2,
      items: [
        { ...base, kitId: 'k1', codigoUnico: 'AAAA1111', salidaPendiente: true },
        { ...base, kitId: 'k2', codigoUnico: 'BBBB2222', salidaPendiente: false },
      ],
    });
    const r = await render();

    const marcas = textos(r).filter((t) => t.includes('Salida del recinto pendiente'));
    expect(marcas).toHaveLength(1);
  });
});
