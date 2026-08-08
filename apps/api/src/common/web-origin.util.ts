/** WEB_ORIGIN admite múltiples orígenes separados por coma (CORS en main.ts, links de auth). */
export function parseWebOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
