/**
 * Proxies en los que se confía para leer X-Forwarded-For (`app.set('trust proxy', ...)`).
 *
 * En Render la cadena es: cliente → borde de Cloudflare → balanceador interno
 * (10.x) → proceso (127.0.0.1). Confiando solo en la red interna, req.ip
 * quedaba en la IP del borde de Cloudflare (172.71.x, 104.23.x… en la
 * bitácora del simulacro 2026-11-01) y los límites por IP del login se
 * compartían entre todos los operadores que entraban por el mismo borde.
 *
 * Rangos publicados por Cloudflare (https://www.cloudflare.com/ips/). Si
 * cambian, la bitácora vuelve a mostrar IPs de Cloudflare: actualizar aquí.
 * Un cliente no puede hacerse pasar por otra IP agregando X-Forwarded-For:
 * Express toma la primera dirección no confiable empezando por la derecha.
 */
export const CLOUDFLARE_IPV4 = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];

export const CLOUDFLARE_IPV6 = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

export const TRUST_PROXY = ['loopback', 'linklocal', 'uniquelocal', ...CLOUDFLARE_IPV4, ...CLOUDFLARE_IPV6];
