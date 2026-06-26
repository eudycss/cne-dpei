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
import { postSalidaRecinto } from '../lib/queries/retorno';
import {
  asegurarServiciosUbicacion,
  iniciarRastreo,
  LocationPermissionDeniedError,
  LocationServicesDisabledError,
  obtenerUbicacionPuntual,
  solicitarPermisoBackground,
} from '../lib/location';
import { fontFamily } from '../theme/typography';

type Props = {
  onSalidaRegistrada: () => void;
};

export function SalidaRecintoScreen({ onSalidaRegistrada }: Props) {
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
      if (data.yaRegistroSalidaRecinto) {
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
      'Registrar salida del recinto',
      'Se registrará la salida del recinto y se iniciará el rastreo de tu retorno al DPI. ¿Deseas continuar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Registrar Salida', style: 'default', onPress: ejecutarSalida },
      ],
    );
  }

  async function ejecutarSalida() {
    setRegistrando(true);
    try {
      // HU4-CA2: no se permite la acción si los servicios de ubicación están apagados.
      await asegurarServiciosUbicacion();
      const ubicacion = await obtenerUbicacionPuntual();
      const result = await postSalidaRecinto({
        latitud: ubicacion.latitud,
        longitud: ubicacion.longitud,
        ocurridoEn: new Date().toISOString(),
      });

      if (result === null) {
        Alert.alert('Sin señal', 'Salida del recinto guardada localmente. Se sincronizará automáticamente.');
      }

      // HU4-CA3: iniciar rastreo continuo en segundo plano. Es "best-effort":
      // la salida ya quedó registrada (o encolada), así que si esto falla el operador
      // igual debe poder continuar.
      try {
        await solicitarPermisoBackground();
        await iniciarRastreo();
      } catch {
        Alert.alert(
          'Rastreo en segundo plano no disponible',
          'Tu salida quedó registrada, pero no se pudo activar el rastreo de ubicación en segundo plano en este dispositivo.',
        );
      }

      onSalidaRegistrada();
    } catch (e: any) {
      if (e instanceof LocationServicesDisabledError) {
        Alert.alert(
          'Activa la ubicación',
          'Debes activar los servicios de ubicación del dispositivo para registrar la salida del recinto.',
        );
      } else if (e instanceof LocationPermissionDeniedError) {
        Alert.alert(
          'Permiso de ubicación requerido',
          'Concede el permiso de ubicación para registrar la salida del recinto.',
        );
      } else if (e?.response?.status === 409) {
        Alert.alert('Salida ya registrada', 'Ya habías registrado tu salida del recinto.');
        onSalidaRegistrada();
      } else {
        Alert.alert(
          'Error',
          e?.response?.data?.message ?? 'No se pudo registrar la salida. Intenta de nuevo.',
        );
      }
    } finally {
      setRegistrando(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <AppBar subtitle="Salida del recinto" />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <AppBar subtitle="Salida del recinto" onRefresh={cargar} />
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
      <AppBar subtitle="Salida del recinto" onRefresh={cargar} refreshing={loading} />
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={cargar} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        <Text style={styles.title}>Salida del recinto electoral</Text>
        <Text style={styles.subtitle}>
          Hola {user?.nombres}, marca todos tus kits electorales para confirmar que salen
          contigo del recinto.
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
            <Text style={styles.btnPrimaryText}>Registrar Salida de Recinto Electoral</Text>
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
