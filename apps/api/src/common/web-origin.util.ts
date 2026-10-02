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
 * - Un solo `*` por patrón, y tras él un dominio literal con punto
 *   (".vercel.app", etc.): "https://*" no es válido.
 *
 * La sesión viaja en el header Authorization (tokens en el localStorage de
 * cada origen), no en cookies: un origen permitido no hereda la sesión de nadie.
 *
 * Límite conocido: el "-" del comodín no se distingue del separador de Vercel,
 * así que un equipo ajeno con slug "x-cne2027" y proyecto "cne-dpei-web"
 * también coincidiría. Ese origen solo podría usar sesiones iniciadas en él
 * mismo (ver arriba); mantener activa la Deployment Protection de Vercel y no
 * compartir previews con usuarios reales.
 */
export function parseOriginPatterns(raw: string | undefined): RegExp[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((p) => /^https:\/\/[^/*]*\*[^/*]*\.[^/*]+$/.test(p))
    .map((p) => {
      const cuerpo = p
        .split('*')
        .map((tramo) => tramo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[a-z0-9-]+');
      return new RegExp(`^${cuerpo}$`);
    });
}
