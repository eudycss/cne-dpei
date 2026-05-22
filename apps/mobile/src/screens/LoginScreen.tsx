import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '../auth/AuthContext';

export function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    if (!email || !password) {
      Alert.alert('Datos requeridos', 'Ingresa email y contraseña');
      return;
    }
    setLoading(true);
    try {
      await login(email, password);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.message ?? 'No se pudo iniciar sesión');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <View style={styles.card}>
        <Text style={styles.title}>CNE Imbabura</Text>
        <Text style={styles.subtitle}>Trazabilidad y Logística Electoral</Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <Text style={styles.label}>Contraseña</Text>
        <TextInput
          style={styles.input}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        <Pressable
          style={[styles.button, loading && { opacity: 0.6 }]}
          onPress={onSubmit}
          disabled={loading}
        >
          <Text style={styles.buttonText}>{loading ? 'Ingresando…' : 'Iniciar sesión'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f6fa', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 380, backgroundColor: '#fff', padding: 24, borderRadius: 12, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, elevation: 3 },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center', color: '#1f2937' },
  subtitle: { fontSize: 13, textAlign: 'center', marginTop: 4, color: '#6b7280', marginBottom: 20 },
  label: { fontSize: 13, color: '#374151', marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#d1d5db', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 14 },
  button: { backgroundColor: '#2563eb', padding: 12, borderRadius: 6, marginTop: 4 },
  buttonText: { color: '#fff', textAlign: 'center', fontWeight: '600' },
});
