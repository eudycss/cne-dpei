import { ForbiddenException } from '@nestjs/common';
import { EventoNoReabiertoGuard } from './evento-no-reabierto.guard';

describe('EventoNoReabiertoGuard', () => {
  function guardCon(evento: { reabiertoEn: Date | null } | null) {
    const prisma = { eventoElectoral: { findFirst: jest.fn().mockResolvedValue(evento) } };
    return { guard: new EventoNoReabiertoGuard(prisma as any), prisma };
  }

  it('deja pasar si no hay evento activo (el servicio responde su propio error)', async () => {
    const { guard } = guardCon(null);
    await expect(guard.canActivate()).resolves.toBe(true);
  });

  it('deja pasar con un evento activo normal', async () => {
    const { guard, prisma } = guardCon({ reabiertoEn: null });
    await expect(guard.canActivate()).resolves.toBe(true);
    expect(prisma.eventoElectoral.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { estado: 'ACTIVO' } }),
    );
  });

  it('bloquea con 403 si el evento activo fue reabierto para consulta', async () => {
    const { guard } = guardCon({ reabiertoEn: new Date() });
    await expect(guard.canActivate()).rejects.toBeInstanceOf(ForbiddenException);
  });
});
