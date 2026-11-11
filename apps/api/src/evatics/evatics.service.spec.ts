import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { revisarEvaticsSchema, SIN_CANTON_EVATICS, SIN_TECNICO_EVATICS } from '@cne/shared-validation';

import {
  CEDULA_NO_REGISTRADA,
  ESPERA_MAX_ANALISIS_AL_SUBIR_MS,
  EvaticsService,
  MAX_INTENTOS_ANALISIS,
  avisoParaLaPersona,
  esperaReintento,
} from './evatics.service';
import { LectorNoConfigurado, LectorTransitorio } from './lector-certificado';
import { limpiarJpeg } from '../operadores-cda/jpeg';

jest.mock('../operadores-cda/jpeg', () => ({ limpiarJpeg: jest.fn() }));
const limpiarMock = limpiarJpeg as jest.Mock;

const CED_ANA = '1710034065';
const CED_LUIS = '1002003000';
const CED_SUP = '0102030400';
const SUP = 'usuario-supervisor';
const AHORA = new Date('2026-11-12T15:00:00Z'); // 12-nov 10:00 en Ecuador

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
  subidoEn: new Date('2026-11-12T14:00:00Z'),
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

const ARCHIVO = { buffer: Buffer.from('foto'), size: 4 } as Express.Multer.File;
const LECTURA = {
  nombreLeido: 'Ana María Pérez López',
  esCertificadoEvatics: true,
  legible: true,
};

