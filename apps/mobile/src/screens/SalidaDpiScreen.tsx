import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { MiAsignacionResponse } from '@cne/shared-types';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';
import { AppBar } from '../components/AppBar';
import { getMiAsignacion, postSalidaDpi } from '../lib/queries/tracking';
import {
  LocationPermissionDeniedError,
  LocationServicesDisabledError,
  obtenerUbicacionPuntual,
} from '../lib/location';
import { fontFamily } from '../theme/typography';

type Props = {
  onSalidaRegistrada: () => void;
};

export function SalidaDpiScreen({ onSalidaRegistrada }: Props) {
  const { user, logout } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [asignacion, setAsignacion] = useState<MiAsignacionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getMiAsignacion();
      setAsignacion(data);
      if (data.yaRegistroSalida) {
        onSalidaRegistrada();
      }
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'No se pudo cargar tu asignación');
    } finally {
      setLoading(false);
    }
  }, [onSalidaRegistrada]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  function confirmarSalida() {
    Alert.alert(
      'Confirmar salida del DPI',
      '¿Confirmas que estás saliendo de la Delegación Provincial de Imbabura hacia tu recinto?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Confirmar', style: 'default', onPress: () => registrarSalida() },
      ],
    );
  }

  async function registrarSalida() {
    setSubmitting(true);
    try {
      const ubicacion = await obtenerUbicacionPuntual();
      await postSalidaDpi({
        latitud: ubicacion.latitud,
        longitud: ubicacion.longitud,
        ocurridoEn: new Date().toISOString(),
      });
      onSalidaRegistrada();
    } catch (e: any) {
      if (e instanceof LocationPermissionDeniedError) {
        Alert.alert(
          'Ubicación requerida',
          'Necesitamos acceso a tu ubicación para registrar la salida. Abre los ajustes y concede el permiso.',
          [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Abrir ajustes', onPress: () => Linking.openSettings() },
          ],
        );
      } else if (e instanceof LocationServicesDisabledError) {
        Alert.alert(
          'Activa la ubicación',
          'Los servicios de ubicación están desactivados. Actívalos para continuar.',
        );
      } else if (e?.response?.status === 409) {
        Alert.alert('Salida ya registrada', 'Ya registraste tu salida del DPI.');
        onSalidaRegistrada();
      } else {
        Alert.alert(
          'Error',
          e?.response?.data?.message ?? 'No se pudo registrar la salida. Intenta de nuevo.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <AppBar subtitle="Registro de salida" />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Cargando tu asignación…</Text>
        </View>
      </View>
    );
  }

  if (error || !asignacion) {
    return (
      <View style={styles.container}>
        <AppBar subtitle="Registro de salida" />
        <View style={styles.center}>
          <Text style={styles.errorTitle}>No se pudo cargar tu asignación</Text>
          <Text style={styles.errorMsg}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={cargar}>
            <Text style={styles.retryText}>Reintentar</Text>
          </Pressable>
          <Pressable style={styles.logoutButton} onPress={() => logout()}>
            <Text style={styles.logoutText}>Cerrar sesión</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const { recinto, militar, kits, eventoNombre } = asignacion;

  return (
    <View style={styles.container}>
      <AppBar subtitle="Registro de salida" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.greeting}>Hola {user?.nombres} 👋</Text>
        <Text style={styles.eventoLabel}>Evento: {eventoNombre}</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recinto asignado</Text>
          <Text style={styles.recintoNombre}>{recinto.nombre}</Text>
          <Text style={styles.recintoMeta}>Código: {recinto.codigoRecinto}</Text>
          {recinto.direccion ? (
            <Text style={styles.recintoMeta}>Dirección: {recinto.direccion}</Text>
          ) : null}
          {recinto.cantonNombre ? (
            <Text style={styles.recintoMeta}>Cantón: {recinto.cantonNombre}</Text>
          ) : null}
          {recinto.parroquia ? (
            <Text style={styles.recintoMeta}>Parroquia: {recinto.parroquia}</Text>
          ) : null}
        </View>

        {militar ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Militar referencial</Text>
            <Text style={styles.militarNombre}>
              {militar.nombres} {militar.apellidos}
            </Text>
            <Text style={styles.recintoMeta}>Cédula: {militar.cedula}</Text>
            <Text style={styles.note}>
              Esta persona te entregará los kits en el recinto.
            </Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Kits que recibirás ({kits.length})</Text>
          {kits.map((kit, idx) => (
            <View
              key={kit.id}
              style={[styles.kitRow, idx === kits.length - 1 && styles.kitRowLast]}
            >
              <Text style={styles.kitCode}>{kit.codigoUnico}</Text>
              <Text style={styles.kitNombre}>{kit.nombre}</Text>
              {kit.contenidos ? (
                <Text style={styles.kitContenidos}>{kit.contenidos}</Text>
              ) : null}
            </View>
          ))}
        </View>

        <Pressable
          style={[styles.submitButton, submitting && { opacity: 0.6 }]}
          onPress={confirmarSalida}
          disabled={submitting}
        >
          <Text style={styles.submitText}>
            {submitting ? 'Registrando…' : 'Registrar Salida de Delegación'}
          </Text>
        </Pressable>

        <Pressable style={styles.logoutLink} onPress={() => logout()}>
          <Text style={styles.logoutLinkText}>Cerrar sesión</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bgPage },
  scroll: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingText: { marginTop: 12, fontFamily: fontFamily.regular, color: c.textSecondary },
  greeting: { fontSize: 20, fontFamily: fontFamily.bold, color: c.textPrimary },
  eventoLabel: { fontSize: 13, fontFamily: fontFamily.medium, color: c.primary, marginTop: 4, marginBottom: 16 },
  card: {
    backgroundColor: c.bgCard,
    padding: 16,
    borderRadius: 10,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  cardTitle: { fontSize: 13, fontFamily: fontFamily.semiBold, color: c.textSecondary, textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.5 },
  recintoNombre: { fontSize: 17, fontFamily: fontFamily.semiBold, color: c.textPrimary },
  militarNombre: { fontSize: 16, fontFamily: fontFamily.semiBold, color: c.textPrimary },
  recintoMeta: { fontSize: 13, fontFamily: fontFamily.regular, color: c.textMeta, marginTop: 2 },
  note: { fontSize: 12, fontFamily: fontFamily.italic, color: c.textSecondary, marginTop: 8 },
  kitRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border },
  kitRowLast: { borderBottomWidth: 0 },
  kitCode: { fontSize: 12, fontFamily: fontFamily.bold, color: c.primary, letterSpacing: 0.5 },
  kitNombre: { fontSize: 14, fontFamily: fontFamily.medium, color: c.textPrimary, marginTop: 2 },
  kitContenidos: { fontSize: 12, fontFamily: fontFamily.regular, color: c.textSecondary, marginTop: 2 },
  submitButton: {
    backgroundColor: c.primary,
    paddingVertical: 14,
    borderRadius: 8,
    marginTop: 8,
  },
  submitText: { color: '#fff', textAlign: 'center', fontSize: 15, fontFamily: fontFamily.semiBold },
  logoutLink: { marginTop: 18, alignItems: 'center' },
  logoutLinkText: { color: c.textSecondary, fontFamily: fontFamily.medium, fontSize: 13 },
  errorTitle: { fontSize: 16, fontFamily: fontFamily.semiBold, color: c.textPrimary, textAlign: 'center' },
  errorMsg: { fontSize: 14, fontFamily: fontFamily.regular, color: c.textSecondary, textAlign: 'center', marginTop: 8 },
  retryButton: { backgroundColor: c.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 6, marginTop: 18 },
  retryText: { color: '#fff', fontFamily: fontFamily.semiBold },
  logoutButton: { paddingHorizontal: 20, paddingVertical: 10, marginTop: 12 },
  logoutText: { color: c.textSecondary, fontFamily: fontFamily.medium },
});
