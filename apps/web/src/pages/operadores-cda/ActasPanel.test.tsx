import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ActaCdaFila, ActaEntregaCda, OperadorCda, PersonaEntregaCda } from '@cne/shared-types';

import { ActasPanel } from './ActasPanel';
import { api } from '../../lib/api';
import { nombreDeDescarga } from '../../lib/queries/operadores-cda';
import { sileo } from 'sileo';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('sileo', () => ({ sileo: { error: vi.fn(), success: vi.fn() } }));
const roles = vi.hoisted(() => ({ actuales: ['ADMINISTRADOR'] as string[] }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { roles: roles.actuales } }) }));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const postMock = api.post as unknown as ReturnType<typeof vi.fn>;

const operador = (id: string, apellidosNombres: string, cedula: string): OperadorCda => ({
  id,
  numero: null,
  apellidosNombres,
  cedula,
  telefono: null,
  cargo: 'OPERADOR CDA',
  unidad: null,
  fechaInicio: null,
  tieneFoto: false,
  activo: true,
  creadoEn: '2026-10-20T10:00:00.000Z',
});

const acta = (operadorId: string, estado: ActaEntregaCda['estado']): ActaEntregaCda => ({
  id: `acta-${operadorId}`,
  operadorId,
  entregaUsuarioId: 'u1',
  entregaNombre: 'William Paspuel',
  entregaCedula: '1001001005',
  entregaCargo: 'Analista',
  lugar: 'Ibarra',
  fecha: '2026-10-22',
  estadoPeto: 'BUENO',
  estadoCredencial: 'NUEVO',
  estadoCordon: 'BUENO',
  estado,
  firmadaEn: estado === 'FIRMADA' ? '2026-10-22T20:00:00.000Z' : null,
  actualizadoEn: '2026-10-22T15:00:00.000Z',
});

const ID = {
  a: 'aaaaaaaa-1111-4111-8111-111111111111',
  l: 'bbbbbbbb-1111-4111-8111-111111111111',
  m: 'cccccccc-1111-4111-8111-111111111111',
};
const ANA = operador(ID.a, 'ANDRADE LÓPEZ ANA MARÍA', '1710034065');
const LUIS = operador(ID.l, 'VEGA TAPIA LUIS ALBERTO', '1002003000');
const MARIA = operador(ID.m, 'CHÁVEZ MORA MARÍA JOSÉ', '0102030400');

const FILAS: ActaCdaFila[] = [
  { operador: ANA, acta: acta(ID.a, 'GENERADA') },
  { operador: LUIS, acta: null },
  { operador: MARIA, acta: acta(ID.m, 'FIRMADA') },
];

const PERSONAS: PersonaEntregaCda[] = [
  { usuarioId: '11111111-2222-4333-8444-555555555555', nombre: 'Willy Paspuel', cedula: '1001001005', cargoSugerido: 'Analista Provincial de Seguridad Informática y Proyectos Tecnológicos Electorales 1' },
  { usuarioId: '22222222-2222-4333-8444-555555555555', nombre: 'Jairo Leal', cedula: '1710034065', cargoSugerido: 'Asistente Electoral Transversal' },
];

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ActasPanel />
    </QueryClientProvider>,
  );
}

const filaDe = (nombre: string) => screen.getByRole('rowheader', { name: new RegExp(nombre) }).closest('tr')!;

