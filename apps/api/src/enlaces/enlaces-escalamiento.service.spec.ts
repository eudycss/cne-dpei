import { ArchivoDriveNoConfigurado } from './drive-excel';
import { agruparPorZona, EnlacesEscalamientoService, esInestable } from './enlaces-escalamiento.service';
import type { AlertaRecinto } from './telegram-notifier';

const iso = (s: string) => new Date(s);
const AHORA = iso('2026-10-21T15:00:00Z');

const alerta = (codigo: string, inicio: string, extra: Partial<AlertaRecinto> = {}): AlertaRecinto => ({
  codigoRecinto: codigo,
  nombreRecinto: `Recinto ${codigo}`,
  canton: 'Otavalo',
  parroquia: '',
  inicio: iso(inicio),
  minutosCaido: Math.round((AHORA.getTime() - iso(inicio).getTime()) / 60_000),
  aviso: 1,
  caidas24h: 1,
  caidas7d: 1,
  inestable: false,
  encargado: null,
  ...extra,
});

describe('esInestable', () => {
  it.each([
    [1, 1, false],
    [2, 4, false],
    [3, 3, true],
    [1, 5, true],
  ])('%i caídas en 24 h y %i en 7 días → %s', (c24, c7, esperado) => {
    expect(esInestable(c24, c7)).toBe(esperado);
  });
});

describe('agruparPorZona', () => {
  it('2 o más recintos de la misma parroquia caídos con menos de 10 min de diferencia son un posible corte de zona', () => {
    const grupos = agruparPorZona([
      alerta('1', '2026-10-21T14:00:00Z', { parroquia: 'Quiroga', canton: 'Cotacachi' }),
      alerta('2', '2026-10-21T14:08:00Z', { parroquia: 'QUIROGA', canton: 'Cotacachi' }),
      alerta('3', '2026-10-21T14:20:00Z', { parroquia: 'Imantag', canton: 'Cotacachi' }),
    ]);

    expect(grupos).toEqual([
      { zona: 'Quiroga', recintos: [expect.objectContaining({ codigoRecinto: '1' }), expect.objectContaining({ codigoRecinto: '2' })] },
      { zona: null, recintos: [expect.objectContaining({ codigoRecinto: '3' })] },
    ]);
  });

  it('en la misma parroquia pero con más de 10 min entre una y otra, van por separado', () => {
    const grupos = agruparPorZona([
      alerta('1', '2026-10-21T14:00:00Z', { parroquia: 'Quiroga' }),
      alerta('2', '2026-10-21T14:11:00Z', { parroquia: 'Quiroga' }),
    ]);

    expect(grupos.map((g) => g.zona)).toEqual([null, null]);
  });

  it('una cadena de caídas cercanas (cada una a menos de 10 min de la anterior) es una sola zona', () => {
    const grupos = agruparPorZona([
      alerta('1', '2026-10-21T14:00:00Z'),
      alerta('2', '2026-10-21T14:09:00Z'),
      alerta('3', '2026-10-21T14:18:00Z'),
    ]);

    expect(grupos).toHaveLength(1);
    expect(grupos[0].zona).toBe('Otavalo');
    expect(grupos[0].recintos).toHaveLength(3);
  });

  it('una parroquia no se junta con recintos sin parroquia de un cantón del mismo nombre', () => {
    const grupos = agruparPorZona([
      alerta('1', '2026-10-21T14:00:00Z', { parroquia: 'Cotacachi', canton: 'Cotacachi' }),
      alerta('2', '2026-10-21T14:01:00Z', { parroquia: '', canton: 'Cotacachi' }),
    ]);

    expect(grupos.map((g) => g.zona)).toEqual([null, null]);
  });

  it('sin parroquia agrupa por cantón; sin ninguno de los dos, nunca agrupa', () => {
    const grupos = agruparPorZona([
      alerta('1', '2026-10-21T14:00:00Z', { canton: '' }),
      alerta('2', '2026-10-21T14:01:00Z', { canton: '' }),
    ]);

    expect(grupos.map((g) => g.zona)).toEqual([null, null]);
  });

  it('primero las zonas y luego los sueltos, de más a menos tiempo caído', () => {
    const grupos = agruparPorZona([
      alerta('9', '2026-10-21T14:25:00Z', { canton: 'Ibarra' }),
      alerta('8', '2026-10-21T13:00:00Z', { canton: 'Pimampiro' }),
      alerta('1', '2026-10-21T14:00:00Z'),
      alerta('2', '2026-10-21T14:05:00Z'),
    ]);

    expect(grupos.map((g) => g.recintos.map((r) => r.codigoRecinto))).toEqual([['1', '2'], ['8'], ['9']]);
  });
});

