import type { PersonaDistribucionDias } from '@cne/shared-types';
import { claveEncargado, contactosVcard, ordenarPersonas, repartirEnDias, reporteDistribucion, totalesPorDia } from './distribucion-dias';

const DIAS = ['2026-11-20', '2026-11-21', '2026-11-22'];

function personal(hombres: number, mujeres: number, sinSexo = 0) {
  return [
    ...Array.from({ length: hombres }, (_, i) => ({ id: `h${i}`, sexo: 'M' as const })),
    ...Array.from({ length: mujeres }, (_, i) => ({ id: `m${i}`, sexo: 'F' as const })),
    ...Array.from({ length: sinSexo }, (_, i) => ({ id: `x${i}`, sexo: null })),
  ];
}

function persona(p: Partial<PersonaDistribucionDias>): PersonaDistribucionDias {
  return {
    id: 'p',
    fecha: DIAS[0],
    operadorId: 'o',
    nombres: 'PÉREZ JUAN',
    cedula: '1712345678',
    telefono: '0991234567',
    sexo: 'M',
    cargo: 'Operadores CDA',
    canton: 'IBARRA',
    encargado: 'Willy',
    ...p,
  };
}

describe('repartirEnDias', () => {
  it('reparte 65 hombres y 93 mujeres (el caso real) de forma pareja entre 3 días', () => {
    const r = repartirEnDias(personal(65, 93), DIAS);
    const t = totalesPorDia(r.map(({ persona: p, fecha }) => ({ fecha, sexo: p.sexo })), DIAS);
    expect(t.map((d) => d.hombres)).toEqual([22, 22, 21]);
    expect(t.map((d) => d.mujeres)).toEqual([31, 31, 31]);
    // La ronda de mujeres sigue donde quedaron los hombres: el total también queda parejo.
    const totales = t.map((d) => d.total);
    expect(Math.max(...totales) - Math.min(...totales)).toBeLessThanOrEqual(1);
    expect(totales.reduce((a, b) => a + b, 0)).toBe(158);
  });

  it('cada persona va exactamente un día', () => {
    const lista = personal(10, 14, 2);
    const r = repartirEnDias(lista, DIAS);
    expect(r).toHaveLength(lista.length);
    expect(new Set(r.map((x) => x.persona.id)).size).toBe(lista.length);
    for (const x of r) expect(DIAS).toContain(x.fecha);
  });

  it('quienes no tienen sexo registrado también se reparten parejo', () => {
    const r = repartirEnDias(personal(0, 0, 4), DIAS);
    const t = totalesPorDia(r.map(({ persona: p, fecha }) => ({ fecha, sexo: p.sexo })), DIAS);
    expect(t.map((d) => d.sinSexo)).toEqual([2, 1, 1]);
  });

  it('con un solo día todos van ese día', () => {
    const r = repartirEnDias(personal(2, 3), ['2026-11-20']);
    expect(new Set(r.map((x) => x.fecha))).toEqual(new Set(['2026-11-20']));
  });

  it('sin días es un error de programación', () => {
    expect(() => repartirEnDias(personal(1, 1), [])).toThrow();
  });
});

describe('totalesPorDia', () => {
  it('devuelve todos los días en orden, aunque alguno quede vacío, e ignora fechas ajenas', () => {
    const t = totalesPorDia(
      [
        { fecha: DIAS[2], sexo: 'F' },
        { fecha: DIAS[0], sexo: 'M' },
        { fecha: '2026-12-01', sexo: 'M' },
      ],
      DIAS,
    );
    expect(t).toEqual([
      { fecha: DIAS[0], hombres: 1, mujeres: 0, sinSexo: 0, total: 1 },
      { fecha: DIAS[1], hombres: 0, mujeres: 0, sinSexo: 0, total: 0 },
      { fecha: DIAS[2], hombres: 0, mujeres: 1, sinSexo: 0, total: 1 },
    ]);
  });
});

describe('ordenarPersonas', () => {
  it('ordena por día, encargado, cantón y nombre (sin encargado al final del día)', () => {
    const r = ordenarPersonas([
      persona({ id: '1', fecha: DIAS[1], encargado: 'Ana' }),
      persona({ id: '2', fecha: DIAS[0], encargado: null }),
      persona({ id: '3', fecha: DIAS[0], encargado: 'Willy', canton: 'OTAVALO' }),
      persona({ id: '4', fecha: DIAS[0], encargado: 'Willy', canton: 'IBARRA', nombres: 'ZAMBRANO' }),
      persona({ id: '5', fecha: DIAS[0], encargado: 'Willy', canton: 'IBARRA', nombres: 'ÁLVAREZ' }),
    ]);
    expect(r.map((p) => p.id)).toEqual(['5', '4', '3', '2', '1']);
  });
});

describe('claveEncargado', () => {
  it('no distingue mayúsculas, tildes ni espacios de más', () => {
    expect(claveEncargado('  Sebastián   Cabascango ')).toBe(claveEncargado('SEBASTIAN CABASCANGO'));
    expect(claveEncargado(null)).toBe('');
  });
});

