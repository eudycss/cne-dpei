import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TecnicoParejasCda } from '@cne/shared-types';

import { ReporteTecnicosModal } from './ReporteTecnicosModal';
import { api } from '../../lib/api';
import { sileo } from 'sileo';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn() } }));
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const DIA = '2026-11-01';
const TECNICOS: TecnicoParejasCda[] = [
  { nombre: 'Ing. Jairo Leal', recintos: 12, parejas: 12 },
  { nombre: 'Ing. Sebastian Cabascango', recintos: 12, parejas: 16 },
  { nombre: 'Ing. Carlos Cañares', recintos: 0, parejas: 0 },
  { nombre: null, recintos: 1, parejas: 1 },
];

function mockApi(tecnicos: TecnicoParejasCda[] | Error = TECNICOS) {
  getMock.mockImplementation((url: string) => {
    if (url.startsWith('/parejas-cda/tecnicos')) {
      return tecnicos instanceof Error ? Promise.reject({ response: { data: { message: tecnicos.message } } }) : Promise.resolve({ data: tecnicos });
    }
    return Promise.resolve({ data: new Blob(['x']) });
  });
}

function mockDescarga() {
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  const descargas: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    descargas.push(this.download);
  });
  return descargas;
}

const onClose = vi.fn();
function renderModal() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ReporteTecnicosModal dia={DIA} onClose={onClose} />
    </QueryClientProvider>,
  );
}

describe('Reporte por técnico', () => {
  beforeEach(() => vi.resetAllMocks());

  it('lista los técnicos del distributivo con sus recintos y parejas; sin ninguno marcado no deja descargar', async () => {
    mockApi();
    renderModal();
    expect(screen.getByRole('dialog', { name: 'Reporte por técnico' })).toBeInTheDocument();
    expect(await screen.findByRole('checkbox', { name: 'Ing. Jairo Leal · 12 recintos · 12 parejas' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Sin técnico en el distributivo · 1 recintos · 1 parejas' })).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith(`/parejas-cda/tecnicos?fecha=${DIA}`);
    for (const boton of ['Excel', 'PDF', 'Contactos (.vcf)']) expect(screen.getByRole('button', { name: boton })).toBeDisabled();
    expect(screen.getByText('Marque al menos un técnico.')).toBeInTheDocument();
  });

  it('descarga en un solo archivo el Excel, el PDF o los contactos de los técnicos marcados', async () => {
    mockApi();
    const descargas = mockDescarga();
    renderModal();
    await userEvent.click(await screen.findByRole('checkbox', { name: /Ing\. Jairo Leal/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Ing\. Sebastian Cabascango/ }));

    await userEvent.click(screen.getByRole('button', { name: 'PDF' }));
    await waitFor(() => expect(descargas).toEqual([`parejas_por_tecnico_${DIA}.pdf`]));
    const tecnicos = 'tecnicos=Ing.+Jairo+Leal&tecnicos=Ing.+Sebastian+Cabascango';
    expect(getMock).toHaveBeenCalledWith(`/parejas-cda/reporte-tecnicos.pdf?fecha=${DIA}&${tecnicos}`, { responseType: 'blob' });

    await userEvent.click(screen.getByRole('button', { name: 'Excel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Contactos (.vcf)' }));
    await waitFor(() => expect(descargas).toHaveLength(3));
    expect(descargas.slice(1)).toEqual([`parejas_por_tecnico_${DIA}.xlsx`, `contactos_parejas_${DIA}.vcf`]);
    expect(getMock).toHaveBeenCalledWith(`/parejas-cda/contactos.vcf?fecha=${DIA}&${tecnicos}`, { responseType: 'blob' });
  });

  it('"Marcar todos" marca también "Sin técnico" y "Ninguno" desmarca', async () => {
    mockApi();
    const descargas = mockDescarga();
    renderModal();
    await userEvent.click(await screen.findByRole('button', { name: 'Marcar todos los técnicos' }));
    expect(screen.getByRole('status')).toHaveTextContent('4 marcado(s).');
    expect(screen.getAllByRole('checkbox').every((c) => (c as HTMLInputElement).checked)).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Excel' }));
    await waitFor(() => expect(descargas).toHaveLength(1));
    expect(getMock.mock.calls.at(-1)?.[0]).toContain('tecnicos=Ing.+Carlos+Ca%C3%B1ares&tecnicos=SIN_TECNICO');

    await userEvent.click(screen.getByRole('button', { name: 'Desmarcar todos los técnicos' }));
    expect(screen.getAllByRole('checkbox').some((c) => (c as HTMLInputElement).checked)).toBe(false);
  });

  it('distributivo vacío: lo dice en vez de dejar la ventana en blanco', async () => {
    mockApi([]);
    renderModal();
    expect(await screen.findByText('El distributivo de técnicos no tiene recintos.')).toBeInTheDocument();
  });

  it('si el Drive no responde, muestra el mensaje de la API', async () => {
    mockApi(new Error('No se pudo leer el distributivo de técnicos (Drive). Intente en unos minutos.'));
    renderModal();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo leer el distributivo de técnicos');
  });

  it('si la descarga falla, avisa con el mensaje de la API', async () => {
    mockApi();
    const base = getMock.getMockImplementation()!;
    getMock.mockImplementation((url: string, opts?: unknown) =>
      url.startsWith('/parejas-cda/contactos')
        ? Promise.reject({ response: { data: new Blob([JSON.stringify({ message: 'Los técnicos elegidos no tienen ningún contacto con celular este día' })]) } })
        : base(url, opts),
    );
    renderModal();
    await userEvent.click(await screen.findByRole('checkbox', { name: /Ing\. Carlos/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Contactos (.vcf)' }));
    await waitFor(() =>
      expect(sileo.error).toHaveBeenCalledWith({ title: 'Los técnicos elegidos no tienen ningún contacto con celular este día' }),
    );
  });
});
