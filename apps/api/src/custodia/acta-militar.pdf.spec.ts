import { writeFileSync } from 'fs';

import PDFDocument from 'pdfkit';

import type { DatosActaMilitar } from './acta-militar.documento';
import { generarPdfActasMilitares } from './acta-militar.pdf';

const acta = (over: Partial<DatosActaMilitar> = {}): DatosActaMilitar => ({
  fecha: new Date('2026-11-28T12:00:00Z'),
  responsable: { nombre: 'Jairo Leal Aviles', cedula: '1002003004', cargo: 'ASISTENTE ELECTORAL TRANSVERSAL' },
  militar: { nombre: 'Herrera Cadena Luis', cedula: '1712345678', grado: 'CBOP' },
  kitNumero: '17',
  recintoTexto: '1359 – Unidad Educativa Teodoro Gómez de la Torre (kit 2)',
  operador: { nombre: 'Pérez López Ana', cedula: '1002003000' },
  ...over,
});

describe('generarPdfActasMilitares', () => {
  it('una página por kit, con el texto de la plantilla y los datos de cada acta', async () => {
    // spyOn deja pasar la llamada: se dibuja igual y quedan los textos (pdfkit comprime el contenido).
    const espia = jest.spyOn(PDFDocument.prototype, 'text');
    try {
      const pdf = await generarPdfActasMilitares([acta(), acta({ kitNumero: '18', militar: null, operador: null })]);
      expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
      expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(2);
      if (process.env.ACTA_MILITAR_PDF_MUESTRA) writeFileSync(process.env.ACTA_MILITAR_PDF_MUESTRA, pdf);

      const todo = espia.mock.calls.map((c) => (typeof c[0] === 'string' ? c[0] : '')).join('');
      expect(todo).toContain('ACTA DE CONSTANCIA Y CUSTODIA');
      expect(todo).toContain('Ibarra 28 noviembre 2026');
      expect(todo).toContain('siendo el día sábado 28 de noviembre de 2026');
      expect(todo).toContain('Ing. Jairo Leal Aviles');
      expect(todo).toContain('CBOP. Herrera Cadena Luis');
      expect(todo).toContain('un (1) kit técnico electoral (Kit Nro. 17)');
      expect(todo).toContain('Recinto: 1359 – Unidad Educativa Teodoro Gómez de la Torre (kit 2)');
      expect(todo).toContain('Custodio final-Operador CDA');
      // Sin militar ni operador: líneas en blanco para llenar a mano.
      expect(todo).toContain('____________________');
    } finally {
      espia.mockRestore();
    }
  });

  it('sin actas devuelve un PDF con el aviso', async () => {
    const pdf = await generarPdfActasMilitares([]);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });
});
