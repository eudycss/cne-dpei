import type { ParejaCdaFila, PersonaParejaCda } from '@cne/shared-types';
import type { AsignacionTecnico } from '../enlaces/distributivo-tecnicos.client';
import {
  type FilaTecnico,
  agruparPorTecnico,
  contactosVcf,
  etiquetaTecnico,
  nombreContacto,
  reporteTecnicos,
  resumenTecnicos,
  telefonoInternacional,
} from './reporte-tecnicos-cda';

const persona = (id: string, apellidosNombres: string, grupo: 'OPERADOR' | 'ASISTENTE', telefono: string | null = '0991234567'): PersonaParejaCda => ({
  id,
  apellidosNombres,
  cedula: '1710034065',
  telefono,
  dispositivo: 'ANDROID',
  grupo,
});

function fila(id: string, codigo: string, op: PersonaParejaCda, as: PersonaParejaCda | null, extra: Partial<ParejaCdaFila> = {}): ParejaCdaFila {
  return {
    id,
    fecha: '2026-11-01',
    recinto: { id: `r${codigo}`, codigo, nombre: `Recinto ${codigo}`, canton: 'IBARRA' },
    operador: op,
    asistente: as,
    portador: op,
    kitCodigo: `KIT${codigo}`,
    estado: 'EN_APP',
    recintoCompartido: false,
    puedeRecibirKit: false,
    articulos: null,
    ...extra,
  };
}

const asig = (codigoRecinto: string, tecnico: string, numeroTecnico: number, parroquia = 'SAGRARIO'): AsignacionTecnico => ({
  codigoRecinto,
  tecnico,
  numeroTecnico,
  parroquia,
  localidad: '',
});

const ANA = persona('a', 'PEREZ LOPEZ ANA MARIA', 'OPERADOR', '0991111111');
const LUIS = persona('l', 'MORA RUIZ LUIS', 'ASISTENTE', '0992222222');
const EVA = persona('e', 'DE LA CRUZ CHICAIZA EVA', 'OPERADOR', '0993333333');
const JOSE = persona('j', 'TORRES PAZ JOSE', 'ASISTENTE', null);
const RITA = persona('r', 'VACA GUEVARA RITA', 'OPERADOR', '0994444444');

// 1286: dos parejas (la 2.ª solo registrada); 96: una pareja donde el asistente tiene el kit; 7777: sin técnico.
const FILAS: FilaTecnico[] = [
  { pareja: fila('p1', '1286', ANA, LUIS, { recintoCompartido: true }), ingresa: 'OPERADOR' },
  { pareja: fila('p2', '1286', EVA, JOSE, { portador: null, kitCodigo: null, estado: 'SOLO_REGISTRADA', recintoCompartido: true }), ingresa: null },
  { pareja: fila('p3', '96', RITA, LUIS, { portador: LUIS }), ingresa: 'ASISTENTE' },
  { pareja: fila('p4', '7777', persona('x', 'SOLO PEREZ JUAN', 'OPERADOR'), null, { estado: 'SIN_KIT' }), ingresa: null },
];
const DISTRIBUTIVO = [asig('1286', 'Ing. Sebastian Cabascango', 1), asig('96', 'Ing. Sebastian Cabascango', 1), asig('96', 'Ing. Jairo Leal', 2, 'SAN FRANCISCO'), asig('5', 'Ing. Carlos Cañares', 3)];

