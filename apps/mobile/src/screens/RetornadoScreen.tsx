import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';
import { AppBar } from '../components/AppBar';
import { fontFamily } from '../theme/typography';

export function RetornadoScreen() {
  const { user, logout } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <AppBar subtitle="Jornada completada" />
      <View style={styles.body}>
        <View style={styles.iconCircle}>
          <Text style={styles.icon}>✓</Text>
        </View>
        <Text style={styles.title}>Llegada al DPI registrada</Text>
        <Text style={styles.subtitle}>
          Hola {user?.nombres}, tu llegada a la Delegación Provincial de Imbabura está
          registrada y el rastreo de tu ubicación ha finalizado.
        </Text>
        <Text style={styles.message}>
          Has completado tu jornada electoral. Gracias por tu trabajo.
        </Text>
        <Pressable style={styles.btnSecondary} onPress={() => logout()}>
          <Text style={styles.btnSecondaryText}>Cerrar sesión</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (c: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bgPage },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: c.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  icon: { color: '#fff', fontSize: 40, fontFamily: fontFamily.bold },
  title: { fontSize: 24, fontFamily: fontFamily.bold, color: c.textPrimary, textAlign: 'center' },
  subtitle: { fontSize: 14, fontFamily: fontFamily.regular, color: c.textMeta, textAlign: 'center', marginTop: 12, lineHeight: 20 },
  message: { fontSize: 13, fontFamily: fontFamily.regular, color: c.textSecondary, textAlign: 'center', marginTop: 16, marginBottom: 32, lineHeight: 20 },
  btnSecondary: { paddingVertical: 10, paddingHorizontal: 24 },
  btnSecondaryText: { color: c.textSecondary, fontFamily: fontFamily.medium },
});
