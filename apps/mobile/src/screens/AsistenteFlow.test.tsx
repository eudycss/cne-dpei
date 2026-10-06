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
jest.mock('./VerificacionDpiScreen', () => ({ VerificacionDpiScreen: () => 'pantalla-verificar' }));
jest.mock('./KitsVerificadosScreen', () => ({ KitsVerificadosScreen: () => 'pantalla-verificados' }));

import { AsistenteFlow } from './AsistenteFlow';

describe('AsistenteFlow', () => {
  it('tiene la verificación de kits al retorno y la lista de verificados', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<AsistenteFlow />);
    });
    expect(r.root.findByProps({ testID: 'pestanas' }).props.children).toBe('Verificar retorno|Verificados');
    const json = JSON.stringify(r.toJSON());
    expect(json).toContain('pantalla-verificar');
    expect(json).toContain('pantalla-verificados');
  });
});
