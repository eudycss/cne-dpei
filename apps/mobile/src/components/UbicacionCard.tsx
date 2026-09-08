import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';
import { fontFamily } from '../theme/typography';
import type { UbicacionInfo } from '../lib/useProximidad';

type Props = {
  info: UbicacionInfo | null;
  verificando: boolean;
  error: string | null;
  onActualizar: () => void;
  /** Nombre del lugar a mostrar en el mensaje, ej. "el recinto" o "la Delegación". */
  destinoLabel: string;
};

export function UbicacionCard({ info, verificando, error, onActualizar, destinoLabel }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const variante = verificando ? 'neutral' : error ? 'neutral' : info ? (info.dentro ? 'ok' : 'warn') : 'neutral';
  const wrapStyle =
    variante === 'ok' ? styles.cardOk : variante === 'warn' ? styles.cardWarn : styles.cardNeutral;
  const textStyle =
    variante === 'ok' ? styles.textOk : variante === 'warn' ? styles.textWarn : styles.textNeutral;

  let mensaje: string;
  if (verificando) {
    mensaje = 'Obteniendo tu ubicación…';
  } else if (error) {
    mensaje = error;
  } else if (info?.dentro) {
    mensaje = `Estás en ${destinoLabel}.`;
  } else if (info) {
    mensaje = `Estás a ${Math.round(info.distanciaM)} m de ${destinoLabel}. Acércate a menos de ${Math.round(info.margenM)} m.`;
  } else {
    mensaje = `No se ha verificado tu cercanía a ${destinoLabel}.`;
  }

  return (
    <View style={[styles.card, wrapStyle]}>
      <Text style={[styles.text, textStyle]}>{mensaje}</Text>
      <Pressable
        onPress={onActualizar}
        disabled={verificando}
        hitSlop={8}
        accessibilityLabel="Actualizar ubicación"
        accessibilityState={{ disabled: verificando, busy: verificando }}
      >
        <Text style={styles.refrescar}>{verificando ? 'Verificando…' : 'Actualizar ubicación'}</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (c: Colors) => StyleSheet.create({
  card: { borderRadius: 10, padding: 14, marginBottom: 16, width: '100%', maxWidth: 320 },
  cardOk: { backgroundColor: c.successBg },
  cardWarn: { backgroundColor: c.warningBg },
  cardNeutral: { backgroundColor: c.placeholder },
  text: { fontSize: 13, fontFamily: fontFamily.medium, marginBottom: 6, textAlign: 'center' },
  textOk: { color: c.successText },
  textWarn: { color: c.warningText },
  textNeutral: { color: c.textSecondary },
  refrescar: { fontSize: 12, fontFamily: fontFamily.semiBold, color: c.primary, textAlign: 'center' },
});
