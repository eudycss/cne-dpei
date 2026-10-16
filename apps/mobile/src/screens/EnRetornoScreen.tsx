import { useEffect, useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { LocationSubscription } from 'expo-location';
import { useAuth } from '../auth/AuthContext';
import { useCerrarSesion } from '../auth/useCerrarSesion';
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';
import { AppBar } from '../components/AppBar';
import { UbicacionCard } from '../components/UbicacionCard';
import { OfflineNotice } from '../components/OfflineNotice';
import { AvisoRastreo } from '../components/AvisoRastreo';
import { fontFamily } from '../theme/typography';
import { iniciarRastreoPrimerPlano } from '../lib/location';
import { useMiAsignacion } from '../lib/useMiAsignacion';
import { useProximidad } from '../lib/useProximidad';
import { useEstadoRastreo } from '../lib/useEstadoRastreo';

interface Props {
  onMarcarLlegada: () => void;
}

export function EnRetornoScreen({ onMarcarLlegada }: Props) {
  const { user } = useAuth();
  const cerrarSesion = useCerrarSesion();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { asignacion, sinConexion, recargar } = useMiAsignacion();
  const rastreo = useEstadoRastreo();

  useEffect(() => {
    let sub: LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      const s = await iniciarRastreoPrimerPlano();
      if (cancelled) s?.remove();
      else sub = s;
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);

  // Memoizado por valor (como en EnTransitoScreen): "Actualizar ubicación"
  // recarga la asignación y trae un objeto nuevo; si la coordenada no cambió,
  // el efecto de abajo no debe volver a leer el GPS.
  const latitud = asignacion?.delegacion?.latitud ?? null;
  const longitud = asignacion?.delegacion?.longitud ?? null;
  const destino = useMemo(
    () => (latitud != null && longitud != null ? { latitud, longitud } : null),
    [latitud, longitud],
  );
  const { info, verificando, error, verificar } = useProximidad(
    destino,
    asignacion?.margenLlegadaDpiMetros ?? 150,
  );

  useEffect(() => {
    if (destino) verificar();
    // Solo al obtener la coordenada de la Delegación; "Actualizar ubicación" cubre los refrescos manuales.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destino]);

  // Además de releer el GPS, trae de nuevo margen y coordenadas: si el
  // administrador los cambió, se aplican sin cerrar sesión. Si cambian las
  // coordenadas, el efecto de arriba vuelve a medir contra las nuevas.
  function actualizar() {
    void recargar();
    void verificar();
  }

  // Si no hay coordenada de la Delegación configurada, o no se pudo verificar
  // (sin permiso de GPS, etc.), no bloqueamos: el servidor vuelve a validar al
  // registrar la llegada en el paso siguiente.
  const bloqueadoPorLejania = info != null && !info.dentro;
  const puedeContinuar = !verificando && !bloqueadoPorLejania;
  const rastreoActivo = rastreo.estado === 'activo';

  return (
    <View style={styles.container}>
      <AppBar subtitle="En retorno al DPI" />
      <View style={styles.body}>
        <View style={styles.iconCircle}>
          <Text style={styles.icon}>📍</Text>
        </View>
        <Text style={styles.title}>
          {rastreoActivo ? 'Rastreo activo' : 'Salida del recinto registrada'}
        </Text>
        <Text style={styles.subtitle}>
          Hola {user?.nombres}, tu salida del recinto está registrada
          {rastreoActivo
            ? ' y tu ubicación se está compartiendo en tiempo real durante el retorno al DPI.'
            : '.'}
        </Text>
        <Text style={styles.message}>
          Mantén la aplicación instalada y la ubicación activada. Cuando llegues a la
          Delegación, presiona el botón para registrar tu llegada.
        </Text>

        {destino ? (
          <UbicacionCard
            info={info}
            verificando={verificando}
            error={error}
            onActualizar={actualizar}
            destinoLabel="la Delegación"
          />
        ) : null}

        {rastreo.estado === 'inactivo' ? (
          <AvisoRastreo
            activando={rastreo.activando}
            permisoDenegado={rastreo.permisoDenegado}
            onActivar={rastreo.activar}
          />
        ) : null}

        {sinConexion ? <OfflineNotice /> : null}

        <Pressable
          style={[styles.btnPrimary, !puedeContinuar && styles.btnDisabled]}
          onPress={onMarcarLlegada}
          disabled={!puedeContinuar}
          accessibilityLabel="Ya llegué al DPI"
          accessibilityState={{ disabled: !puedeContinuar, busy: verificando }}
        >
          {verificando ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnPrimaryText}>Ya llegué al DPI</Text>
          )}
        </Pressable>
        <Pressable style={styles.btnSecondary} onPress={cerrarSesion}>
          <Text style={styles.btnSecondaryText}>Cerrar sesión</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (c: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bgPage },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: c.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  icon: { fontSize: 36 },
  title: { fontSize: 24, fontFamily: fontFamily.bold, color: c.textPrimary, textAlign: 'center' },
  subtitle: { fontSize: 14, fontFamily: fontFamily.regular, color: c.textMeta, textAlign: 'center', marginTop: 12, lineHeight: 20 },
  message: { fontSize: 13, fontFamily: fontFamily.regular, color: c.textSecondary, textAlign: 'center', marginTop: 16, marginBottom: 24, lineHeight: 20 },
  btnPrimary: {
    backgroundColor: c.primaryBg,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 8,
    marginBottom: 12,
    minWidth: 240,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  btnPrimaryText: { color: '#fff', textAlign: 'center', fontFamily: fontFamily.semiBold, fontSize: 15 },
  btnSecondary: { paddingVertical: 10, paddingHorizontal: 24 },
  btnSecondaryText: { color: c.textSecondary, fontFamily: fontFamily.medium },
});
