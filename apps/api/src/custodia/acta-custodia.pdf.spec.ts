import { fechaLarga, generarActasPdf, textoActa, type DatosActa } from './acta-custodia.pdf';

const asistente = { nombre: 'LUIS MIGUEL VILLARREAL VALLEJO', cedula: '0401307459' };
const militar = { nombre: 'JUAN PÉREZ', cedula: '1002003004' };
const operador = { nombre: 'PIZARRO VILLACIS CHRISTIAN FEDERICO', cedula: '1002249124' };

function acta(over: Partial<DatosActa> = {}): DatosActa {
  return {
    eventoNombre: 'Elecciones 2027',
    codigoUnico: 'KIT-001',
    recinto: 'UE García Moreno, cod: 1961',
    canton: 'Ibarra',
    articulos: [{ articulo: 'Laptop', serie: '5CD445577S', estadoSalida: 'BUENO', estadoRetorno: null }],
    entrega: { militar, fecha: new Date('2026-11-16T15:00:00Z'), asistente },
    recepcion: null,
    devolucion: null,
    correcciones: [],
    operador,
    militar,
    asistente,
    ...over,
  };
}

describe('acta de custodia — texto', () => {
  it('la fecha va como en la plantilla en Word, en hora de Ecuador', () => {
    expect(fechaLarga(new Date('2026-11-16T15:00:00Z'))).toBe('16 de noviembre del 2026');
    // 02:00 UTC del 17 todavía es el 16 en Ecuador (UTC-5).
    expect(fechaLarga(new Date('2026-11-17T02:00:00Z'))).toBe('16 de noviembre del 2026');
  });

  it('narra la cadena con nombres, cédulas, kit, recinto y fecha de la entrega', () => {
    const t = textoActa(acta());
    expect(t).toMatch(/^En la ciudad de Ibarra, al día 16 de noviembre del 2026/);
    expect(t).toContain('LUIS MIGUEL VILLARREAL VALLEJO con C.C. 0401307459, ASISTENTE ELECTORAL TRANSVERSAL');
    expect(t).toContain('ENTREGA DEL KIT CDA KIT-001 al MILITAR JUAN PÉREZ con C.C. 1002003004');
    expect(t).toContain('OPERADOR CDA PIZARRO VILLACIS CHRISTIAN FEDERICO con C.C. 1002249124');
    expect(t).toContain('recinto UE García Moreno, cod: 1961, cantón Ibarra.');
    expect(t).not.toContain('devuelve');
  });

  it('lo que falta queda en blanco para llenarlo a mano', () => {
    const t = textoActa(acta({ entrega: null, militar: null }));
    expect(t).toContain('al día ____');
    expect(t).toContain('MILITAR ____________________ con C.C. ____________________');
  });

  it('quien entrega es el asistente de la entrega, aunque otro haya recibido el retorno', () => {
    const otro = { nombre: 'OTRO ASISTENTE', cedula: '1111111111' };
    expect(textoActa(acta({ asistente: otro }))).toContain('Sr./Srta. LUIS MIGUEL VILLARREAL VALLEJO con C.C. 0401307459');
  });

  it('menciona la devolución solo si se registró', () => {
    const t = textoActa(
      acta({ devolucion: { fecha: new Date('2026-11-17T01:00:00Z'), asistente, observaciones: null } }),
    );
    expect(t).toContain('el OPERADOR CDA devuelve el kit al ASISTENTE ELECTORAL TRANSVERSAL');
  });

  it('el PDF sale con el logo (una imagen incrustada)', async () => {
    const pdf = await generarActasPdf([acta(), acta({ codigoUnico: 'KIT-002' })]);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.toString('latin1').match(/\/Subtype \/Image/g)).toHaveLength(1);
  });
});
