import { escapeHtml } from '../../auth/notifier';
import type { EncargadoRecinto } from '../encargados-recintos.client';
import { recortarNombre } from '../telegram-notifier';
import { partir, textoEncargado } from './consulta-recintos';
import type { ResultadoSql, ValorSql } from './sql/motor-sql';

/** Con teléfonos se muestran menos, para no volcar los contactos de toda la provincia. */
const MAX_FILAS_CON_CONTACTO = 40;

const texto = (v: ValorSql) => (v === null ? '—' : escapeHtml(String(v)));

/**
 * Arma la respuesta a partir del resultado del SQL, sea cual sea su forma:
 * - un solo valor ("cuántos…") → "Título: 12";
 * - filas con `codigo` → una línea por recinto (🔴/✅ si hay `estado`), con el
 *   encargado si se pidió contacto;
 * - cualquier otra tabla (conteos por técnico, cantón…) → "• valor · valor".
 * Los teléfonos salen del Excel de encargados, nunca del modelo ni del SQL.
 */
export function formatearResultadoSql(
  titulo: string,
  resultado: ResultadoSql,
  conContacto: boolean,
  encargados: Map<string, EncargadoRecinto> | null,
): string[] {
  const { columnas, filas, hayMas } = resultado;
  const encabezado = `🔎 <b>${escapeHtml(titulo)}</b>`;
  if (filas.length === 0) return [`${encabezado}\nNinguno cumple esa condición.`];
  if (filas.length === 1 && columnas.length === 1) return [`${encabezado}: ${texto(filas[0][0])}`];

  const iCodigo = columnas.indexOf('codigo');
  const iNombre = columnas.indexOf('nombre');
  const iEstado = columnas.indexOf('estado');
  const otras = columnas.map((_, i) => i).filter((i) => i !== iCodigo && i !== iNombre && i !== iEstado);
  const mostrarContacto = conContacto && iCodigo >= 0;
  const visibles = mostrarContacto ? filas.slice(0, MAX_FILAS_CON_CONTACTO) : filas;

  const lineas = visibles.map((fila) => {
    if (iCodigo < 0) return `• ${fila.map(texto).join(' · ')}`;
    const icono = iEstado < 0 ? '•' : fila[iEstado] === 'caido' ? '🔴' : '✅';
    const nombre = iNombre >= 0 && fila[iNombre] !== null ? ` — ${escapeHtml(recortarNombre(String(fila[iNombre])))}` : '';
    const extra = otras.length ? ` · ${otras.map((i) => texto(fila[i])).join(' · ')}` : '';
    const linea = `${icono} ${texto(fila[iCodigo])}${nombre}${extra}`;
    return mostrarContacto ? `${linea}\n     📞 ${textoEncargado(String(fila[iCodigo]), encargados)}` : linea;
  });

  // Encabezado de columnas solo para tablas sin código (p. ej. "tecnico · recintos").
  const columnasTabla = iCodigo < 0 && columnas.length > 1 ? [`<i>${columnas.map(escapeHtml).join(' · ')}</i>`] : [];
  const restantes = filas.length - visibles.length;
  const pie =
    restantes > 0
      ? [`… y ${restantes} más. Agregue un filtro para ver sus contactos.`]
      : hayMas
        ? ['… y hay más. Agregue un filtro para ver el resto.']
        : [];
  return partir([`${encabezado} (${filas.length}${hayMas ? '+' : ''})`, ...columnasTabla, ...lineas, ...pie]);
}
