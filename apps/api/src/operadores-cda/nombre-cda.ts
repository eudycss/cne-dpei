/** Largo máximo de `usuarios.nombres` y `usuarios.apellidos` (VarChar(120)). */
const MAX_CAMPO = 120;

/**
 * Parte "APELLIDOS NOMBRES" de Operadores CDA en los dos campos de Usuario.
 * Convención ecuatoriana: dos apellidos y luego los nombres. Un apellido
 * compuesto ("DE LA TORRE") queda mal partido; se corrige a mano en Usuarios.
 */
export function partirNombre(apellidosNombres: string): { apellidos: string; nombres: string } {
  const palabras = apellidosNombres.trim().split(/\s+/).filter(Boolean);
  const nApellidos = palabras.length >= 3 ? 2 : 1;
  const apellidos = palabras.slice(0, nApellidos).join(' ');
  const nombres = palabras.slice(nApellidos).join(' ') || '-';
  return { apellidos: apellidos.slice(0, MAX_CAMPO), nombres: nombres.slice(0, MAX_CAMPO) };
}
