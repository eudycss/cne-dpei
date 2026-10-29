import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ImportOperadoresCdaResult } from '@cne/shared-types';

import { ImportarOperadoresModal } from './ImportarOperadoresModal';
import { api } from '../../lib/api';
import { sileo } from 'sileo';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('sileo', () => ({ sileo: { error: vi.fn(), success: vi.fn() } }));

const postMock = api.post as unknown as ReturnType<typeof vi.fn>;

function resultado(over: Partial<ImportOperadoresCdaResult> = {}): ImportOperadoresCdaResult {
  return {
    vistaPrevia: true,
    nuevos: 1,
    actualizados: 1,
    filas: [
      { fila: 10, apellidosNombres: 'PÉREZ LÓPEZ ANA', cedula: '1710034065', telefono: '0987923273', cargo: 'OPERADOR CDA', accion: 'NUEVO' },
      { fila: 11, apellidosNombres: 'RUIZ MORA JUAN', cedula: '1002003000', cargo: 'OPERADOR CDA', accion: 'ACTUALIZAR' },
    ],
    errores: [],
    ...over,
  };
}

const archivo = () => new File(['x'], 'operadores.xlsx');

function renderModal(onClose = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ImportarOperadoresModal onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

describe('ImportarOperadoresModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('muestra la vista previa al elegir el archivo y guarda solo al confirmar', async () => {
    postMock.mockResolvedValueOnce({ data: resultado() }).mockResolvedValueOnce({ data: resultado({ vistaPrevia: false }) });
    const { onClose } = renderModal();

    await userEvent.upload(screen.getByLabelText('Archivo (.xlsx)'), archivo());

    expect(await screen.findByText('PÉREZ LÓPEZ ANA')).toBeInTheDocument();
    expect(screen.getByText('Actualizar')).toBeInTheDocument();
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock.mock.calls[0][0]).toBe('/operadores-cda/importar?grupo=OPERADOR');

    await userEvent.click(screen.getByRole('button', { name: 'Importar 2 operador(es)' }));

    expect(postMock.mock.calls[1][0]).toBe('/operadores-cda/importar?grupo=OPERADOR&aplicar=true');
    expect(sileo.success).toHaveBeenCalledWith({ title: 'Importación lista: 1 nuevo(s), 1 actualizado(s).' });
    expect(onClose).toHaveBeenCalled();
  });

  it('si la API creó o vinculó cuentas de la app, lo dice en el aviso', async () => {
    postMock
      .mockResolvedValueOnce({ data: resultado() })
      .mockResolvedValueOnce({ data: resultado({ vistaPrevia: false, cuentas: { creadas: 1, vinculadas: 1, fallidas: 0 } }) });
    renderModal();

    await userEvent.upload(screen.getByLabelText('Archivo (.xlsx)'), archivo());
    await userEvent.click(await screen.findByRole('button', { name: 'Importar 2 operador(es)' }));

    await waitFor(() =>
      expect(sileo.success).toHaveBeenCalledWith({
        title: 'Importación lista: 1 nuevo(s), 1 actualizado(s).',
        description: 'Cuentas de la app: 1 creada(s) y 1 vinculada(s).',
      }),
    );
  });

  it('si algunas cuentas fallaron, avisa que se completan con "Cuentas de la app"', async () => {
    postMock
      .mockResolvedValueOnce({ data: resultado() })
      .mockResolvedValueOnce({ data: resultado({ vistaPrevia: false, cuentas: { creadas: 1, vinculadas: 0, fallidas: 1 } }) });
    renderModal();

    await userEvent.upload(screen.getByLabelText('Archivo (.xlsx)'), archivo());
    await userEvent.click(await screen.findByRole('button', { name: 'Importar 2 operador(es)' }));

    await waitFor(() =>
      expect(sileo.success).toHaveBeenCalledWith({
        title: 'Importación lista: 1 nuevo(s), 1 actualizado(s).',
        description:
          'Cuentas de la app: 1 creada(s) y 0 vinculada(s). 1 no se pudo crear: complétela en “Cuentas de la app”.',
      }),
    );
  });

  it('mientras lee un archivo no deja elegir otro (la vista previa siempre es del archivo a importar)', async () => {
    let resolver!: (v: unknown) => void;
    postMock.mockReturnValueOnce(new Promise((r) => (resolver = r)));
    renderModal();
    const input = screen.getByLabelText('Archivo (.xlsx)');

    await userEvent.upload(input, archivo());
    expect(input).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Leyendo el archivo…');

    resolver({ data: resultado() });
    expect(await screen.findByText('PÉREZ LÓPEZ ANA')).toBeInTheDocument();
    await waitFor(() => expect(input).toBeEnabled());
    // La tabla de vista previa se puede recorrer con el teclado.
    expect(screen.getByRole('region', { name: 'Vista previa de la importación' })).toHaveAttribute('tabindex', '0');
  });

  it('con filas con errores las lista y no deja importar', async () => {
    postMock.mockResolvedValueOnce({
      data: resultado({ errores: [{ fila: 12, error: 'cedula: Cédula ecuatoriana inválida' }] }),
    });
    renderModal();

    await userEvent.upload(screen.getByLabelText('Archivo (.xlsx)'), archivo());

    expect(await screen.findByRole('alert')).toHaveTextContent('Cédula ecuatoriana inválida');
    expect(screen.getByText('Fila 12:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Importar 2 operador(es)' })).toBeDisabled();
  });

  it('muestra el mensaje de la API si el archivo no se puede leer', async () => {
    postMock.mockRejectedValueOnce({ response: { data: { message: 'No se encontró la fila de encabezados' } } });
    renderModal();

    await userEvent.upload(screen.getByLabelText('Archivo (.xlsx)'), archivo());

    expect(await screen.findByRole('alert')).toHaveTextContent('No se encontró la fila de encabezados');
    expect(screen.getByRole('button', { name: /Importar/ })).toBeDisabled();
  });
});
