import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mapa = { easeTo: vi.fn(), getBearing: vi.fn(() => 30) };
vi.mock('../../components/map', () => ({ useMapInstance: () => mapa }));

import { ControlesVista, PITCH_3D } from './ControlesVista';

function renderControles(vista3d = false) {
  const onCapa = vi.fn();
  const onVista3d = vi.fn();
  render(<ControlesVista capa="satelite-calles" onCapa={onCapa} vista3d={vista3d} onVista3d={onVista3d} />);
  return { onCapa, onVista3d };
}

describe('ControlesVista', () => {
  beforeEach(() => vi.clearAllMocks());

  it('elige la capa con radios accesibles', async () => {
    const { onCapa } = renderControles();
    expect(screen.getByRole('radio', { name: 'Satélite y calles' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Mapa de calles' }));
    expect(onCapa).toHaveBeenCalledWith('calles');
  });

  it('pasa a 3D inclinando el mapa', async () => {
    const { onVista3d } = renderControles(false);
    const boton = screen.getByRole('button', { name: 'Vista plana' });
    expect(boton).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(boton);
    expect(onVista3d).toHaveBeenCalledWith(true);
    expect(mapa.easeTo).toHaveBeenCalledWith(expect.objectContaining({ pitch: PITCH_3D }));
  });

  it('desde 3D vuelve a plano', async () => {
    renderControles(true);
    await userEvent.click(screen.getByRole('button', { name: 'Vista 3D' }));
    expect(mapa.easeTo).toHaveBeenCalledWith(expect.objectContaining({ pitch: 0 }));
  });

  it('gira 45° con botones (alternativa a los gestos) y vuelve al norte', async () => {
    renderControles();
    await userEvent.click(screen.getByRole('button', { name: 'Girar a la derecha' }));
    expect(mapa.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: 75 }));
    await userEvent.click(screen.getByRole('button', { name: 'Girar a la izquierda' }));
    expect(mapa.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: -15 }));
    await userEvent.click(screen.getByRole('button', { name: 'Norte arriba' }));
    expect(mapa.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: 0 }));
  });
});
