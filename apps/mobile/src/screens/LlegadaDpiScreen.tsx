import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
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
import { getMiAsignacion } from '../lib/queries/tracking';
import { postLlegadaDpi } from '../lib/queries/retorno';
import {
  detenerRastreo,
  LocationPermissionDeniedError,
  LocationServicesDisabledError,
  obtenerUbicacionPuntual,
} from '../lib/location';
import { fontFamily } from '../theme/typography';

type Props = {
  onLlegadaRegistrada: () => void;
};

export function LlegadaDpiScreen({ onLlegadaRegistrada }: Props) {
  const { user, logout } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [asignacion, setAsignacion] = useState<MiAsignacionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [registrando, setRegistrando] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getMiAsignacion();
      setAsignacion(data);
      if (data.yaRegistroLlegadaDpi) {
        onLlegadaRegistrada();
      }
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'No se pudo cargar tu asignación');
    } finally {
      setLoading(false);
    }
  }, [onLlegadaRegistrada]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const kits = asignacion?.kits ?? [];
  const todosMarcados = kits.length > 0 && marcados.size === kits.length;

  function toggleKit(id: string) {
    setMarcados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirmar() {
    Alert.alert(
      'Registrar llegada a Delegación',
      'Se registrará tu llegada al DPI y finalizará el rastreo de tu ubicación. ¿Deseas continuar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Registrar Llegada', style: 'default', onPress: ejecutarLlegada },
      ],
    );
  }

  async function ejecutarLlegada() {
    setRegistrando(true);
    try {
      const ubicacion = await obtenerUbicacionPuntual();
      const result = await postLlegadaDpi({
        latitud: ubicacion.latitud,
        longitud: ubicacion.longitud,
        ocurridoEn: new Date().toISOString(),
        precisionMetros: ubicacion.precisionMetros,
      });
      if (result === null) {
        Alert.alert('Sin señal', 'Llegada al DPI guardada localmente. Se sincronizará automáticamente.');
      }
      // HU5-CA3: finaliza el rastreo en tiempo real.
      await detenerRastreo();
      onLlegadaRegistrada();
    } catch (e: any) {
      if (e instanceof LocationServicesDisabledError) {
        Alert.alert(
          'Activa la ubicación',
          'Activa los servicios de ubicación del dispositivo para registrar tu llegada al DPI.',
        );
      } else if (e instanceof LocationPermissionDeniedError) {
        Alert.alert(
          'Permiso de ubicación requerido',
          'Concede el permiso de ubicación para registrar tu llegada al DPI.',
        );
      } else {
        Alert.alert(
          'Error',
          e?.response?.data?.message ?? 'No se pudo registrar la llegada. Intenta de nuevo.',
        );
      }
    } finally {
      setRegistrando(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <AppBar subtitle="Llegada al DPI" />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <AppBar subtitle="Llegada al DPI" onRefresh={cargar} />
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.btnSecondary} onPress={cargar}>
            <Text style={styles.btnSecondaryText}>Reintentar</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AppBar subtitle="Llegada al DPI" onRefresh={cargar} refreshing={loading} />
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={cargar} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        <Text style={styles.title}>Llegada a la Delegación</Text>
        <Text style={styles.subtitle}>
          Hola {user?.nombres}, marca todos tus kits electorales para confirmar que regresan
          contigo a la Delegación Provincial de Imbabura.
        </Text>

        <View style={styles.card}>
          {kits.map((k) => {
            const checked = marcados.has(k.id);
            return (
              <Pressable key={k.id} style={styles.kitRow} onPress={() => toggleKit(k.id)}>
                <View style={[styles.checkbox, checked && styles.checkboxOn]}>
                  {checked ? <Text style={styles.checkboxMark}>✓</Text> : null}
                </View>
                <View style={styles.kitInfo}>
                  <Text style={styles.kitNombre}>{k.nombre}</Text>
                  <Text style={styles.kitCodigo}>{k.codigoUnico}</Text>
                  {k.contenidos ? (
                    <Text style={styles.kitContenidos}>{k.contenidos}</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.contador}>
          {marcados.size} de {kits.length} kit{kits.length === 1 ? '' : 's'} marcado
          {marcados.size === 1 ? '' : 's'}
        </Text>

        <Pressable
          style={[styles.btnPrimary, (!todosMarcados || registrando) && styles.btnDisabled]}
          disabled={!todosMarcados || registrando}
          onPress={confirmar}
        >
          {registrando ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnPrimaryText}>Registrar Llegada a Delegación</Text>
          )}
        </Pressable>

        <Pressable style={styles.btnSecondary} onPress={() => logout()}>
          <Text style={styles.btnSecondaryText}>Cerrar sesión</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bgPage },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  body: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 22, fontFamily: fontFamily.bold, color: c.textPrimary },
  subtitle: {
    fontSize: 14,
    fontFamily: fontFamily.regular,
    color: c.textMeta,
    marginTop: 8,
    marginBottom: 20,
    lineHeight: 20,
  },
  card: {
    backgroundColor: c.bgCard,
    borderRadius: 12,
    padding: 8,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  kitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: c.textPlaceholder,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxOn: { backgroundColor: c.success, borderColor: c.success },
  checkboxMark: { color: '#fff', fontFamily: fontFamily.bold, fontSize: 14 },
  kitInfo: { flex: 1 },
  kitNombre: { fontSize: 15, fontFamily: fontFamily.semiBold, color: c.textPrimary },
  kitCodigo: { fontSize: 13, fontFamily: fontFamily.regular, color: c.textSecondary, marginTop: 2 },
  kitContenidos: { fontSize: 12, fontFamily: fontFamily.regular, color: c.textPlaceholder, marginTop: 2 },
  contador: {
    fontSize: 13,
    fontFamily: fontFamily.medium,
    color: c.textSecondary,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 16,
  },
  btnPrimary: {
    backgroundColor: c.primary,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnDisabled: { backgroundColor: c.primaryDisabled },
  btnPrimaryText: { color: '#fff', textAlign: 'center', fontFamily: fontFamily.semiBold, fontSize: 15 },
  btnSecondary: { paddingVertical: 10, paddingHorizontal: 24, alignItems: 'center', marginTop: 12 },
  btnSecondaryText: { color: c.textSecondary, fontFamily: fontFamily.medium },
  errorText: { color: c.error, fontFamily: fontFamily.medium, textAlign: 'center', marginBottom: 16 },
});
