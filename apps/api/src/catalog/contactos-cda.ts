/** Rector y conserjes (hasta 2) de un CDA, tal como se guardan en la tabla de recintos. */
export interface ContactosCda {
  rectorNombre: string | null;
  rectorTelefono: string | null;
  conserjeNombre: string | null;
  conserjeTelefono: string | null;
  conserje2Nombre: string | null;
  conserje2Telefono: string | null;
}

export const CAMPOS_CONTACTOS_CDA = {
  rectorNombre: true,
  rectorTelefono: true,
  conserjeNombre: true,
  conserjeTelefono: true,
  conserje2Nombre: true,
  conserje2Telefono: true,
} as const;

/** Sin saltos de línea ni caracteres de control (un dato mal copiado no debe romper una línea del bot ni del reporte). */
// eslint-disable-next-line no-control-regex
const limpiar = (texto: string | null | undefined) =>
  (texto ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

const unir = (partes: (string | null | undefined)[], separador: string) =>
  partes.map(limpiar).filter(Boolean).join(separador);

/** "Nombre · 099…" para las celdas del reporte; vacío si no hay dato. */
export function textoRector(c: ContactosCda): string {
  return unir([c.rectorNombre, c.rectorTelefono], ' · ');
}

/** Uno o dos conserjes, uno por línea ("Nombre · 099…"); vacío si no hay dato. */
export function textoConserjes(c: ContactosCda): string {
  return [unir([c.conserjeNombre, c.conserjeTelefono], ' · '), unir([c.conserje2Nombre, c.conserje2Telefono], ' · ')]
    .filter(Boolean)
    .join('\n');
}

/** Línea del bot: "Rector: Nombre, teléfono 099… · Conserje: Nombre, teléfono 099…"; vacía si no hay dato. */
export function textoContactosBot(c: ContactosCda): string {
  const persona = (cargo: string, nombre: string | null, telefono: string | null) => {
    const n = limpiar(nombre);
    const t = limpiar(telefono);
    if (!n && !t) return '';
    return `${cargo}: ${unir([n, t ? `teléfono ${t}` : ''], ', ')}`;
  };
  return unir(
    [
      persona('Rector', c.rectorNombre, c.rectorTelefono),
      persona('Conserje', c.conserjeNombre, c.conserjeTelefono),
      persona('Conserje', c.conserje2Nombre, c.conserje2Telefono),
    ],
    ' · ',
  );
}

/** Algún teléfono de los tres contactos (rector primero), para saber a quién llamar. */
export function primerTelefono(c: ContactosCda): string {
  return unir([c.rectorTelefono], '') || unir([c.conserjeTelefono], '') || unir([c.conserje2Telefono], '');
}
