import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { tokenCredencialQrCdaSchema } from '@cne/shared-validation';

import { CredencialQrCdaService, MIN_MINUTOS_SALIDA_QR, generarTokenCredencial } from './credencial-qr-cda.service';
import { hashToken } from './foto-cda.service';
import * as carnetPdf from './carnet-cda.pdf';
import { CifradoTokenCarnet } from './cifrado-token-carnet';

const OP = '11111111-2222-4333-8444-555555555555';
const USR = '99999999-2222-4333-8444-555555555555';
// 23-oct-2026 08:20 en Ecuador.
const AHORA = new Date('2026-10-23T13:20:00Z');
const HOY = new Date('2026-10-23T00:00:00Z');
const TOKEN = `CDA1${'ABCDEFGHJKLMN'.repeat(2)}`;

const operador = (over: Record<string, unknown> = {}) => ({
  id: OP,
  grupo: 'OPERADOR',
  numero: 1,
  apellidosNombres: 'PÉREZ LÓPEZ ANA MARÍA',
  cedula: '1710034065',
  telefono: null,
  cargo: 'OPERADOR CDA - DIGITALIZACIÓN',
  unidad: null,
  fechaInicio: null,
  fotoKey: 'fotos/ana.bin',
  activo: true,
  creadoEn: new Date('2026-10-20T10:00:00Z'),
  ...over,
});