describe('EvaticsService', () => {
  const prisma = {
    operadorCda: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    usuario: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
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
  const storage = {
    saveEncrypted: jest.fn(),
    readDecrypted: jest.fn(),
    remove: jest.fn(),
  };
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
    limpiarMock.mockReturnValue({
      limpio: Buffer.from('limpia'),
      ancho: 1600,
      alto: 1200,
    });
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
      prisma.usuario.findFirst.mockResolvedValue({
        id: 'u-at',
        cedula: CED_LUIS,
        nombres: 'Luis Alberto',
        apellidos: 'Vega Tapia',
      });
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce(null);
      await expect(service.consultar(CED_LUIS)).resolves.toMatchObject({
        nombreCorto: 'Luis V.',
        cargo: 'Asistente Transversal',
      });
      expect(prisma.usuario.findFirst.mock.calls[0][0].where).toMatchObject({
        cedula: CED_LUIS,
        activo: true,
        roles: { some: { rol: { nombre: 'ASISTENTE_TRANSVERSAL' } } },
      });
    });

    it('rechazado: ve el motivo para subir otra; aprobado: ya no puede subir', async () => {
      anaEnElPersonal();
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce({
        estado: 'RECHAZADO',
        motivoRechazo: 'Foto borrosa',
      });
      await expect(service.consultar(CED_ANA)).resolves.toMatchObject({
        motivoRechazo: 'Foto borrosa',
        puedeSubir: true,
      });
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce({
        estado: 'APROBADO',
        motivoRechazo: null,
      });
      await expect(service.consultar(CED_ANA)).resolves.toMatchObject({
        estado: 'APROBADO',
        puedeSubir: false,
      });
    });

    it('pasada la fecha límite: plazo vencido y no puede subir', async () => {
      anaEnElPersonal();
      prisma.configEvatics.findUnique.mockResolvedValue({
        fechaLimite: new Date('2026-11-11T00:00:00Z'),
      });
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce(null);
      await expect(service.consultar(CED_ANA)).resolves.toMatchObject({
        fechaLimite: '2026-11-11',
        plazoVencido: true,
        puedeSubir: false,
      });
    });

    it('el día de la fecha límite todavía puede subir', async () => {
      anaEnElPersonal();
      prisma.configEvatics.findUnique.mockResolvedValue({
        fechaLimite: new Date('2026-11-12T00:00:00Z'),
      });
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce(null);
      await expect(service.consultar(CED_ANA)).resolves.toMatchObject({
        plazoVencido: false,
        puedeSubir: true,
      });
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
      prisma.configEvatics.findUnique.mockResolvedValue({
        fechaLimite: new Date('2026-11-10T00:00:00Z'),
      });
      await expect(service.subir(CED_ANA, ARCHIVO, 'v')).rejects.toThrow(
        new ForbiddenException('El plazo para subir el certificado terminó el 10/11/2026'),
      );
      expect(storage.saveEncrypted).not.toHaveBeenCalled();
    });

    it('ya aprobado: no se reemplaza (409)', async () => {
      anaEnElPersonal();
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce({
        estado: 'APROBADO',
      });
      await expect(service.subir(CED_ANA, ARCHIVO, 'v')).rejects.toThrow(ConflictException);
      expect(storage.saveEncrypted).not.toHaveBeenCalled();
    });

    it('aprobado justo mientras subía: 409 y borra la foto nueva', async () => {
      anaEnElPersonal();
      prisma.certificadoEvatics.findUnique
        .mockResolvedValueOnce({ estado: 'PENDIENTE' })
        .mockResolvedValueOnce({ id: 'cert-ana', fotoKey: 'clave-vieja' });
      prisma.certificadoEvatics.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.subir(CED_ANA, ARCHIVO, 'v')).rejects.toThrow(ConflictException);
      expect(storage.remove).toHaveBeenCalledWith('clave-nueva');
    });

    it('archivo que no es JPEG válido: 400', async () => {
      anaEnElPersonal();
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce(null);
      limpiarMock.mockReturnValueOnce(null);
      await expect(service.subir(CED_ANA, ARCHIVO, 'v')).rejects.toThrow(BadRequestException);
    });

    it('primera subida sin lector: queda PENDIENTE en cola y sin aviso', async () => {
      anaEnElPersonal();
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      prisma.certificadoEvatics.create.mockResolvedValueOnce({
        id: 'cert-ana',
      });

      const r = await service.subir(CED_ANA, ARCHIVO, 'LOPDP-EVATICS-2026-11');

      expect(r).toEqual({
        certificadoId: 'cert-ana',
        resultado: { ok: true, estado: 'PENDIENTE', aviso: null },
      });
      expect(storage.saveEncrypted).toHaveBeenCalledWith(
        expect.objectContaining({
          categoria: 'certificados-evatics',
          buffer: Buffer.from('limpia'),
        }),
      );
      expect(prisma.certificadoEvatics.create.mock.calls[0][0].data).toMatchObject({
        cedula: CED_ANA,
        fotoKey: 'clave-nueva',
        estado: 'PENDIENTE',
        analisisEstado: 'EN_COLA',
        consentimientoVersion: 'LOPDP-EVATICS-2026-11',
      });
      expect(lector.leer).not.toHaveBeenCalled();
    });

    it('rechazado antes: se reemplaza, se limpia la revisión y se borra la foto vieja', async () => {
      anaEnElPersonal();
      prisma.certificadoEvatics.findUnique
        .mockResolvedValueOnce({ estado: 'RECHAZADO' })
        .mockResolvedValueOnce({ id: 'cert-ana', fotoKey: 'clave-vieja' });
      await service.subir(CED_ANA, ARCHIVO, 'v');
      const { where, data } = prisma.certificadoEvatics.updateMany.mock.calls[0][0];
      expect(where).toEqual({ id: 'cert-ana', estado: { not: 'APROBADO' } });
      expect(data).toMatchObject({
        estado: 'PENDIENTE',
        motivoRechazo: null,
        revisadoPorId: null,
        nombreLeido: null,
        analisisProveedor: null,
      });
      expect(storage.remove).toHaveBeenCalledWith('clave-vieja');
    });

    it('con lector: analiza en el momento, guarda quién leyó y compara el nombre en el código', async () => {
      anaEnElPersonal();
      lector.disponible.mockReturnValue(true);
      lector.leer.mockResolvedValueOnce({
        lectura: LECTURA,
        proveedor: 'Groq',
      });
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      prisma.certificadoEvatics.create.mockResolvedValueOnce({
        id: 'cert-ana',
      });

      const r = await service.subir(CED_ANA, ARCHIVO, 'v');

      expect(r.resultado.aviso).toBeNull();
      expect(lector.leer).toHaveBeenCalledWith(Buffer.from('limpia'), 'image/jpeg');
      const guardado = prisma.certificadoEvatics.updateMany.mock.calls.at(-1)[0];
      expect(guardado.where).toEqual({
        id: 'cert-ana',
        fotoKey: 'clave-nueva',
      });
      expect(guardado.data).toMatchObject({
        analisisEstado: 'LISTO',
        nombreCoincide: true,
        analisisProveedor: 'Groq',
      });
    });

    it('el nombre no coincide: lo marca para el supervisor, pero a la persona no se lo dice', async () => {
      anaEnElPersonal();
      lector.disponible.mockReturnValue(true);
      lector.leer.mockResolvedValueOnce({
        lectura: { ...LECTURA, nombreLeido: 'Juan Carlos Vega Mora' },
        proveedor: 'Gemini',
      });
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      prisma.certificadoEvatics.create.mockResolvedValueOnce({
        id: 'cert-ana',
      });

      const r = await service.subir(CED_ANA, ARCHIVO, 'v');

      expect(r.resultado.aviso).toBeNull();
      expect(prisma.certificadoEvatics.updateMany.mock.calls.at(-1)[0].data.nombreCoincide).toBe(false);
    });

    it('no se lee: avisa a la persona que tome otra foto', async () => {
      anaEnElPersonal();
      lector.disponible.mockReturnValue(true);
      lector.leer.mockResolvedValueOnce({
        lectura: {
          nombreLeido: null,
          esCertificadoEvatics: true,
          legible: false,
        },
        proveedor: 'Gemini',
      });
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      prisma.certificadoEvatics.create.mockResolvedValueOnce({
        id: 'cert-ana',
      });
      const r = await service.subir(CED_ANA, ARCHIVO, 'v');
      expect(r.resultado.aviso).toMatch(/Tome otra foto/);
    });

    it('si la lectura tarda demasiado, responde sin esperarla (sigue en cola reservada)', async () => {
      anaEnElPersonal();
      lector.disponible.mockReturnValue(true);
      lector.leer.mockReturnValueOnce(new Promise(() => undefined)); // nunca responde
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      prisma.certificadoEvatics.create.mockResolvedValueOnce({
        id: 'cert-ana',
      });

      const subida = service.subir(CED_ANA, ARCHIVO, 'v');
      await jest.advanceTimersByTimeAsync(ESPERA_MAX_ANALISIS_AL_SUBIR_MS + 10);
      await expect(subida).resolves.toMatchObject({
        resultado: { ok: true, estado: 'PENDIENTE', aviso: null },
      });
      expect(prisma.certificadoEvatics.create.mock.calls[0][0].data.analisisSiguiente).toEqual(
        new Date(AHORA.getTime() + 3 * 60_000),
      );
    });

    it('fallan todos los proveedores: la subida se guarda igual y queda en cola para reintentar', async () => {
      anaEnElPersonal();
      lector.disponible.mockReturnValue(true);
      lector.leer.mockRejectedValueOnce(new LectorTransitorio('Ningún proveedor pudo leer'));
      prisma.certificadoEvatics.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ analisisIntentos: 0 });
      prisma.certificadoEvatics.create.mockResolvedValueOnce({
        id: 'cert-ana',
      });

      const r = await service.subir(CED_ANA, ARCHIVO, 'v');

      expect(r.resultado).toEqual({
        ok: true,
        estado: 'PENDIENTE',
        aviso: null,
      });
      expect(prisma.certificadoEvatics.updateMany.mock.calls.at(-1)[0].data).toEqual({
        analisisEstado: 'EN_COLA',
        analisisIntentos: 1,
        analisisSiguiente: new Date(AHORA.getTime() + esperaReintento(1)),
      });
    });
  });

  describe('cola de análisis (cron)', () => {
    it('sin ningún proveedor con llave no hace nada', async () => {
      await expect(service.analizarPendientes()).resolves.toBe(0);
      expect(prisma.certificadoEvatics.findMany).not.toHaveBeenCalled();
    });

    it('analiza los vencidos; ante un fallo general se detiene para no gastar la cuota', async () => {
      lector.disponible.mockReturnValue(true);
      anaEnElPersonal();
      prisma.certificadoEvatics.findMany.mockResolvedValueOnce([
        { id: 'c1', cedula: CED_ANA, fotoKey: 'k1' },
        { id: 'c2', cedula: CED_ANA, fotoKey: 'k2' },
        { id: 'c3', cedula: CED_ANA, fotoKey: 'k3' },
      ]);
      storage.readDecrypted.mockResolvedValue(Buffer.from('img'));
      prisma.certificadoEvatics.findUnique.mockResolvedValue({
        analisisIntentos: 2,
      });
      lector.leer
        .mockResolvedValueOnce({ lectura: LECTURA, proveedor: 'Gemini' })
        .mockRejectedValueOnce(new LectorTransitorio('429'));

      await expect(service.analizarPendientes(AHORA)).resolves.toBe(1);
      expect(lector.leer).toHaveBeenCalledTimes(2);
      expect(prisma.certificadoEvatics.findMany.mock.calls[0][0].where).toEqual({
        analisisEstado: 'EN_COLA',
        OR: [{ analisisSiguiente: null }, { analisisSiguiente: { lte: AHORA } }],
      });
    });

    it(`tras ${MAX_INTENTOS_ANALISIS} intentos o un error que no es pasajero: NO_DISPONIBLE (revisión a ojo)`, async () => {
      lector.disponible.mockReturnValue(true);
      anaEnElPersonal();
      prisma.certificadoEvatics.findMany.mockResolvedValueOnce([{ id: 'c1', cedula: CED_ANA, fotoKey: 'k1' }]);
      storage.readDecrypted.mockResolvedValue(Buffer.from('img'));
      prisma.certificadoEvatics.findUnique.mockResolvedValue({
        analisisIntentos: MAX_INTENTOS_ANALISIS - 1,
      });
      lector.leer.mockRejectedValueOnce(new LectorTransitorio('503'));
      await service.analizarPendientes(AHORA);
      expect(prisma.certificadoEvatics.updateMany.mock.calls.at(-1)[0].data).toMatchObject({
        analisisEstado: 'NO_DISPONIBLE',
      });

      prisma.certificadoEvatics.findMany.mockResolvedValueOnce([{ id: 'c1', cedula: CED_ANA, fotoKey: 'k1' }]);
      prisma.certificadoEvatics.findUnique.mockResolvedValue({
        analisisIntentos: 0,
      });
      lector.leer.mockRejectedValueOnce(new LectorNoConfigurado('sin llaves'));
      await service.analizarPendientes(AHORA);
      expect(prisma.certificadoEvatics.updateMany.mock.calls.at(-1)[0].data).toMatchObject({
        analisisEstado: 'NO_DISPONIBLE',
      });
    });
  });

  describe('revisión del supervisor', () => {
    const SUPERVISOR = { sub: SUP, roles: ['TECNICO_SUPERVISOR' as const] };

    it('aprueba un certificado ajeno', async () => {
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce({
        cedula: CED_ANA,
      });
      prisma.usuario.findUnique.mockResolvedValueOnce({ cedula: CED_SUP });
      prisma.operadorCda.findFirst.mockResolvedValueOnce(null);
      await expect(service.revisar('cert-ana', 'APROBADO', undefined, SUPERVISOR)).resolves.toMatchObject({
        estado: 'APROBADO',
      });
      expect(prisma.certificadoEvatics.update.mock.calls[0][0].data).toMatchObject({
        estado: 'APROBADO',
        motivoRechazo: null,
        revisadoPorId: SUP,
      });
    });

    it('su propio certificado (por la cédula de su cuenta): 403', async () => {
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce({
        cedula: CED_SUP,
      });
      prisma.usuario.findUnique.mockResolvedValueOnce({ cedula: CED_SUP });
      prisma.operadorCda.findFirst.mockResolvedValueOnce(null);
      await expect(service.revisar('cert-sup', 'APROBADO', undefined, SUPERVISOR)).rejects.toThrow(ForbiddenException);
      expect(prisma.certificadoEvatics.update).not.toHaveBeenCalled();
    });

    it('su propio certificado (por la fila del personal vinculada a su cuenta): 403', async () => {
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce({
        cedula: CED_ANA,
      });
      prisma.usuario.findUnique.mockResolvedValueOnce({ cedula: CED_SUP });
      prisma.operadorCda.findFirst.mockResolvedValueOnce({ cedula: CED_ANA });
      await expect(service.revisar('cert-ana', 'RECHAZADO', 'Borrosa', SUPERVISOR)).rejects.toThrow(ForbiddenException);
    });

    it('el administrador queda fuera de la regla (ni consulta su cédula)', async () => {
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce({
        cedula: CED_SUP,
      });
      await service.revisar('cert-sup', 'RECHAZADO', 'Foto borrosa', {
        sub: 'admin',
        roles: ['ADMINISTRADOR'],
      });
      expect(prisma.usuario.findUnique).not.toHaveBeenCalled();
      expect(prisma.certificadoEvatics.update.mock.calls[0][0].data).toMatchObject({
        estado: 'RECHAZADO',
        motivoRechazo: 'Foto borrosa',
      });
    });

    it('rechazar exige motivo (schema)', () => {
      expect(revisarEvaticsSchema.safeParse({ decision: 'RECHAZADO' }).success).toBe(false);
      expect(
        revisarEvaticsSchema.safeParse({
          decision: 'RECHAZADO',
          motivo: 'Foto borrosa',
        }).success,
      ).toBe(true);
      expect(revisarEvaticsSchema.safeParse({ decision: 'APROBADO' }).success).toBe(true);
    });

    it('certificado inexistente: 404', async () => {
      prisma.certificadoEvatics.findUnique.mockResolvedValueOnce(null);
      await expect(service.revisar('x', 'APROBADO', undefined, SUPERVISOR)).rejects.toThrow(NotFoundException);
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
        {
          id: 'u-at',
          cedula: '0912345678',
          nombres: 'Carlos',
          apellidos: 'Pozo',
        },
        // También está en el personal: sale una sola vez.
        { id: 'u-ana', cedula: CED_ANA, nombres: 'Ana', apellidos: 'Pérez' },
      ]);
      prisma.certificadoEvatics.findMany.mockResolvedValue([
        certificado({
          estado: 'APROBADO',
          revisadoPor: { nombres: 'Jazmín', apellidos: 'Ayala' },
          revisadoEn: new Date('2026-11-12T14:30:00Z'),
        }),
      ]);
      prisma.parejaCda.findMany.mockResolvedValue([
        {
          operadorCdaId: 'op-ana',
          asistenteCdaId: null,
          recinto: { codigoRecinto: '1207', canton: { nombre: 'Ibarra' } },
        },
        {
          operadorCdaId: 'op-ana',
          asistenteCdaId: null,
          recinto: { codigoRecinto: '9999', canton: { nombre: 'Otavalo' } },
        },
      ]);
      distributivo.asignaciones.mockResolvedValue([
        {
          codigoRecinto: '1207',
          localidad: '',
          parroquia: '',
          numeroTecnico: 1,
          tecnico: 'Jairo Leal',
        },
      ]);
    });

    it('todo el personal y los AT, uno por cédula, con cantón (del último recinto) y Asistente Transversal', async () => {
      const r = await service.listado({}, ADMIN);
      expect(r.filas).toHaveLength(3);
      const ana = r.filas.find((f) => f.cedula === CED_ANA)!;
      expect(ana).toMatchObject({
        canton: 'Ibarra',
        tecnico: 'Jairo Leal',
        estado: 'APROBADO',
        revisadoPor: 'Jazmín Ayala',
        centro: 'CDA',
        esPropio: false,
        analisis: expect.objectContaining({
          proveedor: 'Gemini',
          nombreCoincide: true,
        }),
      });
      expect(r.filas.find((f) => f.cedula === CED_LUIS)).toMatchObject({
        canton: SIN_CANTON_EVATICS,
        tecnico: SIN_TECNICO_EVATICS,
        estado: 'SIN_SUBIR',
        centro: 'CPE',
      });
      expect(r.filas.find((f) => f.cedula === '0912345678')).toMatchObject({
        centro: 'AT',
        cargo: 'Asistente Transversal',
      });
      expect(r.totales).toEqual({
        total: 3,
        sinSubir: 2,
        pendientes: 0,
        aprobados: 1,
        rechazados: 0,
      });
      expect(r.porCanton[0]).toMatchObject({
        nombre: 'Ibarra',
        total: 1,
        aprobados: 1,
      });
      expect(r.porCanton.at(-1)).toMatchObject({
        nombre: SIN_CANTON_EVATICS,
        total: 2,
      });
      expect(r.porTecnico.find((g) => g.nombre === 'Jairo Leal')).toMatchObject({ total: 1, aprobados: 1 });
      expect(r.distributivoDisponible).toBe(true);
    });

    it('filtros: cantón y estado (sin tildes) y búsqueda por nombre o cédula; los conteos siguen siendo de todos', async () => {
      expect((await service.listado({ canton: 'ibarra' }, ADMIN)).filas.map((f) => f.cedula)).toEqual([CED_ANA]);
      expect((await service.listado({ estado: 'SIN_SUBIR' }, ADMIN)).filas).toHaveLength(2);
      expect((await service.listado({ q: 'perez' }, ADMIN)).filas.map((f) => f.cedula)).toEqual([CED_ANA]);
      const porCedula = await service.listado({ q: CED_LUIS }, ADMIN);
      expect(porCedula.filas.map((f) => f.cedula)).toEqual([CED_LUIS]);
      expect(porCedula.totales.total).toBe(3);
      expect((await service.listado({ cargo: 'receptor de actas' }, ADMIN)).filas.map((f) => f.cedula)).toEqual([
        CED_LUIS,
      ]);
      expect((await service.listado({ tecnico: 'Jairo Leal' }, ADMIN)).filas.map((f) => f.cedula)).toEqual([CED_ANA]);
    });

    it('sin distributivo (Drive caído) el listado sale igual, todos "Sin asistente"', async () => {
      distributivo.asignaciones.mockRejectedValue(new Error('Drive no responde'));
      const r = await service.listado({}, ADMIN);
      expect(r.distributivoDisponible).toBe(false);
      expect(r.filas.every((f) => f.tecnico === SIN_TECNICO_EVATICS)).toBe(true);
    });

    it('el supervisor ve su propia fila marcada', async () => {
      prisma.usuario.findUnique.mockResolvedValue({ cedula: CED_LUIS });
      prisma.operadorCda.findFirst.mockResolvedValue(null);
      const r = await service.listado({}, { sub: SUP, roles: ['TECNICO_SUPERVISOR'] });
      expect(r.filas.find((f) => f.cedula === CED_LUIS)?.esPropio).toBe(true);
      expect(r.filas.filter((f) => f.esPropio)).toHaveLength(1);
    });
  });

  it('fecha límite: se guarda como día y se lee igual', async () => {
    await expect(service.guardarConfig('2026-11-20')).resolves.toEqual({
      fechaLimite: '2026-11-20',
    });
    expect(prisma.configEvatics.upsert.mock.calls[0][0].update).toEqual({
      fechaLimite: new Date('2026-11-20T00:00:00Z'),
    });
    await service.guardarConfig(null);
    expect(prisma.configEvatics.upsert.mock.calls[1][0].update).toEqual({
      fechaLimite: null,
    });
  });

  it('aviso para la persona: certificado equivocado o ilegible; sin lectura, nada', () => {
    expect(avisoParaLaPersona(null)).toBeNull();
    expect(avisoParaLaPersona(LECTURA)).toBeNull();
    expect(avisoParaLaPersona({ ...LECTURA, esCertificadoEvatics: false })).toMatch(/no parece un certificado/);
  });
});
