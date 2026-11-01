import { BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ParejaCdaFila } from '@cne/shared-types';

import { ReporteTecnicosCdaService } from './reporte-tecnicos-cda.service';
import type { FilaTecnico } from './reporte-tecnicos-cda';

const DIA = '2026-11-01';
const persona = (id: string, nombre: string, telefono: string | null) => ({
  id,
  apellidosNombres: nombre,
  cedula: '1710034065',
  telefono,
  dispositivo: 'ANDROID' as const,
  grupo: 'OPERADOR' as const,
});
const fila = (id: string, codigo: string, telefono: string | null = '0991234567'): FilaTecnico => ({
  pareja: {
    id,
    fecha: DIA,
    recinto: { id: `r${codigo}`, codigo, nombre: `Recinto ${codigo}` },
    operador: persona(`op${id}`, 'PEREZ LOPEZ ANA', telefono),
    asistente: null,
    portador: persona(`op${id}`, 'PEREZ LOPEZ ANA', telefono),
    kitCodigo: 'K1',
    estado: 'EN_APP',
    recintoCompartido: false,
    puedeRecibirKit: false,
    articulos: null,
  } as ParejaCdaFila,
  ingresa: 'OPERADOR',
  lleva: null,
});

describe('ReporteTecnicosCdaService', () => {
  const parejas = { listarConIngreso: jest.fn() };
  const distributivo = { asignaciones: jest.fn() };
  const service = new ReporteTecnicosCdaService(parejas as never, distributivo as never);

  beforeEach(() => {
    jest.clearAllMocks();
    parejas.listarConIngreso.mockResolvedValue({
      dia: { fecha: DIA, evento: { id: 'ev', nombre: 'Simulacro' }, congelado: false, parejas: [] },
      filas: [fila('p1', '96'), fila('p2', '1286'), fila('p3', '9999')],
    });
    distributivo.asignaciones.mockResolvedValue([
      { codigoRecinto: '96', tecnico: 'Ing. Jairo Leal', numeroTecnico: 1, parroquia: '', localidad: '' },
      { codigoRecinto: '1286', tecnico: 'Ing. Sebastian Cabascango', numeroTecnico: 2, parroquia: '', localidad: '' },
    ]);
  });

  it('tecnicos: cada técnico del distributivo con sus recintos y parejas del día, más "sin técnico"', async () => {
    expect(await service.tecnicos(DIA)).toEqual([
      { nombre: 'Ing. Jairo Leal', recintos: 1, parejas: 1 },
      { nombre: 'Ing. Sebastian Cabascango', recintos: 1, parejas: 1 },
      { nombre: null, recintos: 1, parejas: 1 },
    ]);
    expect(parejas.listarConIngreso).toHaveBeenCalledWith(DIA);
  });

  it('si el Drive no responde, lo dice claro (503) y no deja el error crudo', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    distributivo.asignaciones.mockRejectedValue(new Error('ECONNRESET'));
    await expect(service.tecnicos(DIA)).rejects.toThrow(ServiceUnavailableException);
    await expect(service.tecnicos(DIA)).rejects.toThrow('No se pudo leer el distributivo de técnicos');
    warn.mockRestore();
  });

  it('reporte: solo los técnicos elegidos (sin importar mayúsculas ni tildes), en el orden del distributivo', async () => {
    const r = await service.reporte(DIA, ['SIN_TECNICO', 'ing. sebastián cabascango'], 'xlsx');
    expect(r.nombre).toBe(`parejas_por_tecnico_${DIA}_${DIA}.xlsx`);
    expect(r.contenido.subarray(0, 2).toString()).toBe('PK');
  });

  it('un técnico que no está en el distributivo es un error 400', async () => {
    await expect(service.reporte(DIA, ['Ing. Nadie'], 'pdf')).rejects.toThrow(BadRequestException);
    await expect(service.contactos(DIA, ['Ing. Nadie'])).rejects.toThrow('no está en el distributivo: Ing. Nadie');
  });

  it('"sin técnico" pedido cuando no hay recintos fuera del distributivo: hoja vacía, no error', async () => {
    parejas.listarConIngreso.mockResolvedValue({ dia: { fecha: DIA, evento: null, congelado: false, parejas: [] }, filas: [fila('p1', '96')] });
    await expect(service.reporte(DIA, ['SIN_TECNICO'], 'xlsx')).resolves.toMatchObject({ tipo: expect.stringContaining('spreadsheet') });
  });

  it('contactos: .vcf de los elegidos; sin ningún celular es un error 400', async () => {
    const a = await service.contactos(DIA, ['Ing. Jairo Leal']);
    expect(a).toMatchObject({ nombre: `contactos_parejas_${DIA}.vcf`, tipo: 'text/vcard; charset=utf-8' });
    expect(a.contenido.toString('utf8')).toContain('FN:96.Ana.Perez.Jairo');

    parejas.listarConIngreso.mockResolvedValue({ dia: { fecha: DIA, evento: null, congelado: false, parejas: [] }, filas: [fila('p1', '96', null)] });
    await expect(service.contactos(DIA, ['Ing. Jairo Leal'])).rejects.toThrow('ningún contacto con celular');
  });
});