describe('ActasPanel', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    roles.actuales = ['ADMINISTRADOR'];
    getMock.mockImplementation((url: string) =>
      Promise.resolve({ data: url === '/operadores-cda/actas/entregan' ? PERSONAS : FILAS }),
    );
  });

  it('muestra el estado de cada acta, los indicadores y filtra', async () => {
    renderPanel();
    await screen.findByText('ANDRADE LÓPEZ ANA MARÍA');
    expect(within(filaDe('ANDRADE')).getByText('Por firmar')).toBeInTheDocument();
    expect(within(filaDe('VEGA')).getByText('Sin acta')).toBeInTheDocument();
    expect(within(filaDe('CHÁVEZ')).getByText('Firmada')).toBeInTheDocument();
    expect(screen.getByText('2 / 3')).toBeInTheDocument(); // generadas

    await userEvent.click(screen.getByRole('button', { name: /Sin acta · 1/ }));
    expect(screen.queryByText('ANDRADE LÓPEZ ANA MARÍA')).not.toBeInTheDocument();
    expect(screen.getByText('VEGA TAPIA LUIS ALBERTO')).toBeInTheDocument();
  });

  it('firmada: sin Corregir ni Marcar firmada; el administrador la puede reabrir', async () => {
    renderPanel();
    await screen.findByText('CHÁVEZ MORA MARÍA JOSÉ');
    const maria = within(filaDe('CHÁVEZ'));
    expect(maria.queryByRole('button', { name: /Corregir/ })).not.toBeInTheDocument();
    expect(maria.queryByRole('button', { name: /Marcar firmada/ })).not.toBeInTheDocument();

    postMock.mockResolvedValue({ data: acta(ID.m, 'GENERADA') });
    await userEvent.click(maria.getByRole('button', { name: /Reabrir/ }));
    expect(postMock).toHaveBeenCalledWith(`/operadores-cda/${ID.m}/acta/reabrir`);
  });

  it('un técnico no ve Reabrir', async () => {
    roles.actuales = ['ASISTENTE_TRANSVERSAL'];
    renderPanel();
    await screen.findByText('CHÁVEZ MORA MARÍA JOSÉ');
    expect(within(filaDe('CHÁVEZ')).queryByRole('button', { name: /Reabrir/ })).not.toBeInTheDocument();
  });

  it('marca como firmada y avisa', async () => {
    postMock.mockResolvedValue({ data: acta(ID.a, 'FIRMADA') });
    renderPanel();
    await screen.findByText('ANDRADE LÓPEZ ANA MARÍA');
    await userEvent.click(within(filaDe('ANDRADE')).getByRole('button', { name: /Marcar firmada/ }));
    expect(postMock).toHaveBeenCalledWith(`/operadores-cda/${ID.a}/acta/firmar`);
    await waitFor(() => expect(sileo.success).toHaveBeenCalled());
  });

  it('el ZIP solo incluye a los elegidos que ya tienen acta', async () => {
    postMock.mockResolvedValue({ data: new Blob(['zip']), headers: {} });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    renderPanel();
    await screen.findByText('ANDRADE LÓPEZ ANA MARÍA');
    expect(screen.getByRole('button', { name: 'Descargar ZIP (0)' })).toBeDisabled();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Elegir todos los operadores mostrados' }));
    expect(screen.getByRole('button', { name: 'Generar actas (3)' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Descargar ZIP (2)' }));
    expect(postMock).toHaveBeenCalledWith(
      '/operadores-cda/actas/zip',
      { operadorIds: [ID.a, ID.m] },
      { responseType: 'blob' },
    );
  });

  // Escribir con userEvent es lento en CI: más margen que los 5 s por defecto.
  it('descarga el PDF de una fila con el nombre de archivo que manda la API', async () => {
    getMock.mockImplementation((url: string) =>
      url.endsWith('/acta.pdf')
        ? Promise.resolve({ data: new Blob(['%PDF']), headers: { 'content-disposition': 'attachment; filename="acta-andrade-4065.pdf"' } })
        : Promise.resolve({ data: FILAS }),
    );
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    let descargado = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      descargado = this.download;
    });
    renderPanel();
    await screen.findByText('ANDRADE LÓPEZ ANA MARÍA');
    await userEvent.click(within(filaDe('ANDRADE')).getByRole('button', { name: /PDF del acta de ANDRADE/ }));
    await waitFor(() => expect(descargado).toBe('acta-andrade-4065.pdf'));
    expect(getMock).toHaveBeenCalledWith(`/operadores-cda/${ID.a}/acta.pdf`, { responseType: 'blob' });
  });

  it('si la descarga falla, avisa con el mensaje de la API', async () => {
    getMock.mockImplementation((url: string) =>
      url.endsWith('/acta.docx')
        ? Promise.reject({ response: { data: { message: 'El operador aún no tiene acta generada' } } })
        : Promise.resolve({ data: FILAS }),
    );
    renderPanel();
    await screen.findByText('ANDRADE LÓPEZ ANA MARÍA');
    await userEvent.click(within(filaDe('ANDRADE')).getByRole('button', { name: /Word del acta/ }));
    await waitFor(() => expect(sileo.error).toHaveBeenCalledWith({ title: 'El operador aún no tiene acta generada' }));
  });

  describe('ventana Generar actas', { timeout: 20_000 }, () => {
    async function abrirParaVega() {
      renderPanel();
      await screen.findByText('VEGA TAPIA LUIS ALBERTO');
      await userEvent.click(within(filaDe('VEGA')).getByRole('button', { name: /Generar/ }));
      return screen.findByRole('dialog');
    }

    it('al elegir quién entrega se llenan nombre, cédula (fija) y cargo; se envía todo', async () => {
      postMock.mockResolvedValue({ data: { generadas: 1, actualizadas: 0, omitidasFirmadas: 0, ignorados: 0 } });
      const dialogo = within(await abrirParaVega());
      await screen.findByRole('option', { name: 'Willy Paspuel' });
      await userEvent.selectOptions(dialogo.getByLabelText('Entrega (Ing.)'), PERSONAS[0].usuarioId);

      const nombre = dialogo.getByLabelText('Nombre completo');
      expect(nombre).toHaveValue('Willy Paspuel');
      expect(dialogo.getByLabelText('Cédula')).toHaveAttribute('readonly');
      expect(dialogo.getByLabelText('Cargo')).toHaveValue(PERSONAS[0].cargoSugerido);
      // El nombre se puede completar para el acta.
      await userEvent.clear(nombre);
      await userEvent.type(nombre, 'William Paspuel');
      await userEvent.selectOptions(dialogo.getByLabelText('Peto'), 'REGULAR');

      await userEvent.click(dialogo.getByRole('button', { name: 'Generar 1 acta(s)' }));
      await waitFor(() => expect(postMock).toHaveBeenCalled());
      expect(postMock.mock.calls[0][0]).toBe('/operadores-cda/actas');
      expect(postMock.mock.calls[0][1]).toMatchObject({
        operadorIds: [ID.l],
        entregaUsuarioId: PERSONAS[0].usuarioId,
        entregaNombre: 'William Paspuel',
        entregaCedula: '1001001005',
        lugar: 'Ibarra',
        estadoPeto: 'REGULAR',
        estadoCredencial: 'NUEVO',
        estadoCordon: 'BUENO',
      });
      expect(postMock.mock.calls[0][1]).not.toHaveProperty('quien');
    });

    it('sin elegir quién entrega no envía y lo indica', async () => {
      const dialogo = within(await abrirParaVega());
      await userEvent.click(dialogo.getByRole('button', { name: 'Generar 1 acta(s)' }));
      expect(dialogo.getByText('Elija quién entrega')).toBeInTheDocument();
      expect(dialogo.getByLabelText('Entrega (Ing.)')).toHaveAttribute('aria-invalid', 'true');
      // El error se anuncia y el foco va al campo para corregirlo.
      expect(dialogo.getByRole('alert')).toHaveTextContent('Revise el campo marcado.');
      expect(dialogo.getByLabelText('Entrega (Ing.)')).toHaveFocus();
      expect(dialogo.getByLabelText('Entrega (Ing.)')).toHaveAccessibleDescription('Elija quién entrega');
      expect(postMock).not.toHaveBeenCalled();
    });

    it('"Otra persona": cédula editable y validada antes de enviar', async () => {
      const dialogo = within(await abrirParaVega());
      await userEvent.selectOptions(dialogo.getByLabelText('Entrega (Ing.)'), 'otra');
      await userEvent.type(dialogo.getByLabelText('Nombre completo'), 'Técnico de Enlaces');
      await userEvent.type(dialogo.getByLabelText('Cédula'), '17100340AB66');
      expect(dialogo.getByLabelText('Cédula')).toHaveValue('1710034066');
      await userEvent.type(dialogo.getByLabelText('Cargo'), 'Asistente Electoral Transversal');
      await userEvent.click(dialogo.getByRole('button', { name: 'Generar 1 acta(s)' }));
      expect(dialogo.getByText('Cédula ecuatoriana inválida')).toBeInTheDocument();
      expect(postMock).not.toHaveBeenCalled();
    });
  });
});

describe('nombreDeDescarga', () => {
  it('toma el nombre de Content-Disposition o usa el de respaldo', () => {
    expect(nombreDeDescarga('attachment; filename="acta-vega-3000.pdf"', 'x.pdf')).toBe('acta-vega-3000.pdf');
    expect(nombreDeDescarga(undefined, 'x.pdf')).toBe('x.pdf');
  });
});
