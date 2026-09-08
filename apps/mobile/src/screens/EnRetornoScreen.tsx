import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { LocationSubscription } from 'expo-location';
import type { MiAsignacionResponse } from '@cne/shared-types';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';
import { AppBar } from '../components/AppBar';
import { UbicacionCard } from '../components/UbicacionCard';
import { fontFamily } from '../theme/typography';
import { iniciarRastreoPrimerPlano } from '../lib/location';
import { getMiAsignacion } from '../lib/queries/tracking';
import { useProximidad } from '../lib/useProximidad';

interface Props {
  onMarcarLlegada: () => void;
}

export function EnRetornoScreen({ onMarcarLlegada }: Props) {
  const { user, logout } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [asignacion, setAsignacion] = useState<MiAsignacionResponse | null>(null);

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

  useEffect(() => {
    getMiAsignacion()
      .then(setAsignacion)
      .catch(() => setAsignacion(null));
  }, []);

  // Memoizado por si en el futuro se reconstruye a partir de campos sueltos
  // (como en EnTransitoScreen) — evita reintroducir un loop de efecto si
  // alguien deja de devolver la misma referencia de `asignacion.delegacion`.
  const destino = useMemo(() => asignacion?.delegacion ?? null, [asignacion]);
  const { info, verificando, error, verificar } = useProximidad(
    destino,
    asignacion?.margenLlegadaDpiMetros ?? 150,
  );

  useEffect(() => {
    if (destino) verificar();
    // Solo al obtener la coordenada de la Delegación; "Actualizar ubicación" cubre los refrescos manuales.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destino]);

  // Si no hay coordenada de la Delegación configurada, o no se pudo verificar
  // (sin permiso de GPS, etc.), no bloqueamos: el servidor vuelve a validar al
  // registrar la llegada en el paso siguiente.
  const bloqueadoPorLejania = info != null && !info.dentro;
  const puedeContinuar = !verificando && !bloqueadoPorLejania;

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

        {destino ? (
          <UbicacionCard
            info={info}
            verificando={verificando}
            error={error}
            onActualizar={verificar}
            destinoLabel="la Delegación"
          />
        ) : null}

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
        <Pressable style={styles.btnSecondary} onPress={() => logout()}>
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
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  icon: { fontSize: 36 },
  title: { fontSize: 24, fontFamily: fontFamily.bold, color: c.textPrimary, textAlign: 'center' },
  subtitle: { fontSize: 14, fontFamily: fontFamily.regular, color: c.textMeta, textAlign: 'center', marginTop: 12, lineHeight: 20 },
  message: { fontSize: 13, fontFamily: fontFamily.regular, color: c.textSecondary, textAlign: 'center', marginTop: 16, marginBottom: 24, lineHeight: 20 },
  btnPrimary: {
    backgroundColor: c.primary,
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
