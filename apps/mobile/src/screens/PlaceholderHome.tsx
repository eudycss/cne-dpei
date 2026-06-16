import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';
import { fontFamily } from '../theme/typography';

export function PlaceholderHome() {
  const { user, logout } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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

const makeStyles = (c: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bgPage, alignItems: 'center', justifyContent: 'center', padding: 24 },
  hello: { fontSize: 24, fontFamily: fontFamily.bold, color: c.textPrimary },
  role: { fontSize: 15, fontFamily: fontFamily.semiBold, color: c.primary, marginTop: 8 },
  note: { fontSize: 14, fontFamily: fontFamily.regular, color: c.textSecondary, textAlign: 'center', marginTop: 16, lineHeight: 20 },
  button: { backgroundColor: c.btnSecondaryBg, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 6, marginTop: 28, borderWidth: 1, borderColor: c.btnSecondaryBorder },
  buttonText: { color: c.btnSecondaryText, fontFamily: fontFamily.semiBold },
});
