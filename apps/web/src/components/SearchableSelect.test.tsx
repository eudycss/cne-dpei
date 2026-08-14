import { useState, type FormEvent } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SearchableSelect, type SearchableSelectOption } from './SearchableSelect';

const OPTIONS: SearchableSelectOption[] = [
  { value: '1', label: 'Ana Torres', sublabel: '1712345678' },
  { value: '2', label: 'Bruno Vega', sublabel: '1798765432' },
  { value: '3', label: 'Carla Ruiz', sublabel: '1755555555' },
];

/** Wrapper controlado, como lo usaría un formulario real. */
function ControlledSelect({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <SearchableSelect
      options={OPTIONS}
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      placeholder="— Selecciona —"
      searchPlaceholder="Buscar…"
    />
  );
}

describe('SearchableSelect', () => {
  it('se renderiza inicialmente como botón mostrando el placeholder', () => {
    render(<ControlledSelect />);
    expect(screen.getByRole('button', { name: '— Selecciona —' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Buscar…')).not.toBeInTheDocument();
  });

  it('al hacer clic se convierte en input de búsqueda con dropdown de opciones', async () => {
    const user = userEvent.setup();
    render(<ControlledSelect />);

    await user.click(screen.getByRole('button', { name: '— Selecciona —' }));

    expect(screen.getByPlaceholderText('Buscar…')).toBeInTheDocument();
    expect(screen.getByText('Ana Torres')).toBeInTheDocument();
    expect(screen.getByText('Bruno Vega')).toBeInTheDocument();
    expect(screen.getByText('Carla Ruiz')).toBeInTheDocument();
  });

  it('filtra las opciones por texto (label y sublabel)', async () => {
    const user = userEvent.setup();
    render(<ControlledSelect />);

    await user.click(screen.getByRole('button', { name: '— Selecciona —' }));
    await user.type(screen.getByPlaceholderText('Buscar…'), 'bruno');

    expect(screen.getByText('Bruno Vega')).toBeInTheDocument();
    expect(screen.queryByText('Ana Torres')).not.toBeInTheDocument();
    expect(screen.queryByText('Carla Ruiz')).not.toBeInTheDocument();
  });

  it('filtra también por sublabel (cédula)', async () => {
    const user = userEvent.setup();
    render(<ControlledSelect />);

    await user.click(screen.getByRole('button', { name: '— Selecciona —' }));
    await user.type(screen.getByPlaceholderText('Buscar…'), '1755555555');

    expect(screen.getByText('Carla Ruiz')).toBeInTheDocument();
    expect(screen.queryByText('Ana Torres')).not.toBeInTheDocument();
  });

  it('al seleccionar una opción llama a onChange con el value correcto y cierra el dropdown', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ControlledSelect onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: '— Selecciona —' }));
    await user.click(screen.getByText('Bruno Vega'));

    expect(onChange).toHaveBeenCalledWith('2');
    expect(screen.queryByPlaceholderText('Buscar…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bruno Vega/ })).toBeInTheDocument();
  });

  it('cierra el dropdown al hacer clic afuera sin seleccionar nada', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <div>
        <ControlledSelect onChange={onChange} />
        <button type="button">Afuera</button>
      </div>,
    );

    await user.click(screen.getByRole('button', { name: '— Selecciona —' }));
    expect(screen.getByPlaceholderText('Buscar…')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Afuera' }));

    expect(screen.queryByPlaceholderText('Buscar…')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '— Selecciona —' })).toBeInTheDocument();
  });

  it('muestra "Sin resultados" cuando el filtro no coincide con ninguna opción', async () => {
    const user = userEvent.setup();
    render(<ControlledSelect />);

    await user.click(screen.getByRole('button', { name: '— Selecciona —' }));
    await user.type(screen.getByPlaceholderText('Buscar…'), 'zzz-no-existe');

    expect(screen.getByText('Sin resultados')).toBeInTheDocument();
  });

  it('permite seleccionar con teclado (flechas + Enter) sin depender del mouse', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ControlledSelect onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: '— Selecciona —' }));
    const input = screen.getByPlaceholderText('Buscar…');
    await user.type(input, '{ArrowDown}{Enter}');

    // highlight inicial = índice 0 (Ana Torres); un ArrowDown mueve a índice 1 (Bruno Vega)
    expect(onChange).toHaveBeenCalledWith('2');
    expect(screen.queryByPlaceholderText('Buscar…')).not.toBeInTheDocument();
  });

  it('Enter dentro de un <form> no dispara el submit del formulario', async () => {
    const onSubmit = vi.fn((e: FormEvent) => e.preventDefault());
    const user = userEvent.setup();
    render(
      <form onSubmit={onSubmit}>
        <ControlledSelect />
      </form>,
    );

    await user.click(screen.getByRole('button', { name: '— Selecciona —' }));
    await user.keyboard('{Enter}');

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Escape cierra el dropdown sin seleccionar', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ControlledSelect onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: '— Selecciona —' }));
    await user.keyboard('{Escape}');

    expect(screen.queryByPlaceholderText('Buscar…')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
