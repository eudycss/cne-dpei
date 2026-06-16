import { useMemo, useState } from 'react';
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
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';
import { Logo } from '../components/Logo';
import { PasswordField } from '../components/PasswordField';
import { fontFamily } from '../theme/typography';

export function LoginScreen() {
  const { login } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
        <View style={styles.logoWrap}>
          <Logo height={72} />
        </View>
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
          placeholderTextColor={colors.textPlaceholder}
        />
        <Text style={styles.label}>Contraseña</Text>
        <PasswordField
          value={password}
          onChange={setPassword}
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

const makeStyles = (c: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bgPage, alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 380, backgroundColor: c.bgCard, padding: 24, borderRadius: 12, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, elevation: 3 },
  logoWrap: { alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 22, fontFamily: fontFamily.bold, textAlign: 'center', color: c.textPrimary },
  subtitle: { fontSize: 13, fontFamily: fontFamily.regular, textAlign: 'center', marginTop: 4, color: c.textSecondary, marginBottom: 20 },
  label: { fontSize: 13, fontFamily: fontFamily.medium, color: c.textLabel, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: c.borderInput, padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 14, fontFamily: fontFamily.regular, backgroundColor: c.bgCard, color: c.textPrimary },
  button: { backgroundColor: c.primary, padding: 12, borderRadius: 6, marginTop: 4 },
  buttonText: { color: '#fff', textAlign: 'center', fontFamily: fontFamily.semiBold },
});
