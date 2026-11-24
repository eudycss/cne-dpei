import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import type { MiAsignacionRecinto } from '@cne/shared-types';

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000' }) }),
}));

import { errorJustificacion, JustificacionNoCdaModal } from './JustificacionNoCdaModal';

const pendientes = [
  { id: 'a', codigoRecinto: '1917', nombre: 'EGB García Moreno' },
  { id: 'b', codigoRecinto: '1920', nombre: 'Escuela Imantag' },
] as MiAsignacionRecinto[];

function textos(r: ReactTestRenderer): string {
  return r.root
    .findAllByType(Text)
    .map((t) => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children)))
    .join(' | ');
}

function boton(r: ReactTestRenderer, texto: string) {
  return r.root.find(
    (n) =>
      n.props.accessibilityRole === 'button' &&
      typeof n.props.onPress === 'function' &&
      n.findAllByType(Text).some((t) => t.props.children === texto),
  );
}

describe('errorJustificacion (mismas reglas que el servidor)', () => {
  it('pide al menos 5 caracteres sin contar espacios', () => {
    expect(errorJustificacion('ok')).toBe('Escriba al menos 5 caracteres');
    expect(errorJustificacion('      ')).toBe('Escriba al menos 5 caracteres');
  });

  it('acepta un motivo válido', () => {
    expect(errorJustificacion('No llegó el bus')).toBeNull();
  });
});

describe('JustificacionNoCdaModal', () => {
  function montar(onConfirmar = jest.fn(), onCancelar = jest.fn()) {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <JustificacionNoCdaModal
          visible
          pendientes={pendientes}
          registrando={false}
          onConfirmar={onConfirmar}
          onCancelar={onCancelar}
        />,
      );
    });
    return r;
  }

  it('lista los NO CDA que faltan', () => {
    const t = textos(montar());
    expect(t).toContain('Faltan 2 recintos NO CDA sin marcar');
    expect(t).toContain('1917 · EGB García Moreno');
    expect(t).toContain('1920 · Escuela Imantag');
  });

  it('con un motivo corto muestra el error y no registra', () => {
    const onConfirmar = jest.fn();
    const r = montar(onConfirmar);
    act(() => r.root.findByType(TextInput).props.onChangeText('no'));
    act(() => boton(r, 'Registrar salida con este motivo').props.onPress());
    expect(onConfirmar).not.toHaveBeenCalled();
    expect(textos(r)).toContain('Escriba al menos 5 caracteres');
  });

  it('con un motivo válido registra con el texto recortado', () => {
    const onConfirmar = jest.fn();
    const r = montar(onConfirmar);
    act(() => r.root.findByType(TextInput).props.onChangeText('  El 1917 no llegó, se avisó al técnico  '));
    act(() => boton(r, 'Registrar salida con este motivo').props.onPress());
    expect(onConfirmar).toHaveBeenCalledWith('El 1917 no llegó, se avisó al técnico');
  });

  it('"Volver" cancela sin registrar', () => {
    const onConfirmar = jest.fn();
    const onCancelar = jest.fn();
    const r = montar(onConfirmar, onCancelar);
    act(() => boton(r, 'Volver y marcar los NO CDA').props.onPress());
    expect(onCancelar).toHaveBeenCalledTimes(1);
    expect(onConfirmar).not.toHaveBeenCalled();
  });
});
