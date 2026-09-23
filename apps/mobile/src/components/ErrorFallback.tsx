import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';
import { fontFamily } from '../theme/typography';

interface Props {
  onRetry: () => void;
}

export function ErrorFallback({ onRetry }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Algo salió mal</Text>
      <Text style={styles.message}>
        Ocurrió un error inesperado. Puedes intentar continuar.
      </Text>
      <Pressable style={styles.btnPrimary} onPress={onRetry}>
        <Text style={styles.btnPrimaryText}>Reintentar</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (c: Colors) => StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: c.bgPage },
  title: { fontSize: 18, fontFamily: fontFamily.semiBold, color: c.textPrimary, textAlign: 'center' },
  message: {
    fontSize: 14,
    fontFamily: fontFamily.regular,
    color: c.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  btnPrimary: { backgroundColor: c.primary, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 8, minWidth: 200 },
  btnPrimaryText: { color: '#fff', textAlign: 'center', fontSize: 14, fontFamily: fontFamily.semiBold },
});
