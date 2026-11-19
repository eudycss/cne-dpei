import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DistribucionDiasDetalle } from '@cne/shared-types';

import { DistribucionDiasPanel } from './DistribucionDiasPanel';
import { getFotoOperadorCda, getIdsConFoto } from '../../lib/queries/operadores-cda';
import { getDistribucion, getDistribuciones, pedirContactosDistribucion, pedirReporteDistribucion } from '../../lib/queries/distribucion-dias';

vi.mock('../../lib/queries/distribucion-dias', () => ({
  getDistribuciones: vi.fn(),
  getDistribucion: vi.fn(),
  pedirReporteDistribucion: vi.fn(),
  pedirContactosDistribucion: vi.fn(),
  crearDistribucion: vi.fn(),
  regenerarDistribucion: vi.fn(),
  eliminarDistribucion: vi.fn(),
  quitarPersonaDistribucion: vi.fn(),
  agregarPersonaDistribucion: vi.fn(),
  editarPersonaDistribucion: vi.fn(),
  getCandidatosDistribucion: vi.fn(),
}));
vi.mock('../../lib/queries/custodia', () => ({ guardarArchivo: vi.fn() }));
vi.mock('sileo', () => ({ sileo: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../lib/queries/operadores-cda', () => ({ getIdsConFoto: vi.fn(), getFotoOperadorCda: vi.fn() }));
const permisos = { gestionar: true };
vi.mock('../../lib/useModulos', () => ({
  useModulos: () => ({ puede: (id: string) => id === 'cda.distribucion.gestionar' && permisos.gestionar }),
}));

const DIAS = ['2026-11-20', '2026-11-21', '2026-11-22'];
const detalle: DistribucionDiasDetalle = {
  id: 'd1',
  nombre: 'Fin de semana',
  fechas: DIAS,
  total: 2,
  creadoEn: '2026-11-18T12:00:00Z',
  excluirCargos: ['SUPERVISOR'],
  cantonCpe: 'IBARRA',
  encargadoCpe: 'Edison Mafla',
  totales: [
    { fecha: DIAS[0], hombres: 1, mujeres: 0, sinSexo: 0, total: 1 },
    { fecha: DIAS[1], hombres: 0, mujeres: 1, sinSexo: 0, total: 1 },
    { fecha: DIAS[2], hombres: 0, mujeres: 0, sinSexo: 0, total: 0 },
  ],
  personas: [
    { id: 'p1', fecha: DIAS[0], operadorId: 'o1', nombres: 'PÉREZ JUAN', cedula: '1003456785', telefono: '0991234567', sexo: 'M', cargo: 'Operadores CDA', canton: 'OTAVALO', encargado: 'Willy' },
    { id: 'p2', fecha: DIAS[1], operadorId: null, nombres: 'RUIZ ANA', cedula: '1712345675', telefono: null, sexo: 'F', cargo: 'Apoyo', canton: null, encargado: null },
  ],
  avisos: [],
};

function montar() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DistribucionDiasPanel />
    </QueryClientProvider>,
  );
}

describe('DistribucionDiasPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permisos.gestionar = true;
    (getDistribuciones as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'd1', nombre: 'Fin de semana', fechas: DIAS, total: 2, creadoEn: '' }]);
    (getDistribucion as ReturnType<typeof vi.fn>).mockResolvedValue(detalle);
    (pedirReporteDistribucion as ReturnType<typeof vi.fn>).mockResolvedValue({ data: new Blob(['x']) });
    URL.createObjectURL = vi.fn(() => 'blob:foto');
    URL.revokeObjectURL = vi.fn();
    (getIdsConFoto as ReturnType<typeof vi.fn>).mockResolvedValue(['o1']);
    (getFotoOperadorCda as ReturnType<typeof vi.fn>).mockResolvedValue(new Blob(['jpg'], { type: 'image/jpeg' }));
  });

  it('pide la foto solo de quien la tiene (la persona externa queda con iniciales)', async () => {
    montar();
    await screen.findByRole('table');
    await waitFor(() => expect(getFotoOperadorCda).toHaveBeenCalledWith('o1'));
    expect(getFotoOperadorCda).toHaveBeenCalledTimes(1);
    expect(getIdsConFoto).toHaveBeenCalledTimes(1);
  });

  it('muestra la tabla con cargo, cantón, encargado y marca a las personas externas', async () => {
    montar();
    const tabla = await screen.findByRole('table');
    expect(within(tabla).getByText('PÉREZ JUAN')).toBeInTheDocument();
    expect(within(tabla).getByText('Externa')).toBeInTheDocument();
    expect(within(tabla).getByText('Willy')).toBeInTheDocument();
    expect(screen.getByText(/1 persona\(s\) sin encargado/)).toBeInTheDocument();
  });

  it('filtra por día y exporta con ese filtro', async () => {
    montar();
    await screen.findByRole('table');
    await userEvent.selectOptions(screen.getByLabelText('Día'), DIAS[1]);
    expect(screen.queryByText('PÉREZ JUAN')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Excel' }));
    expect(pedirReporteDistribucion).toHaveBeenCalledWith('d1', 'xlsx', { fecha: DIAS[1], encargado: undefined });
  });

  it('sin permiso: solo consulta, sin botones de edición', async () => {
    permisos.gestionar = false;
    montar();
    await screen.findByRole('table');
    expect(screen.getByText(/Solo consulta/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agregar persona' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Editar a/ })).not.toBeInTheDocument();
  });

  it('baja los contactos .vcf de cada día y avisa quién no tiene celular', async () => {
    (pedirContactosDistribucion as ReturnType<typeof vi.fn>).mockResolvedValue({ data: new Blob(['BEGIN:VCARD']) });
    montar();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Contactos VIE20 (.vcf, 1)' }));
    expect(pedirContactosDistribucion).toHaveBeenCalledWith('d1', DIAS[0]);
    // Sábado: su única persona no tiene celular → nada que bajar, y se avisa quién falta.
    expect(screen.getByRole('button', { name: 'Contactos SAB21 (.vcf, 0)' })).toBeDisabled();
    expect(screen.getByText('RUIZ ANA (sin celular válido)')).toBeInTheDocument();
    expect(screen.queryByText(/VIE20: no van en el archivo/)).not.toBeInTheDocument();
  });
});
