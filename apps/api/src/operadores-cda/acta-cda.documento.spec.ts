import PizZip from 'pizzip';

import {
  camposPlantilla,
  type DatosActaCda,
  generarPdfActasCda,
  generarWordActaCda,
  NOMBRE_UNIDAD,
  nombreArchivoActa,
  nombresUnicos,
  textoActaCda,
  zipArchivos,
} from './acta-cda.documento';

const DATOS: DatosActaCda = {
  lugar: 'Ibarra',
  fecha: '2026-10-05',
  entregaNombre: 'Ana Técnica',
  entregaCedula: '1710034065',
  entregaCargo: 'Asistente Electoral Transversal',
  operadorNombre: 'Pérez López Juan & Hijos <x>',
  operadorCedula: '1001001005',
  estadoPeto: 'BUENO',
  estadoCredencial: 'NUEVO',
  estadoCordon: 'REGULAR',
};

/** Texto plano del document.xml de un .docx. */
function textoDocx(buf: Buffer): string {
  const xml = new PizZip(buf).file('word/document.xml')!.asText();
  return [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
}

describe('acta de entrega CDA (documento)', () => {
  it('fecha en palabras como la plantilla: día sin cero, mes en minúsculas', () => {
    expect(camposPlantilla(DATOS)).toMatchObject({ dia: '5', mes: 'octubre', anio: '2026' });
    expect(camposPlantilla({ ...DATOS, fecha: '2027-01-31' })).toMatchObject({ dia: '31', mes: 'enero', anio: '2027' });
  });

  it('nombres y cargos en mayúsculas; quien entrega siempre es "Ing."', () => {
    expect(textoActaCda(DATOS)).toBe(
      'En la ciudad de Ibarra a los 5 días del mes de octubre del 2026, el Ing. ANA TÉCNICA con C.I. 1710034065 ' +
        'ASISTENTE ELECTORAL TRANSVERSAL; realiza la Entrega de indumentaria y credencial; al Sr./Srta. ' +
        'PÉREZ LÓPEZ JUAN & HIJOS <X> con C.I. 1001001005 OPERADOR CDA',
    );
  });

  it('el Word sale de la plantilla con todos los campos llenos y el XML escapado', () => {
    const texto = textoDocx(generarWordActaCda(DATOS));
    expect(texto).toContain('En la ciudad de Ibarra a los 5 días del mes de octubre del 2026, el Ing. ANA TÉCNICA');
    expect(texto).toContain('PÉREZ LÓPEZ JUAN &amp; HIJOS &lt;X&gt;');
    expect(texto).toContain('PETO BUENOCREDENCIALNUEVOCORDON CREDENCIALREGULAR');
    expect(texto).not.toMatch(/[{}]/); // ningún campo sin reemplazar
  });

  it('el encabezado del Word lleva el nombre completo de la Unidad', () => {
    const header = new PizZip(generarWordActaCda(DATOS)).file('word/header1.xml')!.asText();
    expect(header).toContain(`>${NOMBRE_UNIDAD}</w:t>`);
    expect(header).not.toContain('UNIDAD PROVINCIAL DE SEGURIDAD INFORMÁTICA');
  });

  it('la plantilla del repositorio no trae datos personales ni la combinación de correspondencia', () => {
    const zip = new PizZip(generarWordActaCda(DATOS));
    expect(zip.file('word/recipientData.xml')).toBeNull();
    expect(zip.file('word/settings.xml')!.asText()).not.toContain('mailMerge');
    const texto = textoDocx(generarWordActaCda(DATOS));
    expect(texto).not.toContain('Tnlg');
    // Las únicas cédulas del documento son las del acta (la plantilla no trae las del ejemplo original).
    expect(texto.match(/\d{10}/g)?.sort()).toEqual(['1001001005', '1710034065']);
  });

  it('el PDF es un PDF de una página por acta', async () => {
    const pdf = await generarPdfActasCda([DATOS, DATOS]);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2);
  });

  it('nombre de archivo en ASCII y sin la cédula completa', () => {
    expect(nombreArchivoActa('PÉREZ  LÓPEZ, Ñandú', '1001001005')).toBe('acta-perez-lopez-nandu-1005');
    expect(nombreArchivoActa('***', '1001001005')).toBe('acta-operador-1005');
    // Solo dígitos de la cédula: nada de comillas o saltos en la cabecera.
    expect(nombreArchivoActa('Ana', '10"\n3-4')).toBe('acta-ana-1034');
  });

  it('quita caracteres de control (dejarían el Word dañado), también los que vengan del Excel', () => {
    const d = { ...DATOS, operadorNombre: 'RUIZ\u0000 MERA\u000B LUIS', lugar: 'Iba\u0007rra' };
    expect(camposPlantilla(d)).toMatchObject({ operadorNombre: 'RUIZ MERA LUIS', lugar: 'Ibarra' });
    expect(textoDocx(generarWordActaCda(d))).toContain('RUIZ MERA LUIS');
  });

  it('con textos al máximo permitido el acta sigue en una sola página', async () => {
    const largo = (n: number) => 'ABCDEFGHIJ '.repeat(n / 11).slice(0, n);
    const pdf = await generarPdfActasCda([
      { ...DATOS, entregaNombre: largo(200), entregaCargo: largo(160), operadorNombre: largo(200), lugar: largo(80) },
    ]);
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(1);
  });

  it('nombres repetidos en el ZIP reciben un sufijo', () => {
    expect(nombresUnicos(['a', 'b', 'a', 'a'])).toEqual(['a', 'b', 'a-2', 'a-3']);
  });

  it('el ZIP contiene cada archivo con su ruta', () => {
    const zip = new PizZip(zipArchivos([{ nombre: 'pdf/a.pdf', contenido: Buffer.from('x') }]));
    expect(zip.file('pdf/a.pdf')!.asText()).toBe('x');
  });
});
