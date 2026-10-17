/**
 * Nombres con que la gente conoce a un recinto y que no están en su nombre
 * oficial ("Golondrinas" → Unidad Educativa Santa Ana de Cotacachi).
 *
 * Para agregar uno: una línea más con el nombre como lo dirían (da igual
 * mayúsculas o tildes; puede tener varias palabras) y el código o los códigos
 * de recinto. Si un nombre corresponde a varios recintos, el bot los lista.
 */
export const ALIAS_RECINTOS: Record<string, string[]> = {
  golondrinas: ['4241'], // Unidad Educativa Santa Ana de Cotacachi
};
