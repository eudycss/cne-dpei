/** Filas de la hoja de enlaces que se siguen monitoreando (web, correo) pero que
 * no salen en los avisos de caídos/recuperados, el recordatorio, /caidos ni las
 * asignaciones del bot: el CPE no es un recinto ni tiene técnico. (El asistente
 * y la tarjeta de estadísticas todavía lo cuentan.) */
const CODIGOS_FUERA_DEL_BOT = new Set(['CPE']);

export function seMuestraEnBot(codigoRecinto: string): boolean {
  return !CODIGOS_FUERA_DEL_BOT.has(codigoRecinto.trim().toUpperCase());
}

/** Para filtrar ya en la base (escalamiento); quien la usa vuelve a filtrar con
 * seMuestraEnBot por si la hoja trae el código en minúsculas o con espacios. */
export const codigosFueraDelBot = (): string[] => [...CODIGOS_FUERA_DEL_BOT];
