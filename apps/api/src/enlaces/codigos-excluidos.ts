/** Filas de la hoja de enlaces que no son recintos (el CPE, sin técnico ni
 * encargado): no se monitorean, así que no salen en la web, el bot ni el correo. */
const CODIGOS_EXCLUIDOS = new Set(['CPE']);

export function esRecintoMonitoreado(codigoRecinto: string): boolean {
  return !CODIGOS_EXCLUIDOS.has(codigoRecinto.trim().toUpperCase());
}

/** Para dejar fuera, en la base, las caídas viejas que se guardaron antes de excluirlas. */
export const codigosExcluidos = (): string[] => [...CODIGOS_EXCLUIDOS];
