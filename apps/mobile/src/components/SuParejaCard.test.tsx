import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Alert, Linking, Pressable, Text } from 'react-native';
import type { MiAsignacionCompanero } from '@cne/shared-types';

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));

import { SuParejaCard } from './SuParejaCard';

const ANA: MiAsignacionCompanero = { nombre: 'PÉREZ ANA', cargo: 'Operador CDA', telefono: '099 123-4567', esUsted: false };
const YO: MiAsignacionCompanero = { nombre: 'RUIZ JUAN', cargo: 'Asistente CDA', telefono: '0987654321', esUsted: true };

function render(pareja: MiAsignacionCompanero[] | undefined): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<SuParejaCard pareja={pareja} />);
  });
  return tree;
}

const textos = (tree: ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat().join(''))
    .join(' | ');

describe('SuParejaCard', () => {
  it('muestra a las dos personas con su cargo y marca quién es usted', () => {
    const t = textos(render([ANA, YO]));
    expect(t).toContain('Su pareja');
    expect(t).toContain('PÉREZ ANA');
    expect(t).toContain('Operador CDA');
    expect(t).toContain('RUIZ JUAN (usted)');
    expect(t).toContain('Asistente CDA');
  });

  it('pareja de dos operadores: cada uno con su cargo', () => {
    const t = textos(render([ANA, { ...YO, cargo: 'Operador CDA' }]));
    expect(t.match(/Operador CDA/g)).toHaveLength(2);
  });

  it('"Llamar" solo para la otra persona con teléfono, y marca su número', () => {
    const abrir = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const tree = render([ANA, YO]);
    const botones = tree.root.findAllByType(Pressable);
    expect(botones).toHaveLength(1);
    expect(botones[0].props.accessibilityLabel).toBe('Llamar a PÉREZ ANA');
    act(() => botones[0].props.onPress());
    expect(abrir).toHaveBeenCalledWith('tel:0991234567');
  });

  it('sin pareja registrada, sin nadie más que usted (o API antigua) no muestra nada', () => {
    expect(render([]).toJSON()).toBeNull();
    expect(render(undefined).toJSON()).toBeNull();
    expect(render([YO]).toJSON()).toBeNull();
  });

  it('un teléfono que no es un número no muestra "Llamar"', () => {
    expect(render([{ ...ANA, telefono: 'N/A' }, YO]).root.findAllByType(Pressable)).toHaveLength(0);
    expect(render([{ ...ANA, telefono: '12-34' }, YO]).root.findAllByType(Pressable)).toHaveLength(0);
  });

  it('si el celular no puede abrir el marcador, lo avisa', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValueOnce(new Error('sin marcador'));
    const alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const tree = render([ANA, YO]);
    await act(async () => {
      tree.root.findByType(Pressable).props.onPress();
    });
    expect(alerta).toHaveBeenCalledWith('No se pudo llamar', expect.stringContaining('0991234567'));
  });
});
