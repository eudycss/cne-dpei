import type { AsignacionTecnico } from '../../distributivo-tecnicos.client';
import type { EncargadoRecinto } from '../../encargados-recintos.client';

/**
 * Recintos FICTICIOS para medir al asistente (códigos 9xxx, teléfonos inventados).
 * Nunca se usan datos reales: las preguntas del banco van a Groq/Gemini.
 *
 * Resumen para escribir los casos:
 * - 21 recintos: Ibarra 8, Otavalo 4, Cotacachi 4, Antonio Ante 2, Urcuquí 1, Pimampiro 2.
 * - Caídos (7): 9102, 9105 (Ibarra) · 9201 (Otavalo) · 9302, 9303, 9304 (Cotacachi) · 9501 (Urcuquí).
 * - Técnicos: 1. Jairo Leal 7 (2 caídos) · 2. Willy Cevallos 5 (4 caídos) · 3. Ana Torres 3 (1 caído)
 *   · 4. Luis Mora 4 (0 caídos). Sin técnico: 9108, 9204.
 * - Sin contacto: 9104, 9202, 9304, 9602.
 */
type Fila = [codigo: string, nombre: string, canton: string, parroquia: string, caido: boolean, tecnico: number | null, conContacto: boolean];

const TECNICOS: Record<number, string> = { 1: 'Jairo Leal', 2: 'Willy Cevallos', 3: 'Ana Torres', 4: 'Luis Mora' };

const FILAS: Fila[] = [
  ['9101', 'UE Cesar Borja', 'Ibarra', 'SAGRARIO', false, 1, true],
  ['9102', 'UE 17 de Julio', 'Ibarra', 'SAN FRANCISCO', true, 1, true],
  ['9103', 'UE Atahualpa', 'Ibarra', 'SAGRARIO', false, 1, true],
  ['9104', 'UE Priorato', 'Ibarra', 'ALPACHACA', false, 1, false],
  ['9105', 'Plaza Central de Angochagua', 'Ibarra', 'ANGOCHAGUA', true, 1, true],
  ['9106', 'EGB Maria Rumipamba', 'Ibarra', 'LA ESPERANZA', false, 4, true],
  ['9107', 'UE La Esperanza', 'Ibarra', 'LA ESPERANZA', false, 4, true],
  ['9108', 'Colegio Ibarra', 'Ibarra', 'SAGRARIO', false, null, true],
  ['9201', 'UE San Juan de Ilumán Bloque 1', 'Otavalo', 'SAN JUAN DE ILUMAN', true, 3, true],
  ['9202', 'UE San Juan de Ilumán Bloque 2', 'Otavalo', 'SAN JUAN DE ILUMAN', false, 3, false],
  ['9203', 'UE Otavalo', 'Otavalo', 'JORDAN', false, 3, true],
  ['9204', 'Escuela Quichinche', 'Otavalo', 'SAN JOSE DE QUICHINCHE', false, null, true],
  ['9301', 'UE Santa Ana de Cotacachi', 'Cotacachi', 'SAN FRANCISCO', false, 2, true],
  ['9302', 'UE Luis Ulpiano de la Torre', 'Cotacachi', 'SAGRARIO', true, 2, true],
  ['9303', 'Escuela Quiroga', 'Cotacachi', 'QUIROGA', true, 2, true],
  ['9304', 'Escuela Apuela', 'Cotacachi', 'APUELA', true, 2, false],
  ['9401', 'UE Atuntaqui', 'Antonio Ante', 'ATUNTAQUI', false, 4, true],
  ['9402', 'Escuela Chaltura', 'Antonio Ante', 'CHALTURA', false, 4, true],
  ['9501', 'UE Urcuquí', 'Urcuquí', 'URCUQUI', true, 2, true],
  ['9601', 'UE Pimampiro', 'Pimampiro', 'PIMAMPIRO', false, 1, true],
  ['9602', 'Escuela Mariano Acosta', 'Pimampiro', 'MARIANO ACOSTA', false, 1, false],
];

export const ENLACES_PRUEBA = FILAS.map(([codigoRecinto, nombreRecinto, canton, , caido]) => ({
  codigoRecinto,
  nombreRecinto,
  canton,
  estado: (caido ? 'FALLO' : 'ACTIVO') as 'ACTIVO' | 'FALLO',
}));

export const ASIGNACIONES_PRUEBA: AsignacionTecnico[] = FILAS.filter(([, , , , , t]) => t !== null).map(
  ([codigoRecinto, , , parroquia, , t]) => ({ codigoRecinto, localidad: '', parroquia, numeroTecnico: t!, tecnico: TECNICOS[t!] }),
);

/** Teléfono inventado por código: 09900 + código, p. ej. 9102 → 0990009102. */
export const telefonoPrueba = (codigo: string) => `09900${codigo.padStart(5, '0')}`;

export const ENCARGADOS_PRUEBA = new Map<string, EncargadoRecinto>(
  FILAS.filter(([, , , , , , c]) => c).map(([codigo]) => [codigo, { nombre: `Rector ${codigo}`, telefono: telefonoPrueba(codigo) }]),
);

export const CODIGOS_PRUEBA = FILAS.map(([codigo]) => codigo);

/** Códigos de un cantón, para los casos que piden "recintos de X". */
export const codigosDe = (canton: string) => FILAS.filter(([, , c]) => c === canton).map(([codigo]) => codigo);
