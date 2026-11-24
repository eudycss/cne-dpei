import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BellRingIcon, FileSpreadsheetIcon, PrinterIcon, RotateCcwIcon, RotateCwIcon, useIconoAnimado } from '.';

function Boton({ Icono }: { Icono: typeof BellRingIcon }) {
  const icono = useIconoAnimado();
  return (
    <button type="button" {...icono.disparadores}>
      <Icono ref={icono.ref} size={16} aria-hidden="true" />
    </button>
  );
}

// Con motion real (sin mocks): cada icono dibuja su SVG y aguanta hover/foco sin errores.
describe.each([BellRingIcon, FileSpreadsheetIcon, PrinterIcon, RotateCcwIcon, RotateCwIcon])('%o con motion real', (Icono) => {
  it('dibuja el SVG del tamaño pedido y se anima sin errores', async () => {
    const user = userEvent.setup();
    const { container, getByRole } = render(<Boton Icono={Icono} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '16');
    await user.hover(getByRole('button'));
    await user.unhover(getByRole('button'));
    await user.tab();
  });
});
