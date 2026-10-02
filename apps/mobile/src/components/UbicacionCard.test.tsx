import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));

import { contraer, UbicacionCard } from './UbicacionCard';

function textoDe(props: Partial<Parameters<typeof UbicacionCard>[0]>): string {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <UbicacionCard
        info={null}
        verificando={false}
        error={null}
        onActualizar={jest.fn()}
        destinoLabel="el recinto"
        {...props}
      />,
    );
  });
  return tree.root
    .findAllByType(Text)
    .map((t) => t.props.children)
    .flat()
    .join(' ');
}

describe('contraer', () => {
  it('une "de el" en "del" y "a el" en "al"', () => {
    expect(contraer('de', 'el recinto')).toBe('del recinto');
    expect(contraer('a', 'el recinto')).toBe('al recinto');
  });

  it('no toca destinos femeninos', () => {
    expect(contraer('de', 'la Delegación')).toBe('de la Delegación');
    expect(contraer('a', 'la Delegación')).toBe('a la Delegación');
  });
});

describe('UbicacionCard', () => {
  it('dice "del recinto" cuando el operador está lejos', () => {
    const texto = textoDe({ info: { distanciaM: 42898.4, margenM: 173, dentro: false } as any });
    expect(texto).toContain('Estás a 42898 m del recinto. Acércate a menos de 173 m.');
    expect(texto).not.toContain('de el');
  });

  it('dice "al recinto" cuando aún no se verificó la cercanía', () => {
    expect(textoDe({})).toContain('No se ha verificado tu cercanía al recinto.');
  });

  it('mantiene "de la Delegación" en el retorno', () => {
    const texto = textoDe({
      destinoLabel: 'la Delegación',
      info: { distanciaM: 500, margenM: 100, dentro: false } as any,
    });
    expect(texto).toContain('Estás a 500 m de la Delegación.');
  });
});