describe('reporteDistribucion', () => {
  const d = {
    nombre: 'Fin de semana',
    fechas: DIAS,
    personas: [
      persona({ id: '1', fecha: DIAS[0], encargado: 'Willy', sexo: 'M' }),
      persona({ id: '2', fecha: DIAS[0], encargado: 'Edison Mafla', sexo: 'F', telefono: null, canton: null }),
      persona({ id: '3', fecha: DIAS[1], encargado: 'Willy', sexo: 'F' }),
    ],
  };

  it('varios días: resumen al inicio y una hoja por día (vacío dice que no hay nadie)', () => {
    const r = reporteDistribucion(d, {});
    expect(r.tablas.map((t) => t.hoja)).toEqual(['Resumen', '20-11-2026', '21-11-2026', '22-11-2026']);
    expect(r.tablas[0].filas.at(-1)).toEqual(['Total', 1, 2, 0, 3]);
    expect(r.tablas[3].filas).toEqual([['', 'Nadie asignado este día', '', '', '', '', '', '']]);
    expect(r.desde).toBe(DIAS[0]);
    expect(r.hasta).toBe(DIAS[2]);
    expect(r.limitarDiasPdf).toBe(false);
  });

  it('columnas: N.º, nombres, cédula, celular, sexo, cargo, cantón y encargado (vacíos como texto vacío)', () => {
    const r = reporteDistribucion(d, { fecha: DIAS[0] });
    expect(r.tablas.map((t) => t.columnas.map((c) => c.titulo))[0]).toEqual([
      'N.º',
      'Apellidos y nombres',
      'Cédula',
      'Celular',
      'Sexo',
      'Cargo',
      'Cantón',
      'Encargado',
    ]);
    // Un solo día: sin resumen.
    expect(r.tablas).toHaveLength(1);
    expect(r.tablas[0].filas).toEqual([
      [1, 'PÉREZ JUAN', '1712345678', '', 'Mujer', 'Operadores CDA', '', 'Edison Mafla'],
      [2, 'PÉREZ JUAN', '1712345678', '0991234567', 'Hombre', 'Operadores CDA', 'IBARRA', 'Willy'],
    ]);
    expect(r.tablas[0].titulo).toContain('1 hombres, 1 mujeres (total 2)');
  });

  it('filtra por encargado sin importar mayúsculas', () => {
    const r = reporteDistribucion(d, { encargado: 'WILLY' });
    const filas = r.tablas.slice(1).flatMap((t) => t.filas.filter((f) => f[0] !== ''));
    expect(filas).toHaveLength(2);
    expect(r.detalle).toContain('Encargado: WILLY');
  });
});

describe('contactosVcard', () => {
  it('un vCard 3.0 por persona del día, con CRLF, +593 y el prefijo en el nombre', () => {
    const r = contactosVcard(
      [persona({ nombres: 'RUIZ ANA', telefono: '0987654321' }), persona({ nombres: 'OTRO DÍA', fecha: DIAS[1], telefono: '0981111111' })],
      DIAS[0],
    );
    expect(r.incluidos).toBe(1);
    expect(r.omitidos).toEqual([]);
    expect(r.contenido).toBe('BEGIN:VCARD\r\nVERSION:3.0\r\nN:;VIE20 RUIZ ANA;;;\r\nFN:VIE20 RUIZ ANA\r\nTEL;TYPE=CELL:+593987654321\r\nEND:VCARD\r\n');
  });

  it('omite sin celular válido y números repetidos, y escapa comas, punto y coma y saltos de línea', () => {
    const r = contactosVcard(
      [
        persona({ nombres: 'A, B; C\nD', telefono: '+593991234567' }),
        persona({ nombres: 'SIN CEL', telefono: null }),
        persona({ nombres: 'FIJO', telefono: '062123456' }),
        persona({ nombres: 'ZZ REPETIDO', telefono: '0991234567' }),
      ],
      DIAS[0],
    );
    expect(r.incluidos).toBe(1);
    expect(r.contenido).toContain('FN:VIE20 A\\, B\\; C D\r\n');
    expect(r.contenido.match(/BEGIN:VCARD/g)).toHaveLength(1);
    expect(r.omitidos).toEqual(
      expect.arrayContaining([
        { nombres: 'SIN CEL', motivo: 'SIN_CELULAR' },
        { nombres: 'FIJO', motivo: 'SIN_CELULAR' },
        { nombres: 'ZZ REPETIDO', motivo: 'REPETIDO' },
      ]),
    );
  });

  it('un nombre con barras o saltos de línea no puede inyectar propiedades ni cerrar la tarjeta', () => {
    const r = contactosVcard([persona({ nombres: 'A\\B\r\nEND:VCARD\rBEGIN:VCARD\nTEL:+1' })], DIAS[0]);
    expect(r.contenido).toContain('FN:VIE20 A\\\\B END:VCARD BEGIN:VCARD TEL:+1\r\n');
    expect(r.contenido.match(/^BEGIN:VCARD/gm)).toHaveLength(1);
    expect(r.contenido.match(/^END:VCARD/gm)).toHaveLength(1);
    expect(r.contenido.match(/^TEL/gm)).toEqual(['TEL']);
  });

  it('día sin nadie: archivo vacío', () => {
    expect(contactosVcard([], DIAS[2])).toEqual({ contenido: '', incluidos: 0, omitidos: [] });
  });
});
