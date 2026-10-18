import { codigosDe, telefonoPrueba } from './datos-prueba';
import type { CasoEval } from './evaluar';

const TECNICOS = ['Jairo Leal', 'Willy Cevallos', 'Ana Torres', 'Luis Mora'];
const otros = (...menos: string[]) => TECNICOS.filter((t) => !menos.includes(t));
/** Ningún teléfono: preguntas que no piden contactos. */
const SIN_TELEFONOS = ['09900'];

/**
 * Banco de preguntas reales del grupo (adaptadas a los datos de prueba) con lo que
 * debería responder el bot. Agregue aquí cada pregunta que el bot responda mal.
 */
export const CASOS: CasoEval[] = [
  // Listas por lugar
  { pregunta: 'Dame 5 recintos de Ibarra aleatorios', esperado: { cantidadCodigos: 5, codigosDentroDe: codigosDe('Ibarra') } },
  { pregunta: 'dame 2 recintos de otavalo', esperado: { cantidadCodigos: 2, codigosDentroDe: codigosDe('Otavalo') } },
  { pregunta: 'Recintos de Pimampiro y Urcuquí', esperado: { codigos: ['9601', '9602', '9501'] } },
  { pregunta: 'Listar recintos de Cotacachi', esperado: { codigos: codigosDe('Cotacachi') } },
  { pregunta: 'recintos de la parroquia La Esperanza', esperado: { codigos: ['9106', '9107'] } },
  { pregunta: 'Cuántos recintos hay en total', esperado: { numeros: [21], cantidadCodigos: 0 } },
  { pregunta: 'cuantos recintos activos hay en Otavalo', esperado: { numeros: [3], cantidadCodigos: 0 } },

  // Caídos
  { pregunta: 'Qué está caído en Cotacachi', esperado: { codigos: ['9302', '9303', '9304'] } },
  { pregunta: 'Cuántos caídos hay en Ibarra', esperado: { numeros: [2], codigosDentroDe: ['9102', '9105'] } },
  { pregunta: 'Qué cantón tiene más caídos', esperado: { contiene: ['Cotacachi'], noContiene: ['Ibarra', 'Otavalo', 'Urcuquí'] } },
  { pregunta: 'Qué parroquias de Cotacachi tienen caídos', esperado: { contiene: ['SAGRARIO', 'QUIROGA', 'APUELA'], noContiene: ['SAN FRANCISCO'] } },
  { pregunta: 'recintos caídos que no tienen contacto', esperado: { codigos: ['9304'] } },

  // Técnicos
  { pregunta: 'Lista los técnicos', esperado: { contiene: TECNICOS, cantidadCodigos: 0 } },
  { pregunta: 'Cuántos recintos tiene cada técnico', esperado: { contiene: TECNICOS, numeros: [7, 5, 3, 4], cantidadCodigos: 0 } },
  { pregunta: 'Qué técnico tiene Cotacachi', esperado: { contiene: ['Willy Cevallos'], noContiene: otros('Willy Cevallos') } },
  { pregunta: 'Quien es el técnico encargado de Iluman?', esperado: { contiene: ['Ana Torres'], noContiene: [...otros('Ana Torres'), ...SIN_TELEFONOS] } },
  { pregunta: 'qué técnico atiende Quiroga', esperado: { contiene: ['Willy Cevallos'], noContiene: otros('Willy Cevallos') } },
  { pregunta: 'Qué técnicos hay en Ibarra', esperado: { contiene: ['Jairo Leal', 'Luis Mora'], noContiene: ['Willy Cevallos', 'Ana Torres'] } },
  { pregunta: 'Qué técnico tiene más recintos', esperado: { contiene: ['Jairo Leal'], noContiene: otros('Jairo Leal') } },
  { pregunta: 'Qué técnicos tienen recintos caídos', esperado: { contiene: ['Jairo Leal', 'Willy Cevallos', 'Ana Torres'], noContiene: ['Luis Mora'] } },
  { pregunta: 'recintos de Willi', esperado: { codigos: ['9301', '9302', '9303', '9304', '9501'] } },
  { pregunta: 'Solo los caídos de Jairo', esperado: { codigos: ['9102', '9105'] } },
  { pregunta: 'Recintos de Jairo en Pimampiro', esperado: { codigos: ['9601', '9602'] } },
  { pregunta: 'Qué recintos no tienen técnico', esperado: { codigos: ['9108', '9204'] } },

  // Contactos
  { pregunta: 'Número del encargado del colegio Ibarra', esperado: { contiene: [telefonoPrueba('9108')], codigos: ['9108'] } },
  { pregunta: 'Dame el contacto de Iluman', esperado: { codigos: ['9201', '9202'], contiene: [telefonoPrueba('9201')] } },
  { pregunta: 'Qué recintos no tienen contacto', esperado: { codigos: ['9104', '9202', '9304', '9602'] } },
  { pregunta: 'Contactos de los caídos de Ibarra', esperado: { codigos: ['9102', '9105'], contiene: [telefonoPrueba('9102'), telefonoPrueba('9105')] } },
  { pregunta: 'Cómo está el 9302', esperado: { codigos: ['9302'], contiene: ['caído'] } },

  // Estadísticas y fuera de tema
  { pregunta: 'estadísticas de la semana', esperado: { contiene: ['[estadisticas semana]'] } },
  { pregunta: 'cuántas caídas hubo hoy', esperado: { contiene: ['[estadisticas dia]'] } },
  { pregunta: 'Hola, qué tal', esperado: { contiene: ['Puedo responder'], noContiene: SIN_TELEFONOS } },
];
