import { Image, ImageStyle, StyleProp } from 'react-native';
// Asset central del monorepo (única fuente de verdad para web y móvil)
import logo from '../../../../assets/img/CNE_Ecuador.png';

interface LogoProps {
  /** Alto en px (mantiene proporción 330x234). Por defecto 72. */
  height?: number;
  style?: StyleProp<ImageStyle>;
}

/** Logo institucional del CNE. */
export function Logo({ height = 72, style }: LogoProps) {
  const width = Math.round(height * (330 / 234));
  return (
    <Image
      source={logo}
      style={[{ width, height, resizeMode: 'contain' }, style]}
      accessibilityLabel="Consejo Nacional Electoral — Ecuador"
    />
  );
}
