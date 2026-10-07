import { act, create, ReactTestRenderer } from 'react-test-renderer';

// La barra en sí se prueba en FlujoPestanas.test.tsx; aquí solo qué pestañas
// recibe cada rol.
jest.mock('../components/FlujoPestanas', () => ({
  FlujoPestanas: ({ pestanas }: { pestanas: { label: string }[] }) => {
    const { Text } = require('react-native');
    return <Text testID="pestanas">{pestanas.map((p) => p.label).join('|')}</Text>;
  },
}));
jest.mock('./MonitoreoScreen', () => ({ MonitoreoScreen: () => null }));
jest.mock('./AlertasScreen', () => ({ AlertasScreen: () => null }));
jest.mock('./RecintosDificilAccesoScreen', () => ({ RecintosDificilAccesoScreen: () => null }));

import { SupervisorFlow } from './SupervisorFlow';

describe('SupervisorFlow', () => {
  it('solo monitorea: ya no tiene las pestañas de verificación de kits (pasaron al asistente)', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<SupervisorFlow />);
    });
    expect(r.root.findByProps({ testID: 'pestanas' }).props.children).toBe(
      'Monitoreo|Alertas|Recintos difíciles',
    );
  });
});
