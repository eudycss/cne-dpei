import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { strongPasswordSchema } from '@cne/shared-validation';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';
import { Logo } from '../components/Logo';
import { PasswordField } from '../components/PasswordField';
import { fontFamily } from '../theme/typography';

export function ChangePasswordScreen() {
  const { markPasswordChanged } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    if (next !== confirm) {
      Alert.alert('Error', 'La confirmación no coincide');
      return;
    }
    const parse = strongPasswordSchema.safeParse(next);
    if (!parse.success) {
      Alert.alert('Contraseña débil', parse.error.issues[0]?.message ?? 'Contraseña inválida');
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      markPasswordChanged();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.message ?? 'No se pudo cambiar la contraseña');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.logoWrap}>
          <Logo height={56} />
        </View>
        <Text style={styles.title}>Cambia tu contraseña</Text>
        <Text style={styles.subtitle}>
          Mínimo 12 caracteres con mayúsculas, minúsculas, dígitos y símbolos.
        </Text>
        <Text style={styles.label}>Contraseña actual</Text>
        <PasswordField value={current} onChange={setCurrent} />
        <Text style={styles.label}>Nueva contraseña</Text>
        <PasswordField value={next} onChange={setNext} />
        <Text style={styles.label}>Confirmar</Text>
        <PasswordField value={confirm} onChange={setConfirm} />
        <Pressable style={[styles.button, loading && { opacity: 0.6 }]} onPress={onSubmit} disabled={loading}>
          <Text style={styles.buttonText}>{loading ? 'Guardando…' : 'Cambiar contraseña'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (c: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bgPage, alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 380, backgroundColor: c.bgCard, padding: 24, borderRadius: 12 },
  logoWrap: { alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 20, fontFamily: fontFamily.bold, color: c.textPrimary },
  subtitle: { fontSize: 13, fontFamily: fontFamily.regular, color: c.textSecondary, marginVertical: 8 },
  label: { fontSize: 13, fontFamily: fontFamily.medium, color: c.textLabel, marginBottom: 4 },
  button: { backgroundColor: c.primary, padding: 12, borderRadius: 6, marginTop: 4 },
  buttonText: { color: '#fff', textAlign: 'center', fontFamily: fontFamily.semiBold },
});
