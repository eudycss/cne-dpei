import { act, create, ReactTestRenderer } from 'react-test-renderer';

jest.mock('../components/FlujoPestanas', () => ({
  FlujoPestanas: ({ pestanas }: { pestanas: { label: string; render: () => unknown }[] }) => {
    const { View, Text } = require('react-native');
    return (
      <View>
        <Text testID="pestanas">{pestanas.map((p) => p.label).join('|')}</Text>
        {pestanas.map((p) => (
          <View key={p.label}>{p.render() as never}</View>
        ))}
      </View>
    );
  },
}));
jest.mock('./EntregaMilitarScreen', () => ({ EntregaMilitarScreen: () => 'pantalla-entregar' }));
jest.mock('./VerificacionDpiScreen', () => ({ VerificacionDpiScreen: () => 'pantalla-verificar' }));
jest.mock('./KitsVerificadosScreen', () => ({ KitsVerificadosScreen: () => 'pantalla-verificados' }));

import { AsistenteFlow } from './AsistenteFlow';

describe('AsistenteFlow', () => {
  it('tiene, en orden de la jornada, la entrega al militar, la verificación al retorno y los verificados', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<AsistenteFlow />);
    });
    expect(r.root.findByProps({ testID: 'pestanas' }).props.children).toBe('Entregar a militar|Verificar retorno|Verificados');
    const json = JSON.stringify(r.toJSON());
    expect(json).toContain('pantalla-entregar');
    expect(json).toContain('pantalla-verificar');
    expect(json).toContain('pantalla-verificados');
  });
});
