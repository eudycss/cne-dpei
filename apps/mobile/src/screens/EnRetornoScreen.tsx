import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { AppBar } from '../components/AppBar';
import { fontFamily } from '../theme/typography';

interface Props {
  onMarcarLlegada: () => void;
}

export function EnRetornoScreen({ onMarcarLlegada }: Props) {
  const { user, logout } = useAuth();
  return (
    <View style={styles.container}>
      <AppBar subtitle="En retorno al DPI" />
      <View style={styles.body}>
        <View style={styles.iconCircle}>
          <Text style={styles.icon}>📍</Text>
        </View>
        <Text style={styles.title}>Rastreo activo</Text>
        <Text style={styles.subtitle}>
          Hola {user?.nombres}, tu salida del recinto está registrada y tu ubicación se está
          compartiendo en tiempo real durante el retorno al DPI.
        </Text>
        <Text style={styles.message}>
          Mantén la aplicación instalada y la ubicación activada. Cuando llegues a la
          Delegación, presiona el botón para registrar tu llegada.
        </Text>
        <Pressable style={styles.btnPrimary} onPress={onMarcarLlegada}>
          <Text style={styles.btnPrimaryText}>Ya llegué al DPI</Text>
        </Pressable>
        <Pressable style={styles.btnSecondary} onPress={() => logout()}>
          <Text style={styles.btnSecondaryText}>Cerrar sesión</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f6fa' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  icon: { fontSize: 36 },
  title: { fontSize: 24, fontFamily: fontFamily.bold, color: '#1f2937', textAlign: 'center' },
  subtitle: { fontSize: 14, fontFamily: fontFamily.regular, color: '#4b5563', textAlign: 'center', marginTop: 12, lineHeight: 20 },
  message: { fontSize: 13, fontFamily: fontFamily.regular, color: '#6b7280', textAlign: 'center', marginTop: 16, marginBottom: 32, lineHeight: 20 },
  btnPrimary: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 8,
    marginBottom: 12,
    minWidth: 240,
  },
  btnPrimaryText: { color: '#fff', textAlign: 'center', fontFamily: fontFamily.semiBold, fontSize: 15 },
  btnSecondary: { paddingVertical: 10, paddingHorizontal: 24 },
  btnSecondaryText: { color: '#6b7280', fontFamily: fontFamily.medium },
});
