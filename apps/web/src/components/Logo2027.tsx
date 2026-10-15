import logo2027Url from '@assets/img/logo-elecciones-2027.png';

interface Logo2027Props {
  /** Alto del logo en px (mantiene proporción). Por defecto 56. */
  height?: number;
}

/**
 * Logo de las Elecciones Seccionales y CPCCS 2027. Sus letras son azul oscuro y
 * negro: en tema oscuro va sobre una placa blanca (clase .logo-2027) para que
 * se lea, igual que en el PDF.
 */
export function Logo2027({ height = 56 }: Logo2027Props) {
  return (
    <span className="logo-2027">
      <img
        src={logo2027Url}
        alt="Consejo Nacional Electoral — Elecciones Seccionales y CPCCS 2027"
        style={{ height, width: 'auto', display: 'block' }}
      />
    </span>
  );
}
