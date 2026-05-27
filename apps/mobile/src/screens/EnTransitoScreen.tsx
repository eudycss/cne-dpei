import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { fontFamily } from '../theme/typography';

export function EnTransitoScreen() {
  const { user, logout } = useAuth();

  return (
    <View style={styles.container}>
      <View style={styles.iconCircle}>
        <Text style={styles.icon}>✓</Text>
      </View>
      <Text style={styles.title}>Salida registrada</Text>
      <Text style={styles.subtitle}>
        Hola {user?.nombres}, tu salida del DPI ha sido registrada y los supervisores
        ya fueron notificados.
      </Text>
      <Text style={styles.message}>
        Continúa hacia tu recinto electoral. La pantalla de registro de llegada al
        recinto estará disponible en la siguiente fase.
      </Text>
      <Pressable style={styles.button} onPress={() => logout()}>
        <Text style={styles.buttonText}>Cerrar sesión</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f6fa',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  icon: { color: '#fff', fontSize: 38, fontFamily: fontFamily.bold },
  title: { fontSize: 24, fontFamily: fontFamily.bold, color: '#1f2937', textAlign: 'center' },
  subtitle: {
    fontSize: 14,
    fontFamily: fontFamily.regular,
    color: '#4b5563',
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 20,
  },
  message: {
    fontSize: 13,
    fontFamily: fontFamily.regular,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 20,
  },
  button: {
    backgroundColor: '#e5e7eb',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 6,
    marginTop: 32,
  },
  buttonText: { color: '#111827', fontFamily: fontFamily.semiBold },
});
