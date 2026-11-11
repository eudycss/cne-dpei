import { BadRequestException, ConflictException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { revisarEvaticsSchema, SIN_CANTON_EVATICS, SIN_TECNICO_EVATICS } from '@cne/shared-validation';

import {
  CEDULA_NO_REGISTRADA,
  DEMASIADAS_SUBIDAS,
  ESPERA_MAX_ANALISIS_AL_SUBIR_MS,
  EvaticsService,
  FOTO_CAMBIO,
  MAX_ANALISIS_POR_MINUTO,
  MAX_INTENTOS_ANALISIS,
  MAX_SUBIDAS_POR_DIA,
  avisoParaLaPersona,
  esperaReintento,
} from './evatics.service';
import { LectorNoConfigurado, LectorRespuestaInvalida, LectorTransitorio } from './lector-certificado';
import { limpiarJpeg } from '../operadores-cda/jpeg';

jest.mock('../operadores-cda/jpeg', () => ({ limpiarJpeg: jest.fn() }));
const limpiarMock = limpiarJpeg as jest.Mock;

const CED_ANA = '1710034065';
const CED_LUIS = '1002003000';
const CED_SUP = '0102030400';
const SUP = 'usuario-supervisor';
const AHORA = new Date('2026-11-12T15:00:00Z'); // 12-nov 10:00 en Ecuador
const HOY = '2026-11-12';
const SUBIDO_EN = '2026-11-12T14:00:00.000Z';

const operador = (over: Record<string, unknown> = {}) => ({
  id: 'op-ana',
  cedula: CED_ANA,
  apellidosNombres: 'PÉREZ LÓPEZ ANA MARÍA',
  usuarioId: null,
  activo: true,
  cargoCda: { nombre: 'Operador CDA', centro: 'CDA' },
  ...over,
});

const certificado = (over: Record<string, unknown> = {}) => ({
  id: 'cert-ana',
  cedula: CED_ANA,
  fotoKey: 'clave-foto',
  fotoAnteriorKey: null,
  reemplazos: 0,
  subidoEn: new Date(SUBIDO_EN),
  estado: 'PENDIENTE',
  motivoRechazo: null,
  revisadoEn: null,
  revisadoPor: null,
  analisisEstado: 'LISTO',
  analisisIntentos: 0,
  nombreLeido: 'Ana María Pérez López',
  nombreCoincide: true,
  esCertificado: true,
  legible: true,
  analizadoEn: new Date('2026-11-12T14:00:05Z'),
  analisisProveedor: 'Gemini',
  ...over,
});

/** Lo que lee subir() de la fila ya guardada (dentro de la transacción). */
const filaActual = (over: Record<string, unknown> = {}) => ({
  id: 'cert-ana',
  fotoKey: 'clave-vieja',
  fotoAnteriorKey: 'clave-mas-vieja',
  reemplazos: 2,
  subidasDia: HOY,
  subidasHoy: 1,
  ...over,
});

const ARCHIVO = { buffer: Buffer.from('foto'), size: 4 } as Express.Multer.File;
const LECTURA = { nombreLeido: 'Ana María Pérez López', esCertificadoEvatics: true, legible: true };

describe('EvaticsService', () => {
  const prisma = {
    operadorCda: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
    usuario: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
    certificadoEvatics: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    configEvatics: { findUnique: jest.fn(), upsert: jest.fn() },
    parejaCda: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const storage = { saveEncrypted: jest.fn(), readDecrypted: jest.fn(), remove: jest.fn() };
  const lector = { disponible: jest.fn(), leer: jest.fn() };
  const distributivo = { asignaciones: jest.fn() };
  let service: EvaticsService;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers({ now: AHORA, doNotFake: ['nextTick', 'setImmediate'] });
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
    prisma.configEvatics.findUnique.mockResolvedValue({ fechaLimite: null });
    prisma.certificadoEvatics.updateMany.mockResolvedValue({ count: 1 });
    storage.saveEncrypted.mockResolvedValue('clave-nueva');
    limpiarMock.mockReturnValue({ limpio: Buffer.from('limpia'), ancho: 1600, alto: 1200 });
    lector.disponible.mockReturnValue(false);
    service = new EvaticsService(prisma as never, storage as never, lector as never, distributivo as never);
  });
  afterEach(() => jest.useRealTimers());

  /** Ana está en el personal; nadie más. */
  const anaEnElPersonal = () => {
    prisma.operadorCda.findUnique.mockImplementation(({ where }: { where: { cedula: string } }) =>
      Promise.resolve(where.cedula === CED_ANA ? operador() : null),
    );
    prisma.usuario.findFirst.mockResolvedValue(null);
  };

  /** Primera subida: no hay fila antes ni dentro de la transacción. */
  const primeraSubida = () => {
    prisma.certificadoEvatics.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    prisma.certificadoEvatics.create.mockResolvedValueOnce({ id: 'cert-ana' });
  };

  describe('página pública', () => {
    it('cédula que no está en el personal: 404 genérico', async () => {
      prisma.operadorCda.findUnique.mockResolvedValue(null);
      prisma.usuario.findFirst.mockResolvedValue(null);
      await expect(service.consultar(CED_LUIS)).rejects.toThrow(new NotFoundException(CEDULA_NO_REGISTRADA));
    });

    it('un operador inactivo no cuenta como registrado', async () => {
      prisma.operadorCda.findUnique.mockResolvedValue(operador({ activo: false }));
      prisma.usuario.findFirst.mockResolvedValue(null);
      await expect(service.consultar(CED_ANA)).rejects.toThrow(NotFoundException);
    });

    it('cédula válida: solo "Ana P.", el cargo y el estado (nunca la cédula ni el nombre completo)', async () => {
      anaEnElPersonal();
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce(null);
      const r = await service.consultar(CED_ANA);
      expect(r).toEqual({
        nombreCorto: 'Ana P.',
        cargo: 'Operador CDA',
        estado: 'SIN_SUBIR',
        motivoRechazo: null,
        fechaLimite: null,
        plazoVencido: false,
        puedeSubir: true,
      });
      expect(JSON.stringify(r)).not.toContain('PÉREZ');
    });

    it('un Asistente Transversal (usuario con ese rol) también puede subir', async () => {
      prisma.operadorCda.findUnique.mockResolvedValue(null);
      prisma.usuario.findFirst.mockResolvedValue({ id: 'u-at', cedula: CED_LUIS, nombres: 'Luis Alberto', apellidos: 'Vega Tapia' });
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce(null);
      await expect(service.consultar(CED_LUIS)).resolves.toMatchObject({ nombreCorto: 'Luis V.', cargo: 'Asistente Transversal' });
      expect(prisma.usuario.findFirst.mock.calls[0][0].where).toMatchObject({
        cedula: CED_LUIS,
        activo: true,
        roles: { some: { rol: { nombre: 'ASISTENTE_TRANSVERSAL' } } },
      });
    });

    it('el motivo solo se muestra mientras el estado es RECHAZADO; aprobado ya no puede subir', async () => {
      anaEnElPersonal();
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce({ estado: 'RECHAZADO', motivoRechazo: 'Foto borrosa' });
      await expect(service.consultar(CED_ANA)).resolves.toMatchObject({ motivoRechazo: 'Foto borrosa', puedeSubir: true });
      // Un motivo viejo que quedó guardado no se muestra en otro estado.
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce({ estado: 'PENDIENTE', motivoRechazo: 'Foto borrosa' });
      await expect(service.consultar(CED_ANA)).resolves.toMatchObject({ motivoRechazo: null });
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce({ estado: 'APROBADO', motivoRechazo: null });
      await expect(service.consultar(CED_ANA)).resolves.toMatchObject({ estado: 'APROBADO', puedeSubir: false });
    });

    it('pasada la fecha límite: plazo vencido; el mismo día todavía puede', async () => {
      anaEnElPersonal();
      prisma.configEvatics.findUnique.mockResolvedValue({ fechaLimite: new Date('2026-11-11T00:00:00Z') });
      prisma.certificadoEvatics.findUnique.mockResolvedValue(null);
      await expect(service.consultar(CED_ANA)).resolves.toMatchObject({ fechaLimite: '2026-11-11', plazoVencido: true, puedeSubir: false });
      prisma.configEvatics.findUnique.mockResolvedValue({ fechaLimite: new Date('2026-11-12T00:00:00Z') });
      await expect(service.consultar(CED_ANA)).resolves.toMatchObject({ plazoVencido: false, puedeSubir: true });
    });
  });

  describe('subir', () => {
    it('cédula inexistente: 404 y no guarda nada', async () => {
      prisma.operadorCda.findUnique.mockResolvedValue(null);
      prisma.usuario.findFirst.mockResolvedValue(null);
      await expect(service.subir(CED_LUIS, ARCHIVO, 'v')).rejects.toThrow(NotFoundException);
      expect(storage.saveEncrypted).not.toHaveBeenCalled();
    });

    it('después del plazo: 403 con la fecha', async () => {
      anaEnElPersonal();
      prisma.configEvatics.findUnique.mockResolvedValue({ fechaLimite: new Date('2026-11-10T00:00:00Z') });
      await expect(service.subir(CED_ANA, ARCHIVO, 'v')).rejects.toThrow(
        new ForbiddenException('El plazo para subir el certificado terminó el 10/11/2026'),
      );
      expect(storage.saveEncrypted).not.toHaveBeenCalled();
    });

    it('ya aprobado: no se reemplaza (409)', async () => {
      anaEnElPersonal();
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce({ estado: 'APROBADO', subidasDia: null, subidasHoy: 0 });
      await expect(service.subir(CED_ANA, ARCHIVO, 'v')).rejects.toThrow(ConflictException);
      expect(storage.saveEncrypted).not.toHaveBeenCalled();
    });

    it(`más de ${MAX_SUBIDAS_POR_DIA} subidas con la misma cédula hoy: 429 sin guardar nada`, async () => {
      anaEnElPersonal();
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce({ estado: 'PENDIENTE', subidasDia: HOY, subidasHoy: MAX_SUBIDAS_POR_DIA });
      const e = await service.subir(CED_ANA, ARCHIVO, 'v').catch((x) => x);
      expect(e).toBeInstanceOf(HttpException);
      expect(e.getStatus()).toBe(429);
      expect(e.message).toBe(DEMASIADAS_SUBIDAS);
      expect(storage.saveEncrypted).not.toHaveBeenCalled();
    });

    it('al día siguiente el contador vuelve a 1', async () => {
      anaEnElPersonal();
      prisma.certificadoEvatics.findUnique
        .mockResolvedValueOnce({ estado: 'PENDIENTE', subidasDia: '2026-11-11', subidasHoy: MAX_SUBIDAS_POR_DIA })
        .mockResolvedValueOnce(filaActual({ subidasDia: '2026-11-11', subidasHoy: MAX_SUBIDAS_POR_DIA }));
      await service.subir(CED_ANA, ARCHIVO, 'v');
      expect(prisma.certificadoEvatics.updateMany.mock.calls[0][0].data).toMatchObject({ subidasDia: HOY, subidasHoy: 1 });
    });

    it('dos subidas a la vez que pasan el límite: la que llega tarde da 429 y borra su foto', async () => {
      anaEnElPersonal();
      prisma.certificadoEvatics.findUnique
        .mockResolvedValueOnce({ estado: 'PENDIENTE', subidasDia: HOY, subidasHoy: MAX_SUBIDAS_POR_DIA - 1 })
        .mockResolvedValueOnce(filaActual({ subidasHoy: MAX_SUBIDAS_POR_DIA - 1 }))
        .mockResolvedValueOnce({ estado: 'PENDIENTE' });
      prisma.certificadoEvatics.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.subir(CED_ANA, ARCHIVO, 'v')).rejects.toThrow(DEMASIADAS_SUBIDAS);
      expect(storage.remove).toHaveBeenCalledWith('clave-nueva');
      expect(prisma.certificadoEvatics.updateMany.mock.calls[0][0].where).toMatchObject({
        estado: { not: 'APROBADO' },
        OR: [{ subidasDia: { not: HOY } }, { subidasHoy: { lt: MAX_SUBIDAS_POR_DIA } }],
      });
    });

    it('aprobado justo mientras subía: 409 y borra la foto nueva', async () => {
      anaEnElPersonal();
      prisma.certificadoEvatics.findUnique
        .mockResolvedValueOnce({ estado: 'PENDIENTE', subidasDia: null, subidasHoy: 0 })
        .mockResolvedValueOnce(filaActual())
        .mockResolvedValueOnce({ estado: 'APROBADO' });
      prisma.certificadoEvatics.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.subir(CED_ANA, ARCHIVO, 'v')).rejects.toThrow(ConflictException);
      expect(storage.remove).toHaveBeenCalledWith('clave-nueva');
    });

    it('dos primeras subidas a la vez (clave única): 409 y borra la foto nueva', async () => {
      anaEnElPersonal();
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      prisma.certificadoEvatics.create.mockRejectedValueOnce(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));
      await expect(service.subir(CED_ANA, ARCHIVO, 'v')).rejects.toThrow(ConflictException);
      expect(storage.remove).toHaveBeenCalledWith('clave-nueva');
    });

    it('archivo que no es JPEG válido: 400', async () => {
      anaEnElPersonal();
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce(null);
      limpiarMock.mockReturnValueOnce(null);
      await expect(service.subir(CED_ANA, ARCHIVO, 'v')).rejects.toThrow(BadRequestException);
    });

    it('primera subida sin lector: queda PENDIENTE en cola, sin aviso y sin reemplazo', async () => {
      anaEnElPersonal();
      primeraSubida();

      const r = await service.subir(CED_ANA, ARCHIVO, 'LOPDP-EVATICS-2026-11');

      expect(r).toEqual({ certificadoId: 'cert-ana', reemplazo: 0, resultado: { ok: true, estado: 'PENDIENTE', aviso: null } });
      expect(storage.saveEncrypted).toHaveBeenCalledWith(
        expect.objectContaining({ categoria: 'certificados-evatics', buffer: Buffer.from('limpia') }),
      );
      expect(prisma.certificadoEvatics.create.mock.calls[0][0].data).toMatchObject({
        cedula: CED_ANA,
        fotoKey: 'clave-nueva',
        estado: 'PENDIENTE',
        analisisEstado: 'EN_COLA',
        consentimientoVersion: 'LOPDP-EVATICS-2026-11',
        subidasDia: HOY,
        subidasHoy: 1,
      });
      expect(lector.leer).not.toHaveBeenCalled();
    });

    it('reemplazo: conserva la foto anterior para comparar, borra solo la más vieja y cuenta el reemplazo', async () => {
      anaEnElPersonal();
      prisma.certificadoEvatics.findUnique
        .mockResolvedValueOnce({ estado: 'RECHAZADO', subidasDia: HOY, subidasHoy: 1 })
        .mockResolvedValueOnce(filaActual());

      const r = await service.subir(CED_ANA, ARCHIVO, 'v');

      expect(r.reemplazo).toBe(3);
      const { where, data } = prisma.certificadoEvatics.updateMany.mock.calls[0][0];
      expect(where).toMatchObject({ id: 'cert-ana', estado: { not: 'APROBADO' } });
      expect(data).toMatchObject({
        fotoKey: 'clave-nueva',
        fotoAnteriorKey: 'clave-vieja',
        fotoAnteriorSubidaEn: AHORA,
        reemplazos: 3,
        subidasHoy: 2,
        estado: 'PENDIENTE',
        motivoRechazo: null,
        revisadoPorId: null,
        nombreLeido: null,
        analisisProveedor: null,
      });
      expect(storage.remove).toHaveBeenCalledTimes(1);
      expect(storage.remove).toHaveBeenCalledWith('clave-mas-vieja');
    });

    it('con lector: analiza en el momento, guarda quién leyó y compara el nombre en el código', async () => {
      anaEnElPersonal();
      lector.disponible.mockReturnValue(true);
      lector.leer.mockResolvedValueOnce({ lectura: LECTURA, proveedor: 'Groq' });
      primeraSubida();

      const r = await service.subir(CED_ANA, ARCHIVO, 'v');

      expect(r.resultado.aviso).toBeNull();
      expect(lector.leer).toHaveBeenCalledWith(Buffer.from('limpia'), 'image/jpeg');
      const guardado = prisma.certificadoEvatics.updateMany.mock.calls.at(-1)[0];
      expect(guardado.where).toEqual({ id: 'cert-ana', fotoKey: 'clave-nueva' });
      expect(guardado.data).toMatchObject({ analisisEstado: 'LISTO', nombreCoincide: true, analisisProveedor: 'Groq' });
    });

    it('el nombre no coincide: lo marca para el supervisor, pero a la persona no se lo dice', async () => {
      anaEnElPersonal();
      lector.disponible.mockReturnValue(true);
      lector.leer.mockResolvedValueOnce({ lectura: { ...LECTURA, nombreLeido: 'Juan Carlos Vega Mora' }, proveedor: 'Gemini' });
      primeraSubida();
      const r = await service.subir(CED_ANA, ARCHIVO, 'v');
      expect(r.resultado.aviso).toBeNull();
      expect(prisma.certificadoEvatics.updateMany.mock.calls.at(-1)[0].data.nombreCoincide).toBe(false);
    });

    it('no se lee: avisa a la persona que tome otra foto', async () => {
      anaEnElPersonal();
      lector.disponible.mockReturnValue(true);
      lector.leer.mockResolvedValueOnce({
        lectura: { nombreLeido: null, esCertificadoEvatics: true, legible: false },
        proveedor: 'Gemini',
      });
      primeraSubida();
      const r = await service.subir(CED_ANA, ARCHIVO, 'v');
      expect(r.resultado.aviso).toMatch(/Tome otra foto/);
    });

    it('si la lectura tarda demasiado, responde sin esperarla (queda reservada en cola)', async () => {
      anaEnElPersonal();
      lector.disponible.mockReturnValue(true);
      lector.leer.mockReturnValueOnce(new Promise(() => undefined)); // nunca responde
      primeraSubida();

      const subida = service.subir(CED_ANA, ARCHIVO, 'v');
      await jest.advanceTimersByTimeAsync(ESPERA_MAX_ANALISIS_AL_SUBIR_MS + 10);
      await expect(subida).resolves.toMatchObject({ resultado: { ok: true, estado: 'PENDIENTE', aviso: null } });
      expect(prisma.certificadoEvatics.create.mock.calls[0][0].data.analisisSiguiente).toEqual(
        new Date(AHORA.getTime() + 3 * 60_000),
      );
    });

    it('fallan todos los proveedores por algo pasajero: la subida se guarda igual y queda en cola', async () => {
      anaEnElPersonal();
      lector.disponible.mockReturnValue(true);
      lector.leer.mockRejectedValueOnce(new LectorTransitorio('Ningún proveedor pudo leer'));
      primeraSubida();
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce({ analisisIntentos: 0 });

      const r = await service.subir(CED_ANA, ARCHIVO, 'v');

      expect(r.resultado).toEqual({ ok: true, estado: 'PENDIENTE', aviso: null });
      expect(prisma.certificadoEvatics.updateMany.mock.calls.at(-1)[0].data).toEqual({
        analisisEstado: 'EN_COLA',
        analisisIntentos: 1,
        analisisSiguiente: new Date(AHORA.getTime() + esperaReintento(1)),
      });
    });

    it('fallan todos sin remedio (llave inválida o formato): NO_DISPONIBLE al primer intento', async () => {
      anaEnElPersonal();
      lector.disponible.mockReturnValue(true);
      lector.leer.mockRejectedValueOnce(new LectorRespuestaInvalida('Ningún proveedor pudo leer'));
      primeraSubida();
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce({ analisisIntentos: 0 });
      await service.subir(CED_ANA, ARCHIVO, 'v');
      expect(prisma.certificadoEvatics.updateMany.mock.calls.at(-1)[0].data).toMatchObject({
        analisisEstado: 'NO_DISPONIBLE',
        analisisIntentos: 1,
      });
    });
  });

  describe('cola de análisis (cron)', () => {
    const enCola = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, cedula: CED_ANA, fotoKey: `k${i + 1}` }));

    it('sin ningún proveedor con llave no hace nada', async () => {
      await expect(service.analizarPendientes()).resolves.toBe(0);
      expect(prisma.certificadoEvatics.findMany).not.toHaveBeenCalled();
    });

    it('reclama cada fila antes de leerla y salta la que ya tomó otro', async () => {
      lector.disponible.mockReturnValue(true);
      anaEnElPersonal();
      prisma.certificadoEvatics.findMany.mockResolvedValueOnce(enCola(2));
      prisma.certificadoEvatics.updateMany
        .mockResolvedValueOnce({ count: 0 }) // c1: la tomó otra instancia
        .mockResolvedValue({ count: 1 });
      storage.readDecrypted.mockResolvedValue(Buffer.from('img'));
      lector.leer.mockResolvedValue({ lectura: LECTURA, proveedor: 'Gemini' });

      await expect(service.analizarPendientes(AHORA)).resolves.toBe(1);
      expect(storage.readDecrypted).toHaveBeenCalledTimes(1);
      expect(storage.readDecrypted).toHaveBeenCalledWith('k2');
      expect(prisma.certificadoEvatics.updateMany.mock.calls[0][0]).toEqual({
        where: {
          id: 'c1',
          fotoKey: 'k1',
          analisisEstado: 'EN_COLA',
          OR: [{ analisisSiguiente: null }, { analisisSiguiente: { lte: AHORA } }],
        },
        data: { analisisSiguiente: new Date(AHORA.getTime() + 3 * 60_000) },
      });
    });

    it('dos vueltas a la vez: la segunda no hace nada', async () => {
      lector.disponible.mockReturnValue(true);
      anaEnElPersonal();
      let soltar!: () => void;
      prisma.certificadoEvatics.findMany.mockReturnValueOnce(new Promise((r) => (soltar = () => r([])))).mockResolvedValue([]);
      const primera = service.analizarPendientes(AHORA);
      await expect(service.analizarPendientes(AHORA)).resolves.toBe(0);
      soltar();
      await primera;
      expect(prisma.certificadoEvatics.findMany).toHaveBeenCalledTimes(1);
    });

    it('si la foto no se puede leer del Storage, cuenta un intento y sigue con la siguiente', async () => {
      lector.disponible.mockReturnValue(true);
      anaEnElPersonal();
      prisma.certificadoEvatics.findMany.mockResolvedValueOnce(enCola(2));
      storage.readDecrypted.mockRejectedValueOnce(new Error('Storage caído')).mockResolvedValueOnce(Buffer.from('img'));
      prisma.certificadoEvatics.findUnique.mockResolvedValue({ analisisIntentos: 0 });
      lector.leer.mockResolvedValueOnce({ lectura: LECTURA, proveedor: 'Gemini' });

      await expect(service.analizarPendientes(AHORA)).resolves.toBe(1);
      const datos = prisma.certificadoEvatics.updateMany.mock.calls.map((c) => c[0]);
      expect(datos).toContainEqual({
        where: { id: 'c1', fotoKey: 'k1' },
        data: { analisisEstado: 'EN_COLA', analisisIntentos: 1, analisisSiguiente: new Date(AHORA.getTime() + esperaReintento(1)) },
      });
      expect(lector.leer).toHaveBeenCalledTimes(1);
    });

    it('ante un fallo general de los proveedores se detiene para no gastar la cuota', async () => {
      lector.disponible.mockReturnValue(true);
      anaEnElPersonal();
      prisma.certificadoEvatics.findMany.mockResolvedValueOnce(enCola(3));
      storage.readDecrypted.mockResolvedValue(Buffer.from('img'));
      prisma.certificadoEvatics.findUnique.mockResolvedValue({ analisisIntentos: 2 });
      lector.leer.mockResolvedValueOnce({ lectura: LECTURA, proveedor: 'Gemini' }).mockRejectedValueOnce(new LectorTransitorio('429'));

      await expect(service.analizarPendientes(AHORA)).resolves.toBe(1);
      expect(lector.leer).toHaveBeenCalledTimes(2);
    });

    it(`tras ${MAX_INTENTOS_ANALISIS} intentos o sin llaves: NO_DISPONIBLE (revisión a ojo)`, async () => {
      lector.disponible.mockReturnValue(true);
      anaEnElPersonal();
      storage.readDecrypted.mockResolvedValue(Buffer.from('img'));
      prisma.certificadoEvatics.findMany.mockResolvedValueOnce(enCola(1));
      prisma.certificadoEvatics.findUnique.mockResolvedValue({ analisisIntentos: MAX_INTENTOS_ANALISIS - 1 });
      lector.leer.mockRejectedValueOnce(new LectorTransitorio('503'));
      await service.analizarPendientes(AHORA);
      expect(prisma.certificadoEvatics.updateMany.mock.calls.at(-1)[0].data).toMatchObject({ analisisEstado: 'NO_DISPONIBLE' });

      prisma.certificadoEvatics.findMany.mockResolvedValueOnce(enCola(1));
      prisma.certificadoEvatics.findUnique.mockResolvedValue({ analisisIntentos: 0 });
      lector.leer.mockRejectedValueOnce(new LectorNoConfigurado('sin llaves'));
      await service.analizarPendientes(AHORA);
      expect(prisma.certificadoEvatics.updateMany.mock.calls.at(-1)[0].data).toMatchObject({ analisisEstado: 'NO_DISPONIBLE' });
    });

    it(`tope de ${MAX_ANALISIS_POR_MINUTO} lecturas por minuto: el resto espera en cola sin llamar a la IA`, async () => {
      lector.disponible.mockReturnValue(true);
      anaEnElPersonal();
      storage.readDecrypted.mockResolvedValue(Buffer.from('img'));
      lector.leer.mockResolvedValue({ lectura: LECTURA, proveedor: 'Gemini' });
      for (let i = 0; i < 3; i++) {
        prisma.certificadoEvatics.findMany.mockResolvedValueOnce(enCola(4));
        await service.analizarPendientes(AHORA);
      }
      // 3 vueltas de 4 = 12 pedidas, pero solo 10 llegan a la IA en el mismo minuto.
      expect(lector.leer).toHaveBeenCalledTimes(MAX_ANALISIS_POR_MINUTO);
      expect(prisma.certificadoEvatics.updateMany.mock.calls.at(-1)[0].data).toEqual({
        analisisEstado: 'EN_COLA',
        analisisSiguiente: new Date(AHORA.getTime() + 60_000),
      });

      // Pasado el minuto, vuelve a haber cupo.
      jest.setSystemTime(new Date(AHORA.getTime() + 61_000));
      prisma.certificadoEvatics.findMany.mockResolvedValueOnce(enCola(1));
      await service.analizarPendientes(new Date(AHORA.getTime() + 61_000));
      expect(lector.leer).toHaveBeenCalledTimes(MAX_ANALISIS_POR_MINUTO + 1);
    });
  });

  describe('revisión', () => {
    const SUPERVISOR = { sub: SUP, roles: ['TECNICO_SUPERVISOR' as const] };

    it('aprueba un certificado ajeno sobre la foto que vio', async () => {
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce({ cedula: CED_ANA });
      prisma.usuario.findUnique.mockResolvedValueOnce({ cedula: CED_SUP });
      prisma.operadorCda.findFirst.mockResolvedValueOnce(null);
      await expect(service.revisar('cert-ana', 'APROBADO', undefined, SUBIDO_EN, SUPERVISOR)).resolves.toMatchObject({
        estado: 'APROBADO',
      });
      const { where, data } = prisma.certificadoEvatics.updateMany.mock.calls[0][0];
      expect(where).toEqual({ id: 'cert-ana', subidoEn: new Date(SUBIDO_EN) });
      expect(data).toMatchObject({ estado: 'APROBADO', motivoRechazo: null, revisadoPorId: SUP });
    });

    it('si la persona subió otra foto mientras la revisaba: 409 "La foto cambió"', async () => {
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce({ cedula: CED_ANA });
      prisma.usuario.findUnique.mockResolvedValueOnce({ cedula: CED_SUP });
      prisma.operadorCda.findFirst.mockResolvedValueOnce(null);
      prisma.certificadoEvatics.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.revisar('cert-ana', 'APROBADO', undefined, SUBIDO_EN, SUPERVISOR)).rejects.toThrow(
        new ConflictException(FOTO_CAMBIO),
      );
    });

    it('su propio certificado (por la cédula de su cuenta): 403', async () => {
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce({ cedula: CED_SUP });
      prisma.usuario.findUnique.mockResolvedValueOnce({ cedula: CED_SUP });
      prisma.operadorCda.findFirst.mockResolvedValueOnce(null);
      await expect(service.revisar('cert-sup', 'APROBADO', undefined, SUBIDO_EN, SUPERVISOR)).rejects.toThrow(ForbiddenException);
      expect(prisma.certificadoEvatics.updateMany).not.toHaveBeenCalled();
    });

    it('su propio certificado (por la fila del personal vinculada a su cuenta): 403', async () => {
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce({ cedula: CED_ANA });
      prisma.usuario.findUnique.mockResolvedValueOnce({ cedula: CED_SUP });
      prisma.operadorCda.findFirst.mockResolvedValueOnce({ cedula: CED_ANA });
      await expect(service.revisar('cert-ana', 'RECHAZADO', 'Borrosa', SUBIDO_EN, SUPERVISOR)).rejects.toThrow(ForbiddenException);
    });

    it('un Asistente Transversal con el permiso tampoco revisa el suyo', async () => {
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce({ cedula: CED_LUIS });
      prisma.usuario.findUnique.mockResolvedValueOnce({ cedula: CED_LUIS });
      prisma.operadorCda.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.revisar('cert-luis', 'APROBADO', undefined, SUBIDO_EN, { sub: 'u-at', roles: ['ASISTENTE_TRANSVERSAL'] }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.certificadoEvatics.updateMany).not.toHaveBeenCalled();
    });

    it('el administrador queda fuera de la regla (ni consulta su cédula)', async () => {
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce({ cedula: CED_SUP });
      await service.revisar('cert-sup', 'RECHAZADO', 'Foto borrosa', SUBIDO_EN, { sub: 'admin', roles: ['ADMINISTRADOR'] });
      expect(prisma.usuario.findUnique).not.toHaveBeenCalled();
      expect(prisma.certificadoEvatics.updateMany.mock.calls[0][0].data).toMatchObject({
        estado: 'RECHAZADO',
        motivoRechazo: 'Foto borrosa',
      });
    });

    it('schema: rechazar exige motivo y siempre va la fecha de la foto revisada', () => {
      expect(revisarEvaticsSchema.safeParse({ decision: 'RECHAZADO', subidoEn: SUBIDO_EN }).success).toBe(false);
      expect(revisarEvaticsSchema.safeParse({ decision: 'RECHAZADO', motivo: 'Foto borrosa', subidoEn: SUBIDO_EN }).success).toBe(true);
      expect(revisarEvaticsSchema.safeParse({ decision: 'APROBADO', subidoEn: SUBIDO_EN }).success).toBe(true);
      expect(revisarEvaticsSchema.safeParse({ decision: 'APROBADO' }).success).toBe(false);
    });

    it('certificado inexistente: 404', async () => {
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce(null);
      await expect(service.revisar('x', 'APROBADO', undefined, SUBIDO_EN, SUPERVISOR)).rejects.toThrow(NotFoundException);
    });

    it('foto anterior: se descifra la anterior; sin anterior, 404', async () => {
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce({ fotoKey: 'k-actual', fotoAnteriorKey: 'k-anterior' });
      storage.readDecrypted.mockResolvedValueOnce(Buffer.from('anterior'));
      await expect(service.foto('cert-ana', true)).resolves.toEqual(Buffer.from('anterior'));
      expect(storage.readDecrypted).toHaveBeenCalledWith('k-anterior');
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce({ fotoKey: 'k-actual', fotoAnteriorKey: null });
      await expect(service.foto('cert-ana', true)).rejects.toThrow(NotFoundException);
    });
  });

  describe('listado', () => {
    const ADMIN = { sub: 'admin', roles: ['ADMINISTRADOR' as const] };

    beforeEach(() => {
      prisma.operadorCda.findMany.mockResolvedValue([
        operador(),
        operador({
          id: 'op-luis',
          cedula: CED_LUIS,
          apellidosNombres: 'VEGA TAPIA LUIS',
          cargoCda: { nombre: 'Receptor de actas', centro: 'CPE' },
        }),
      ]);
      prisma.usuario.findMany.mockResolvedValue([
        { id: 'u-at', cedula: '0912345678', nombres: 'Carlos', apellidos: 'Pozo' },
        // También está en el personal: sale una sola vez.
        { id: 'u-ana', cedula: CED_ANA, nombres: 'Ana', apellidos: 'Pérez' },
      ]);
      prisma.certificadoEvatics.findMany.mockResolvedValue([
        certificado({
          estado: 'APROBADO',
          reemplazos: 2,
          fotoAnteriorKey: 'k-anterior',
          revisadoPor: { nombres: 'Jazmín', apellidos: 'Ayala' },
          revisadoEn: new Date('2026-11-12T14:30:00Z'),
        }),
      ]);
      prisma.parejaCda.findMany.mockResolvedValue([
        { operadorCdaId: 'op-ana', asistenteCdaId: null, recinto: { codigoRecinto: '1207', canton: { nombre: 'Ibarra' } } },
        { operadorCdaId: 'op-ana', asistenteCdaId: null, recinto: { codigoRecinto: '9999', canton: { nombre: 'Otavalo' } } },
      ]);
      distributivo.asignaciones.mockResolvedValue([
        { codigoRecinto: '1207', localidad: '', parroquia: '', numeroTecnico: 1, tecnico: 'Jairo Leal' },
      ]);
    });

    it('todo el personal y los AT, uno por cédula, con cantón (del último recinto), Asistente Transversal y reemplazos', async () => {
      const r = await service.listado({}, ADMIN);
      expect(r.filas).toHaveLength(3);
      expect(r.filas.find((f) => f.cedula === CED_ANA)).toMatchObject({
        canton: 'Ibarra',
        tecnico: 'Jairo Leal',
        estado: 'APROBADO',
        reemplazos: 2,
        tieneFotoAnterior: true,
        subidoEn: SUBIDO_EN,
        revisadoPor: 'Jazmín Ayala',
        centro: 'CDA',
        esPropio: false,
        analisis: expect.objectContaining({ proveedor: 'Gemini', nombreCoincide: true }),
      });
      expect(r.filas.find((f) => f.cedula === CED_LUIS)).toMatchObject({
        canton: SIN_CANTON_EVATICS,
        tecnico: SIN_TECNICO_EVATICS,
        estado: 'SIN_SUBIR',
        centro: 'CPE',
        reemplazos: 0,
        tieneFotoAnterior: false,
      });
      expect(r.filas.find((f) => f.cedula === '0912345678')).toMatchObject({ centro: 'AT', cargo: 'Asistente Transversal' });
      expect(r.totales).toEqual({ total: 3, sinSubir: 2, pendientes: 0, aprobados: 1, rechazados: 0 });
      expect(r.porCanton[0]).toMatchObject({ nombre: 'Ibarra', total: 1, aprobados: 1 });
      expect(r.porCanton.at(-1)).toMatchObject({ nombre: SIN_CANTON_EVATICS, total: 2 });
      expect(r.porTecnico.find((g) => g.nombre === 'Jairo Leal')).toMatchObject({ total: 1, aprobados: 1 });
      expect(r.distributivoDisponible).toBe(true);
    });

    it('filtros: cantón, estado, cargo y técnico (sin tildes) y búsqueda; los conteos siguen siendo de todos', async () => {
      expect((await service.listado({ canton: 'ibarra' }, ADMIN)).filas.map((f) => f.cedula)).toEqual([CED_ANA]);
      expect((await service.listado({ estado: 'SIN_SUBIR' }, ADMIN)).filas).toHaveLength(2);
      expect((await service.listado({ q: 'perez' }, ADMIN)).filas.map((f) => f.cedula)).toEqual([CED_ANA]);
      const porCedula = await service.listado({ q: CED_LUIS }, ADMIN);
      expect(porCedula.filas.map((f) => f.cedula)).toEqual([CED_LUIS]);
      expect(porCedula.totales.total).toBe(3);
      expect((await service.listado({ cargo: 'receptor de actas' }, ADMIN)).filas.map((f) => f.cedula)).toEqual([CED_LUIS]);
      expect((await service.listado({ tecnico: 'Jairo Leal' }, ADMIN)).filas.map((f) => f.cedula)).toEqual([CED_ANA]);
    });

    it('sin distributivo (Drive caído) el listado sale igual, todos "Sin asistente"', async () => {
      distributivo.asignaciones.mockRejectedValue(new Error('Drive no responde'));
      const r = await service.listado({}, ADMIN);
      expect(r.distributivoDisponible).toBe(false);
      expect(r.filas.every((f) => f.tecnico === SIN_TECNICO_EVATICS)).toBe(true);
    });

    it('quien revisa ve su propia fila marcada', async () => {
      prisma.usuario.findUnique.mockResolvedValue({ cedula: CED_LUIS });
      prisma.operadorCda.findFirst.mockResolvedValue(null);
      const r = await service.listado({}, { sub: SUP, roles: ['TECNICO_SUPERVISOR'] });
      expect(r.filas.find((f) => f.cedula === CED_LUIS)?.esPropio).toBe(true);
      expect(r.filas.filter((f) => f.esPropio)).toHaveLength(1);
    });
  });

  it('fecha límite: se guarda como día y se lee igual', async () => {
    await expect(service.guardarConfig('2026-11-20')).resolves.toEqual({ fechaLimite: '2026-11-20' });
    expect(prisma.configEvatics.upsert.mock.calls[0][0].update).toEqual({ fechaLimite: new Date('2026-11-20T00:00:00Z') });
    await service.guardarConfig(null);
    expect(prisma.configEvatics.upsert.mock.calls[1][0].update).toEqual({ fechaLimite: null });
  });

  it('aviso para la persona: certificado equivocado o ilegible; sin lectura, nada', () => {
    expect(avisoParaLaPersona(null)).toBeNull();
    expect(avisoParaLaPersona(LECTURA)).toBeNull();
    expect(avisoParaLaPersona({ ...LECTURA, esCertificadoEvatics: false })).toMatch(/no parece un certificado/);
  });
});
