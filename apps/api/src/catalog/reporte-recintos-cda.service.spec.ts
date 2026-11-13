import { ReporteRecintosCdaService } from './reporte-recintos-cda.service';

describe('ReporteRecintosCdaService', () => {
  const fila = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    codigoRecinto: `C-${id}`,
    nombre: `Recinto ${id}`,
    parroquia: null,
    direccion: null,
    juntasFemeninas: 1,
    juntasMasculinas: 1,
    cdaDestinoId: null,
    canton: { nombre: 'Ibarra' },
    ...extra,
  });
  const findMany = jest.fn();
  const findUnique = jest.fn();
  const service = new ReporteRecintosCdaService({ recinto: { findMany }, canton: { findUnique } } as never);

  beforeEach(() => {
    findMany.mockReset();
    findUnique.mockReset().mockResolvedValue({ nombre: 'Ibarra' });
    findMany.mockResolvedValueOnce([fila('a')]).mockResolvedValueOnce([fila('n', { cdaDestinoId: 'a' })]);
  });

  it('genera un Excel válido (zip) y consulta solo recintos activos', async () => {
    const a = await service.reporte('xlsx');
    expect(a.nombre).toMatch(/^recintos_cda_no_cda_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(a.contenido.subarray(0, 2).toString()).toBe('PK');
    expect(findMany.mock.calls.every(([q]) => q.where.activo === true)).toBe(true);
  });

  it('genera un PDF', async () => {
    const a = await service.reporte('pdf');
    expect(a.contenido.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('con cantón filtra los CDA por cantón y trae los NO CDA de sus CDA o sueltos del cantón', async () => {
    await service.reporte('xlsx', 3);
    expect(findMany.mock.calls[0][0].where).toMatchObject({ tipo: 'CDA', cantonId: 3 });
    expect(findMany.mock.calls[1][0].where.OR).toEqual([
      { cdaDestinoId: { in: ['a'] } },
      { cantonId: 3, cdaDestinoId: null },
    ]);
  });

  it('el detalle nombra el cantón filtrado aunque no tenga CDA', async () => {
    findMany.mockReset().mockResolvedValue([]);
    findUnique.mockResolvedValue({ nombre: 'Pimampiro' });
    const a = await service.reporte('xlsx', 9);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 9 }, select: { nombre: true } });
    expect(a.contenido.length).toBeGreaterThan(0);
  });
});
