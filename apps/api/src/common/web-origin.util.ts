/** WEB_ORIGIN admite múltiples orígenes separados por coma (CORS en main.ts, links de auth). */
export function parseWebOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * WEB_ORIGIN_PATTERNS: orígenes con comodín, separados por coma, solo para
 * CORS (p. ej. los previews de Vercel: https://cne-dpei-web-*-cne2027.vercel.app).
 *
 * - Solo https y sin ruta: cualquier otra cosa se ignora.
 * - El `*` cubre un tramo de letras minúsculas, dígitos y guiones; no puede
 *   cruzar un "." ni un "/", así que no abre otros dominios.
 * - Todo lo demás se compara literal (se escapa) y el patrón va anclado.
 *
 * La sesión viaja en el header Authorization (tokens en el localStorage de
 * cada origen), no en cookies: un origen permitido no hereda la sesión de nadie.
 */
export function parseOriginPatterns(raw: string | undefined): RegExp[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((p) => /^https:\/\/[^/]+$/.test(p) && p.includes('*'))
    .map((p) => {
      const cuerpo = p
        .split('*')
        .map((tramo) => tramo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[a-z0-9-]+');
      return new RegExp(`^${cuerpo}$`);
    });
}
