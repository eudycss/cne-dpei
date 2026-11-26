import PizZip from 'pizzip';

import {
  camposActaMilitar,
  DatosActaMilitar,
  EN_BLANCO,
  generarWordActaMilitar,
  nombreArchivoActaMilitar,
  zipActasMilitares,
} from './acta-militar.documento';
import { InformeCustodiaService, militarDelRecinto } from './informe-custodia.service';

const datos: DatosActaMilitar = {
  // 28-nov-2026 08:00 en Ecuador = 13:00 UTC; es sábado.
  fecha: new Date('2026-11-28T13:00:00Z'),
  responsable: { nombre: 'Jairo Leal', cedula: '1205015785', cargo: 'Asistente Electoral Transversal' },
  militar: { nombre: 'Herrera Cadena Christian Becker', cedula: '1003199443', grado: 'CBOP' },
  kitNumero: '17',
  recintoTexto: '1359 – Unidad Educativa Víctor Manuel Guzmán (kit 2)',
  operador: { nombre: 'Lizeth Selena Andrade Chasipanta', cedula: '1004405716' },
};

/** Texto visible del Word (une los fragmentos de cada párrafo). */
function textoWord(docx: Buffer): string {
  const xml = new PizZip(docx).file('word/document.xml')!.asText();
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [])
    .map((p) => (p.match(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join(''))
    .join('\n');
}

describe('acta de constancia y custodia (militar)', () => {
  it('llena la plantilla oficial igual que el acta de ejemplo', () => {
    const texto = textoWord(generarWordActaMilitar(datos));

    expect(texto).toContain('Ibarra 28 noviembre 2026');
    // El día de la semana se calcula: el 28-nov-2026 es sábado (la plantilla decía domingo).
    expect(texto).toContain('siendo el día sábado 28 de noviembre de 2026 , el Ing. Jairo Leal');
    expect(texto).toContain('Nro. 1205015785, en calidad de Asistente Electoral Transversal, realiza la entrega');
    expect(texto).toContain('custodia al CBOP. Herrera Cadena Christian Becker, portador de la cédula de ciudadanía Nro. 1003199443');
    expect(texto).toContain('un (1) kit técnico electoral (Kit Nro. 17)');
    expect(texto).toContain('NUMERO DE KIT (S): 17');
    expect(texto).toContain('Recinto:  1359 – Unidad Educativa Víctor Manuel Guzmán (kit 2)');
    expect(texto).toContain('Operador CDA  Lizeth Selena Andrade Chasipanta , portador de la cédula de ciudadanía Nro. 1004405716');
    expect(texto).toContain('CBOP. Herrera Cadena Christian Becker');
    // No queda ningún campo sin llenar ni dato del ejemplo.
    expect(texto).not.toMatch(/[{}]/);
    expect(texto).not.toContain('domingo');
  });

  it('usa la hora de Ecuador: las 23:00 del 27 siguen siendo viernes 27', () => {
    const c = camposActaMilitar({ ...datos, fecha: new Date('2026-11-28T04:00:00Z') });
    expect(c).toMatchObject({ diaSemana: 'viernes', dia: '27', mes: 'noviembre', anio: '2026' });
  });

  it('sin grado no deja ". " suelto; lo que falta queda en línea para llenar a mano', () => {
    const c = camposActaMilitar({ ...datos, militar: { ...datos.militar!, grado: null }, responsable: null, operador: null });
    expect(c.militarGrado).toBe('');
    expect(c.militarNombre).toBe('Herrera Cadena Christian Becker');
    expect(c.militarFirma).toBe('Herrera Cadena Christian Becker');
    expect(c.responsableNombre).toBe(EN_BLANCO);
    expect(c.operadorCedula).toBe(EN_BLANCO);

    const sinMilitar = camposActaMilitar({ ...datos, militar: null });
    expect(sinMilitar.militarNombre).toBe(EN_BLANCO);
    expect(sinMilitar.militarGrado).toBe('');
  });

  it('quita caracteres de control que dañarían el Word', () => {
    const c = camposActaMilitar({ ...datos, operador: { nombre: 'Ana\u0007 Pérez', cedula: '1' } });
    expect(c.operadorNombre).toBe('Ana Pérez');
  });

  it('el .zip lleva un Word por kit y los nombres de archivo son seguros', () => {
    const zip = new PizZip(
      zipActasMilitares([
        { archivo: 'a.docx', datos },
        { archivo: 'b.docx', datos },
      ]),
    );
    expect(Object.keys(zip.files).sort()).toEqual(['a.docx', 'b.docx']);
    expect(nombreArchivoActaMilitar('17', '1359')).toBe('acta_militar_17_1359.docx');
    expect(nombreArchivoActaMilitar('../x"y', null)).toBe('acta_militar_xy.docx');
  });

  describe('militarDelRecinto (acta impresa antes de la entrega)', () => {
    const conGrado = { nombres: 'C', apellidos: 'H', cedula: '1', grado: 'CBOP' };
    const sinGrado = { nombres: 'D', apellidos: 'P', cedula: '2', grado: null };

    it('elige el único con grado (los del cronograma) aunque haya registros de prueba', () => {
      expect(militarDelRecinto([sinGrado, conGrado])).toBe(conGrado);
    });

    it('sin grado, solo si hay uno; si hay duda queda en blanco', () => {
      expect(militarDelRecinto([sinGrado])).toBe(sinGrado);
      expect(militarDelRecinto([sinGrado, { ...sinGrado, cedula: '3' }])).toBeNull();
      expect(militarDelRecinto([conGrado, { ...conGrado, cedula: '4' }])).toBeNull();
      expect(militarDelRecinto([])).toBeNull();
    });
  });
});

describe('InformeCustodiaService — actas militares', () => {
  const eventoId = '22222222-2222-2222-2222-222222222222';
  const kitId = '33333333-3333-3333-3333-333333333333';
  const recintoId = '44444444-4444-4444-4444-444444444444';
  const asistente = { id: 'as1', nombres: 'Jairo', apellidos: 'Leal', cedula: '1205015785', roles: [{ rol: { nombre: 'ASISTENTE_TRANSVERSAL' } }] };
  const admin = { id: 'ad1', nombres: 'Edison', apellidos: 'Mafla', cedula: '1001001001', roles: [{ rol: { nombre: 'ADMINISTRADOR' } }] };
  const militarCrono = { recintoId, nombres: 'Christian Becker', apellidos: 'Herrera Cadena', cedula: '1003199443', grado: 'CBOP' };

  function kit(overrides: Record<string, unknown> = {}) {
    return {
      id: kitId,
      codigoUnico: 'ABCD2345',
      nombre: '1359 — Unidad Educativa Víctor Manuel Guzmán (kit 2)',
      recintoId,
      recinto: { codigoRecinto: '1359', nombre: 'UE VMG', cantonId: 30, canton: { nombre: 'IBARRA' } },
      operador: { id: 'op1', nombres: 'Lizeth Selena', apellidos: 'Andrade Chasipanta', cedula: '1004405716' },
      itemsContenido: [],
      entregaCustodio: null,
      ...overrides,
    };
  }

  let prisma: any;
  let service: InformeCustodiaService;

  beforeEach(() => {
    prisma = {
      eventoElectoral: { findFirst: jest.fn().mockResolvedValue({ id: eventoId, nombre: 'Elecciones 2027' }) },
      kitElectoral: { findMany: jest.fn().mockResolvedValue([kit()]), findFirst: jest.fn().mockResolvedValue({ id: kitId }) },
      recepcionKit: { findMany: jest.fn().mockResolvedValue([]) },
      recepcionDpiKit: { findMany: jest.fn().mockResolvedValue([]) },
      correccionCustodiaKit: { findMany: jest.fn().mockResolvedValue([]) },
      mochilaKit: { findMany: jest.fn().mockResolvedValue([{ codigoUnico: 'ABCD2345', numero: 17 }]) },
      usuario: {
        findMany: jest.fn().mockImplementation((args: any) =>
          Promise.resolve(args?.select?.roles ? [asistente, admin].filter((u) => args.where.id.in.includes(u.id)) : []),
        ),
      },
      militar: { findMany: jest.fn().mockResolvedValue([militarCrono]) },
    };
    service = new InformeCustodiaService(prisma, { readDecrypted: jest.fn() } as any);
  });

  it('sin entrega: militar del recinto, quien descarga y el N.º de mochila', async () => {
    const acta = await service.actaMilitarKit(kitId, asistente.id);
    const texto = textoWord(acta.contenido);

    expect(acta.nombre).toBe('acta_militar_17_1359.docx');
    expect(texto).toContain('el Ing. Jairo Leal');
    expect(texto).toContain('en calidad de Asistente Electoral Transversal');
    expect(texto).toContain('custodia al CBOP. Herrera Cadena Christian Becker');
    expect(texto).toContain('(Kit Nro. 17)');
    expect(texto).toContain('1359 – Unidad Educativa Víctor Manuel Guzmán (kit 2)');
    expect(texto).toContain('Lizeth Selena Andrade Chasipanta');
  });

  it('con entrega registrada: militar, responsable y fecha de la entrega', async () => {
    prisma.kitElectoral.findMany.mockResolvedValue([
      kit({
        entregaCustodio: {
          entregadoPorId: admin.id,
          entregadoEn: new Date('2026-11-28T13:00:00Z'),
          militarDeOtroRecinto: true,
          militar: { nombres: 'Pedro', apellidos: 'Mora Vega', cedula: '1005006007', grado: 'SGOS' },
        },
      }),
    ]);
    const texto = textoWord((await service.actaMilitarKit(kitId, asistente.id)).contenido);

    expect(texto).toContain('día sábado 28 de noviembre de 2026');
    expect(texto).toContain('el Ing. Edison Mafla');
    expect(texto).toContain('en calidad de Analista Provincial de Seguridad Informática');
    expect(texto).toContain('custodia al SGOS. Mora Vega Pedro');
  });

  it('un kit de otro evento no tiene acta (404)', async () => {
    prisma.kitElectoral.findFirst.mockResolvedValue(null);
    await expect(service.actaMilitarKit(kitId, asistente.id)).rejects.toThrow('Kit no encontrado');
  });

  it('el .zip de actas pide filtrar si no hay kits o si pasan el tope', async () => {
    prisma.kitElectoral.findMany.mockResolvedValue([]);
    await expect(service.actasMilitares({}, asistente.id)).rejects.toThrow('No hay kits');

    prisma.kitElectoral.findMany.mockResolvedValue(Array.from({ length: 201 }, (_, i) => kit({ id: `k${i}` })));
    await expect(service.actasMilitares({}, asistente.id)).rejects.toThrow('Filtra por cantón');
  });

  it('el .zip trae un Word por kit', async () => {
    const zip = new PizZip(await service.actasMilitares({ cantonId: 30 }, asistente.id));
    expect(Object.keys(zip.files)).toEqual(['acta_militar_17_1359.docx']);
  });
});
