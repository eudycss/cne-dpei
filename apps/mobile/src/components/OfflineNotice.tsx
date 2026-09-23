import { useEffect, useMemo } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';
import { fontFamily } from '../theme/typography';

const MENSAJE = 'Sin conexión, reintentando…';

/**
 * Aviso discreto y no bloqueante: se reintenta solo, no requiere acción del
 * operador. `accessibilityLiveRegion` solo funciona en Android/TalkBack, así
 * que además se anuncia explícitamente para que también se lea en
 * iOS/VoiceOver al aparecer.
 */
export function OfflineNotice() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(MENSAJE);
  }, []);

  return (
    <View style={styles.card} accessibilityLiveRegion="polite">
      <Text style={styles.text}>{MENSAJE}</Text>
    </View>
  );
}

const makeStyles = (c: Colors) => StyleSheet.create({
  card: { backgroundColor: c.warningBg, borderRadius: 10, padding: 10, marginBottom: 12, width: '100%', maxWidth: 320 },
  text: { fontSize: 12, fontFamily: fontFamily.medium, color: c.warningText, textAlign: 'center' },
});
