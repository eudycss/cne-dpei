import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';

export function PlaceholderHome() {
  const { user, logout } = useAuth();
  const rol = user?.roles[0] ?? 'SIN_ROL';

  return (
    <View style={styles.container}>
      <Text style={styles.hello}>Hola {user?.nombres} 👋</Text>
      <Text style={styles.role}>Rol: {rol}</Text>
      <Text style={styles.note}>
        {rol === 'OPERADOR_CDA'
          ? 'Las pantallas de registro de salida/llegada y escaneo de kits llegan en la siguiente fase.'
          : rol === 'TECNICO_SUPERVISOR'
            ? 'El monitoreo en mapa y la atención de incidencias llegan en la siguiente fase.'
            : 'Esta app está orientada al personal de campo.'}
      </Text>
      <Pressable style={styles.button} onPress={() => logout()}>
        <Text style={styles.buttonText}>Cerrar sesión</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f6fa', alignItems: 'center', justifyContent: 'center', padding: 24 },
  hello: { fontSize: 24, fontWeight: '700', color: '#1f2937' },
  role: { fontSize: 15, color: '#2563eb', marginTop: 8, fontWeight: '600' },
  note: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginTop: 16, lineHeight: 20 },
  button: { backgroundColor: '#e5e7eb', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 6, marginTop: 28 },
  buttonText: { color: '#111827', fontWeight: '600' },
});