describe('EnlacesEscalamientoService', () => {
  const prisma = {
    enlaceCaida: {
      findMany: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const telegram = { enviarEscalamiento: jest.fn().mockResolvedValue(undefined) };
  const encargados = { encargados: jest.fn() };
  const distributivo = { asignaciones: jest.fn() };
  const service = new EnlacesEscalamientoService(
    prisma as never,
    telegram as never,
    encargados as never,
    distributivo as never,
  );

  const caida = (id: string, codigo: string, inicio: string, avisos = 0) => ({
    id,
    codigoRecinto: codigo,
    nombreRecinto: `Recinto ${codigo}`,
    canton: 'Cotacachi',
    inicio: iso(inicio),
    avisos,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    encargados.encargados.mockResolvedValue(new Map([['1961', { nombre: 'Ana Pérez', telefono: '+593 99 000 0000' }]]));
    distributivo.asignaciones.mockResolvedValue([
      { codigoRecinto: '1961', localidad: '', parroquia: 'Quiroga', numeroTecnico: 1, tecnico: 'X' },
    ]);
  });

  it('busca las caídas abiertas hace 30 min o más que no se avisaron en los últimos 30 min (1 min de margen por el cron)', async () => {
    prisma.enlaceCaida.findMany.mockResolvedValueOnce([]);

    await service.escalar(AHORA);

    const limite = iso('2026-10-21T14:31:00Z');
    expect(prisma.enlaceCaida.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { fin: null, inicio: { lte: limite }, OR: [{ ultimoAviso: null }, { ultimoAviso: { lte: limite } }] },
      }),
    );
    expect(telegram.enviarEscalamiento).not.toHaveBeenCalled();
    expect(prisma.enlaceCaida.updateMany).not.toHaveBeenCalled();
  });

  it('avisa con el encargado, la parroquia, cuántas veces se cayó y marca el aviso', async () => {
    prisma.enlaceCaida.findMany
      .mockResolvedValueOnce([caida('c1', '1961', '2026-10-21T14:25:00Z', 1)])
      .mockResolvedValueOnce([
        { codigoRecinto: '1961', inicio: iso('2026-10-21T14:25:00Z') },
        { codigoRecinto: '1961', inicio: iso('2026-10-21T10:00:00Z') },
        { codigoRecinto: '1961', inicio: iso('2026-10-21T08:00:00Z') },
        { codigoRecinto: '1961', inicio: iso('2026-10-17T08:00:00Z') },
      ]);

    await service.escalar(AHORA);

    const [grupos] = telegram.enviarEscalamiento.mock.calls[0];
    expect(grupos).toEqual([
      {
        zona: null,
        recintos: [
          expect.objectContaining({
            codigoRecinto: '1961',
            parroquia: 'Quiroga',
            minutosCaido: 35,
            aviso: 2,
            caidas24h: 3,
            caidas7d: 4,
            inestable: true,
            encargado: { nombre: 'Ana Pérez', telefono: '+593 99 000 0000' },
          }),
        ],
      },
    ]);
    expect(prisma.enlaceCaida.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['c1'] } },
      data: { ultimoAviso: AHORA, avisos: { increment: 1 } },
    });
  });

  it('sin archivo de encargados (o si Drive falla) avisa igual, sin encargado', async () => {
    encargados.encargados.mockRejectedValueOnce(new ArchivoDriveNoConfigurado('ENCARGADOS_RECINTOS_DRIVE_ID'));
    distributivo.asignaciones.mockRejectedValueOnce(new Error('Drive caído'));
    prisma.enlaceCaida.findMany.mockResolvedValueOnce([caida('c1', '1961', '2026-10-21T14:00:00Z')]).mockResolvedValueOnce([]);

    await service.escalar(AHORA);

    const [grupos] = telegram.enviarEscalamiento.mock.calls[0];
    expect(grupos[0].recintos[0]).toEqual(expect.objectContaining({ encargado: null, parroquia: '' }));
    expect(prisma.enlaceCaida.updateMany).toHaveBeenCalled();
  });

  it('marca el aviso antes de enviarlo: si la base falla, no sale nada (no se repite cada 5 min)', async () => {
    prisma.enlaceCaida.findMany.mockResolvedValueOnce([caida('c1', '1961', '2026-10-21T14:00:00Z')]).mockResolvedValueOnce([]);
    prisma.enlaceCaida.updateMany.mockRejectedValueOnce(new Error('base caída'));

    await expect(service.escalar(AHORA)).resolves.toBeUndefined();
    expect(telegram.enviarEscalamiento).not.toHaveBeenCalled();
  });

  it('si el ciclo anterior sigue en curso, no se solapa (evita avisos duplicados) y luego sigue normal', async () => {
    let liberar!: () => void;
    prisma.enlaceCaida.findMany
      .mockReturnValueOnce(new Promise((r) => (liberar = () => r([]))))
      .mockResolvedValueOnce([]);

    const primero = service.escalar(AHORA);
    await service.escalar(AHORA);
    expect(prisma.enlaceCaida.findMany).toHaveBeenCalledTimes(1);

    liberar();
    await primero;
    await service.escalar(AHORA);
    expect(prisma.enlaceCaida.findMany).toHaveBeenCalledTimes(2);
  });

  it('un error de la base no lanza (no frena el resto del cron) ni marca avisos', async () => {
    prisma.enlaceCaida.findMany.mockRejectedValueOnce(new Error('base caída'));

    await expect(service.escalar(AHORA)).resolves.toBeUndefined();
    expect(telegram.enviarEscalamiento).not.toHaveBeenCalled();
    expect(prisma.enlaceCaida.updateMany).not.toHaveBeenCalled();
  });
});
