import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CargoCda } from '@cne/shared-types';
import { ResumenSexo, sumarPorCentro } from './ResumenSexo';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn() } }));

const cargo = (clave: string, centro: 'CDA' | 'CPE') => ({ clave, centro, nombre: clave, activo: true, protegido: false, orden: 1, personas: 0 }) as CargoCda;
const CARGOS = [cargo('OPERADOR', 'CDA'), cargo('ASISTENTE', 'CDA'), cargo('DIGITADOR', 'CPE'), cargo('SUPERVISOR', 'CPE')];
const RESUMEN = [
  { grupo: 'ASISTENTE', hombres: 27, mujeres: 35, sinRegistrar: 0 },
  { grupo: 'DIGITADOR', hombres: 4, mujeres: 0, sinRegistrar: 0 },
  { grupo: 'OPERADOR', hombres: 27, mujeres: 36, sinRegistrar: 0 },
  { grupo: 'SUPERVISOR', hombres: 4, mujeres: 1, sinRegistrar: 1 },
  { grupo: 'DESCONOCIDO', hombres: 9, mujeres: 9, sinRegistrar: 9 },
];

describe('ResumenSexo', () => {
  it('suma cada cargo en su centro e ignora cargos que no conoce', () => {
    expect(sumarPorCentro(RESUMEN, CARGOS)).toEqual([
      ['CDA', { hombres: 54, mujeres: 71, sinRegistrar: 0 }],
      ['CPE', { hombres: 8, mujeres: 1, sinRegistrar: 1 }],
    ]);
  });

  it('muestra el total del personal activo por centro', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: RESUMEN });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ResumenSexo cargos={CARGOS} />
      </QueryClientProvider>,
    );
    const texto = await screen.findByText(/Personal activo por sexo/);
    expect(texto.parentElement).toHaveTextContent('CDA: 54 hombres · 71 mujeres — CPE: 8 hombres · 1 mujer · 1 sin sexo registrado');
    expect(api.get).toHaveBeenCalledWith('/operadores-cda/resumen-sexo');
  });
});
