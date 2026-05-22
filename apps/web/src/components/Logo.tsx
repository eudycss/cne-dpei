import logoUrl from '@assets/img/CNE_Ecuador.png';

interface LogoProps {
  /** Alto del logo en px (mantiene proporción). Por defecto 64. */
  height?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Logo institucional del CNE. Referencia el asset central del monorepo
 * (assets/img/CNE_Ecuador.png) — única fuente de verdad para web y móvil.
 */
export function Logo({ height = 64, className, style }: LogoProps) {
  return (
    <img
      src={logoUrl}
      alt="Consejo Nacional Electoral — Ecuador"
      height={height}
      className={className}
      style={{ height, width: 'auto', display: 'block', ...style }}
    />
  );
}

export { logoUrl };