describe('reporte por técnico de parejas CDA', () => {
  describe('agruparPorTecnico / resumenTecnicos', () => {
    it('agrupa por el técnico del distributivo (en su orden); un recinto con dos técnicos va en ambos; lo demás, sin técnico', () => {
      const grupos = agruparPorTecnico(FILAS, DISTRIBUTIVO);

      expect(grupos.map((g) => [g.nombre, g.filas.map((f) => f.pareja.id)])).toEqual([
        ['Ing. Sebastian Cabascango', ['p3', 'p1', 'p2']],
        ['Ing. Jairo Leal', ['p3']],
        ['Ing. Carlos Cañares', []],
        [null, ['p4']],
      ]);
      expect(resumenTecnicos(grupos)).toEqual([
        { nombre: 'Ing. Sebastian Cabascango', recintos: 2, parejas: 3 },
        { nombre: 'Ing. Jairo Leal', recintos: 1, parejas: 1 },
        { nombre: 'Ing. Carlos Cañares', recintos: 0, parejas: 0 },
        { nombre: null, recintos: 1, parejas: 1 },
      ]);
    });

    it('sin recintos fuera del distributivo no hay grupo "sin técnico"; el mismo técnico escrito distinto es uno solo', () => {
      const grupos = agruparPorTecnico(FILAS.slice(0, 2), [asig('1286', 'Ing.  Sebastián Cabascango', 1), asig('96', 'ing. sebastian cabascango', 1)]);
      expect(grupos.map((g) => g.nombre)).toEqual(['Ing. Sebastián Cabascango']);
    });
  });

  describe('reporteTecnicos', () => {
    const grupos = agruparPorTecnico(FILAS, DISTRIBUTIVO);
    const reporte = reporteTecnicos({ fecha: '2026-11-01', evento: { id: 'ev', nombre: 'Primer Simulacro' } }, grupos);

    it('una hoja por técnico elegido, con quién ingresa a la app y cuántas parejas van al recinto', () => {
      expect(reporte.tablas.map((t) => t.hoja)).toEqual(['Ing. Sebastian Cabascango', 'Ing. Jairo Leal', 'Ing. Carlos Cañares', 'Sin técnico']);
      const t = reporte.tablas[0];
      expect(t.titulo).toBe('Ing. Sebastian Cabascango · 2 recintos · 3 parejas · 2 ingresan a la app');
      expect(t.columnas.map((c) => c.titulo)).toEqual([
        'N°', 'Código', 'Recinto', 'Parroquia', 'Parejas en el recinto', 'Kit', 'Ingresa a la app', 'Celular', 'Su pareja / integrantes', 'Observación',
      ]);
      expect(t.filas).toEqual([
        [1, '96', 'Recinto 96', 'SAGRARIO', '1 pareja', 'KIT96', 'MORA RUIZ LUIS (Asistente)', '0992 222 222', 'VACA GUEVARA RITA (Operador) · 0994 444 444', ''],
        [2, '1286', 'Recinto 1286', 'SAGRARIO', '2 parejas', 'KIT1286', 'PEREZ LOPEZ ANA MARIA (Operador)', '0991 111 111', 'MORA RUIZ LUIS (Asistente) · 0992 222 222', '1.ª pareja: lleva el kit'],
        [3, '1286', 'Recinto 1286', 'SAGRARIO', '2 parejas', 'Sin kit', 'NO INGRESA', '', 'Operador: DE LA CRUZ CHICAIZA EVA · 0993 333 333\nAsistente: TORRES PAZ JOSE · sin celular', '2.ª pareja: va con la pareja que tiene el kit'],
      ]);
      expect(t.resaltadas).toEqual([]);
      expect(reporte.detalle).toContain('Primer Simulacro');
    });

    it('resalta la pareja con kit que nadie tiene, o que tiene otra persona', () => {
      const t = reporte.tablas[3];
      expect(t.filas[0].slice(6, 10)).toEqual(['NADIE: pulse "Asignar kit"', '', 'Operador: SOLO PEREZ JUAN · 0991 234 567', 'Revisar antes de la jornada']);
      expect(t.resaltadas).toEqual([0]);

      const otra = reporteTecnicos({ fecha: '2026-11-01', evento: null }, agruparPorTecnico([{ pareja: FILAS[0].pareja, ingresa: 'OTRA' }], DISTRIBUTIVO));
      expect(otra.tablas[0].filas[0][6]).toBe('OTRA PERSONA tiene el kit (revisar en Kits)');
      expect(otra.tablas[0].resaltadas).toEqual([0]);
      expect(otra.detalle).toContain('sin evento activo');
    });

    it('sin parejas para los técnicos elegidos, una tabla que lo dice', () => {
      const vacio = reporteTecnicos({ fecha: '2026-11-01', evento: null }, agruparPorTecnico([], [asig('5', 'Ing. Carlos Cañares', 1)]));
      expect(vacio.tablas[0].filas).toEqual([['', '', 'Este técnico no tiene parejas este día', '', '', '', '', '', '', '']]);
    });
  });

  describe('contactos .vcf', () => {
    it('nombre del contacto: primer nombre y primer apellido, con apellidos compuestos y sin correos pegados', () => {
      expect(nombreContacto('PEREZ LOPEZ ANA MARIA')).toEqual({ nombre: 'Ana', apellido: 'Perez' });
      expect(nombreContacto('DE LA CRUZ CHICAIZA KAREN MISHELL')).toEqual({ nombre: 'Karen', apellido: 'De La Cruz' });
      expect(nombreContacto('PROAÑO DEL HIERRO PABLO')).toEqual({ nombre: 'Pablo', apellido: 'Proaño' });
      expect(nombreContacto('Torres Patiño Alberto Anibal - at.prueba@gmail.com')).toEqual({ nombre: 'Alberto', apellido: 'Torres' });
      expect(nombreContacto('MORA LUIS')).toEqual({ nombre: 'Luis', apellido: 'Mora' });
      expect(nombreContacto('MORA')).toEqual({ nombre: 'Mora', apellido: '' });
    });

    it('etiqueta del técnico: su primer nombre, sin título', () => {
      expect(etiquetaTecnico('Ing. Sebastian Cabascango')).toBe('Sebastian');
      expect(etiquetaTecnico('ING CARLOS CAÑARES')).toBe('Carlos');
      expect(etiquetaTecnico(null)).toBe('SinTecnico');
    });

    it('teléfono con +593; lo que no parece celular se omite', () => {
      expect(telefonoInternacional('0991234567')).toBe('+593991234567');
      expect(telefonoInternacional('099 123 4567')).toBe('+593991234567');
      expect(telefonoInternacional('+593 99 123 4567')).toBe('+593991234567');
      expect(telefonoInternacional('593991234567')).toBe('+593991234567');
      expect(telefonoInternacional('12345')).toBeNull();
      expect(telefonoInternacional(null)).toBeNull();
    });

    it('un contacto por persona con celular, como codigo.Nombre.Apellido.Técnico', () => {
      const vcf = contactosVcf(agruparPorTecnico(FILAS, DISTRIBUTIVO).slice(0, 2));
      const nombres = [...vcf.matchAll(/^FN:(.*)$/gm)].map((m) => m[1].trim());
      expect(nombres).toEqual([
        '96.Rita.Vaca.Sebastian',
        '96.Luis.Mora.Sebastian',
        '1286.Ana.Perez.Sebastian',
        '1286.Luis.Mora.Sebastian',
        '1286.Eva.De La Cruz.Sebastian',
        // José no tiene celular: no sale. En el 96 Jairo también responde.
        '96.Rita.Vaca.Jairo',
        '96.Luis.Mora.Jairo',
      ]);
      expect(vcf).toContain('BEGIN:VCARD\r\nVERSION:3.0\r\nN:96.Rita.Vaca.Sebastian;;;;\r\nFN:96.Rita.Vaca.Sebastian\r\nTEL;TYPE=CELL:+593994444444\r\nEND:VCARD\r\n');
    });

    it('escapa los caracteres especiales de vCard en el nombre', () => {
      const raro = persona('z', 'PAZ;LOPEZ ANA,MARIA', 'OPERADOR');
      const vcf = contactosVcf(agruparPorTecnico([{ pareja: fila('p9', '96', raro, null), ingresa: 'OPERADOR' }], [asig('96', 'Ing. Jairo Leal', 1)]));
      expect(vcf).toContain('FN:96.Ana\\,maria.Paz\\;lopez.Jairo');

      // Un \r suelto tampoco parte la línea de la tarjeta.
      const conRetorno = contactosVcf(agruparPorTecnico([{ pareja: fila('p8', '96', persona('w', 'PAZ LOPEZ ANA', 'OPERADOR'), null), ingresa: 'OPERADOR' }], [asig('96', 'Ing.\rJairo', 1)]));
      expect(conRetorno).not.toMatch(/\r(?!\n)/);
    });
  });
});