describe('CredencialQrCdaService', () => {
  const prisma = {
    operadorCda: { findMany: jest.fn() },
    credencialQrCda: { findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn(), createMany: jest.fn() },
    asistenciaCda: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const asistencia = { marcar: jest.fn() };
  const storage = { readDecrypted: jest.fn() };
  const cifrado = new CifradoTokenCarnet({ get: () => 'c'.repeat(64) } as never);
  const sinClave = new CifradoTokenCarnet({ get: () => undefined } as never);
  let service: CredencialQrCdaService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: AHORA, doNotFake: ['nextTick', 'setImmediate'] });
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
    service = new CredencialQrCdaService(prisma as never, asistencia as never, storage as never, cifrado);
  });

  afterEach(() => jest.useRealTimers());

  const conCredencial = (over: Record<string, unknown> = {}) =>
    prisma.credencialQrCda.findUnique.mockResolvedValueOnce({ revocadaEn: null, operador: operador(), ...over });

  it('genera tokens con el formato que valida la web y la API, distintos cada vez', () => {
    const tokens = new Set(Array.from({ length: 200 }, generarTokenCredencial));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(tokenCredencialQrCdaSchema.parse(t)).toBe(t);
  });

  describe('carnetsPdf (emitir)', () => {
    it('anula el carnet anterior, guarda solo el hash del nuevo y devuelve el PDF', async () => {
      prisma.operadorCda.findMany.mockResolvedValueOnce([operador()]);
      storage.readDecrypted.mockResolvedValueOnce(Buffer.from('no es jpeg'));

      const pdf = await service.carnetsPdf([OP, OP], USR);

      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(prisma.operadorCda.findMany.mock.calls[0][0].where).toEqual({ id: { in: [OP] }, activo: true });
      expect(prisma.credencialQrCda.updateMany).toHaveBeenCalledWith({
        where: { operadorId: { in: [OP] }, revocadaEn: null },
        data: { revocadaEn: AHORA, motivoRevocacion: 'REEMITIDA' },
      });
      const [guardado] = prisma.credencialQrCda.createMany.mock.calls[0][0].data;
      expect(guardado).toEqual({
        operadorId: OP,
        tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        tokenCifrado: expect.stringMatching(/^v1:/),
        emitidaEn: AHORA,
        emitidaPorId: USR,
      });
      // El cifrado guardado es el mismo token del hash (el que va impreso).
      expect(hashToken(cifrado.descifrar(guardado.tokenCifrado, OP)!)).toBe(guardado.tokenHash);
    });

    it('si el PDF falla, no se anula ni se guarda nada (los carnets vigentes siguen sirviendo)', async () => {
      prisma.operadorCda.findMany.mockResolvedValueOnce([operador()]);
      const espia = jest.spyOn(carnetPdf, 'carnetsPdf').mockRejectedValueOnce(new Error('sin memoria'));

      await expect(service.carnetsPdf([OP], USR)).rejects.toThrow('sin memoria');

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.credencialQrCda.updateMany).not.toHaveBeenCalled();
      espia.mockRestore();
    });

    it('sin operadores activos: 404', async () => {
      prisma.operadorCda.findMany.mockResolvedValueOnce([]);
      await expect(service.carnetsPdf([OP], USR)).rejects.toThrow(NotFoundException);
    });

    it('dos emisiones a la vez para el mismo operador: 409 en vez de error 500', async () => {
      prisma.operadorCda.findMany.mockResolvedValueOnce([operador({ fotoKey: null })]);
      prisma.credencialQrCda.createMany.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
      await expect(service.carnetsPdf([OP], USR)).rejects.toThrow(ConflictException);
    });

    it('el PDF sale aunque una foto no se pueda leer', async () => {
      prisma.operadorCda.findMany.mockResolvedValueOnce([operador(), operador({ id: 'o2', fotoKey: null })]);
      storage.readDecrypted.mockRejectedValueOnce(new Error('storage caído'));

      const pdf = await service.carnetsPdf([OP, 'o2'], USR);

      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(storage.readDecrypted).toHaveBeenCalledTimes(1);
      expect(prisma.credencialQrCda.createMany.mock.calls[0][0].data).toHaveLength(2);
    });
  });

  describe('reimprimirPdf (sin anular)', () => {
    const vigente = (over: Record<string, unknown> = {}) => ({
      tokenHash: hashToken(TOKEN),
      tokenCifrado: cifrado.cifrar(TOKEN, OP),
      emitidaEn: new Date('2026-10-20T15:00:00Z'),
      ...over,
    });

    it('reimprime con el mismo código y la fecha de emisión original, sin anular ni guardar nada', async () => {
      prisma.operadorCda.findMany.mockResolvedValueOnce([operador({ fotoKey: null, credenciales: [vigente()] })]);
      const espia = jest.spyOn(carnetPdf, 'carnetsPdf');

      const pdf = await service.reimprimirPdf([OP, OP]);

      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(prisma.operadorCda.findMany.mock.calls[0][0]).toMatchObject({
        where: { id: { in: [OP] }, activo: true },
        include: { credenciales: { where: { revocadaEn: null }, take: 1 } },
      });
      expect(espia.mock.calls[0][0][0]).toMatchObject({ token: TOKEN, emitidoEn: new Date('2026-10-20T15:00:00Z') });
      expect(prisma.credencialQrCda.updateMany).not.toHaveBeenCalled();
      expect(prisma.credencialQrCda.createMany).not.toHaveBeenCalled();
      espia.mockRestore();
    });

    it('un carnet emitido antes (sin cifrado), de otra clave o que no coincide con el hash: 409 y no sale ninguno', async () => {
      const otraClave = new CifradoTokenCarnet({ get: () => 'd'.repeat(64) } as never);
      const casos = [
        vigente({ tokenCifrado: null }),
        vigente({ tokenCifrado: otraClave.cifrar(TOKEN, OP) }),
        vigente({ tokenHash: hashToken('CDA1OTRO') }),
      ];
      for (const c of casos) {
        prisma.operadorCda.findMany.mockResolvedValueOnce([
          operador({ id: 'o2', apellidosNombres: 'BUENO', credenciales: [vigente({ tokenCifrado: cifrado.cifrar(TOKEN, 'o2') })] }),
          operador({ credenciales: [c] }),
        ]);
        // Solo se nombra al que no se puede; el otro sí se podía, pero no sale nadie.
        await expect(service.reimprimirPdf([OP, 'o2'])).rejects.toThrow(/una última vez: PÉREZ LÓPEZ ANA MARÍA$/);
      }
    });

    it('si alguno de los pedidos ya no está activo, no sale ninguno (404)', async () => {
      prisma.operadorCda.findMany.mockResolvedValueOnce([operador({ credenciales: [vigente()] })]);
      await expect(service.reimprimirPdf([OP, 'oculto'])).rejects.toThrow('1 de las personas elegidas ya no está activa');
    });

    it('sin carnet vigente: 409; nadie activo: 404', async () => {
      prisma.operadorCda.findMany.mockResolvedValueOnce([operador({ credenciales: [] })]);
      await expect(service.reimprimirPdf([OP])).rejects.toThrow('Sin carnet vigente (emítalo primero): PÉREZ');
      prisma.operadorCda.findMany.mockResolvedValueOnce([]);
      await expect(service.reimprimirPdf([OP])).rejects.toThrow(NotFoundException);
    });

    it('sin CARNET_TOKEN_KEY en el servidor: 503 sin tocar la BD', async () => {
      const s = new CredencialQrCdaService(prisma as never, asistencia as never, storage as never, sinClave);
      await expect(s.reimprimirPdf([OP])).rejects.toThrow(ServiceUnavailableException);
      expect(prisma.operadorCda.findMany).not.toHaveBeenCalled();
    });
  });

  it('vigentes dice cuáles se pueden reimprimir (sin clave, ninguno)', async () => {
    const filas = [
      { operadorId: OP, emitidaEn: new Date('2026-10-20T15:00:00Z'), tokenCifrado: 'v1:x' },
      { operadorId: 'o2', emitidaEn: new Date('2026-10-19T15:00:00Z'), tokenCifrado: null },
    ];
    prisma.credencialQrCda.findMany.mockResolvedValue(filas);
    expect(await service.vigentes()).toEqual([
      { operadorId: OP, emitidaEn: '2026-10-20T15:00:00.000Z', reimprimible: true },
      { operadorId: 'o2', emitidaEn: '2026-10-19T15:00:00.000Z', reimprimible: false },
    ]);
    const s = new CredencialQrCdaService(prisma as never, asistencia as never, storage as never, sinClave);
    expect((await s.vigentes()).map((v) => v.reimprimible)).toEqual([false, false]);
  });

  describe('consultar', () => {
    it('busca por el hash del token y dice qué toca hoy', async () => {
      conCredencial();
      prisma.asistenciaCda.findUnique.mockResolvedValueOnce(null);

      const r = await service.consultar(TOKEN);

      expect(prisma.credencialQrCda.findUnique.mock.calls[0][0].where).toEqual({ tokenHash: hashToken(TOKEN) });
      expect(prisma.asistenciaCda.findUnique.mock.calls[0][0].where).toEqual({
        operadorId_fecha: { operadorId: OP, fecha: HOY },
      });
      expect(r).toMatchObject({ siguiente: 'ENTRADA', entradaEn: null, salidaDesde: null });
      expect(r.operador).toMatchObject({ id: OP, tieneFoto: true });
    });

    it('con entrada: toca la salida, aceptada desde 5 min después', async () => {
      conCredencial();
      const entrada = new Date('2026-10-23T13:02:00Z');
      prisma.asistenciaCda.findUnique.mockResolvedValueOnce({ entradaEn: entrada, salidaEn: null });

      const r = await service.consultar(TOKEN);

      expect(r.siguiente).toBe('SALIDA');
      expect(r.salidaDesde).toBe(new Date(entrada.getTime() + MIN_MINUTOS_SALIDA_QR * 60_000).toISOString());
    });

    it('con entrada y salida: COMPLETO', async () => {
      conCredencial();
      prisma.asistenciaCda.findUnique.mockResolvedValueOnce({ entradaEn: AHORA, salidaEn: AHORA });
      expect((await service.consultar(TOKEN)).siguiente).toBe('COMPLETO');
    });

    it.each([
      ['inexistente', null],
      ['anulada', { revocadaEn: new Date(), operador: operador() }],
      ['de un operador oculto', { revocadaEn: null, operador: operador({ activo: false }) }],
    ])('credencial %s: el mismo 404 genérico', async (_caso, credencial) => {
      prisma.credencialQrCda.findUnique.mockResolvedValueOnce(credencial);
      await expect(service.consultar(TOKEN)).rejects.toThrow('Credencial no válida o anulada');
    });
  });

  describe('marcar', () => {
    it('la entrada se registra con el servicio de asistencia y origen QR', async () => {
      conCredencial();
      asistencia.marcar.mockResolvedValueOnce({ ok: true });

      await service.marcar(TOKEN, 'ENTRADA', USR);

      expect(asistencia.marcar).toHaveBeenCalledWith(OP, 'ENTRADA', USR, 'QR');
    });

    it('la salida antes de 5 min de la entrada se rechaza (doble escaneo)', async () => {
      conCredencial();
      prisma.asistenciaCda.findUnique.mockResolvedValueOnce({ entradaEn: new Date('2026-10-23T13:17:00Z') });

      await expect(service.marcar(TOKEN, 'SALIDA', USR)).rejects.toThrow(
        'La entrada se registró a las 08:17: la salida con el carnet se acepta desde las 08:22',
      );
      expect(asistencia.marcar).not.toHaveBeenCalled();
    });

    it('la salida pasados los 5 min sí se registra', async () => {
      conCredencial();
      prisma.asistenciaCda.findUnique.mockResolvedValueOnce({ entradaEn: new Date('2026-10-23T13:15:00Z') });
      await service.marcar(TOKEN, 'SALIDA', USR);
      expect(asistencia.marcar).toHaveBeenCalledWith(OP, 'SALIDA', USR, 'QR');
    });

    it('un carnet anulado no marca', async () => {
      conCredencial({ revocadaEn: new Date() });
      await expect(service.marcar(TOKEN, 'ENTRADA', USR)).rejects.toThrow(NotFoundException);
      expect(asistencia.marcar).not.toHaveBeenCalled();
    });
  });

  it('revocar sin carnet vigente: 404; con carnet: lo anula a mano', async () => {
    prisma.credencialQrCda.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    await expect(service.revocar(OP)).rejects.toThrow('no tiene un carnet vigente');
    await expect(service.revocar(OP)).resolves.toEqual({ revocada: true });
    expect(prisma.credencialQrCda.updateMany.mock.calls[1][0]).toEqual({
      where: { operadorId: OP, revocadaEn: null },
      data: { revocadaEn: AHORA, motivoRevocacion: 'REVOCADA' },
    });
  });
});
