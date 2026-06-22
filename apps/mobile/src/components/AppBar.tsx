import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NotificacionItem } from '@cne/shared-types';
import { Logo } from './Logo';
import { MiRecintoModal } from './MiRecintoModal';
import { ReportarIncidenciaModal } from './ReportarIncidenciaModal';
import { NotificacionesModal } from './NotificacionesModal';
import { getMisNotificaciones, marcarNotificacionLeida } from '../lib/notifications';
import { fontFamily } from '../theme/typography';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../auth/AuthContext';
import { Colors } from '../theme/colors';

interface AppBarProps {
  subtitle?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function AppBar({ subtitle, onRefresh, refreshing }: AppBarProps) {
  const insets = useSafeAreaInsets();
  const { theme, colors, toggle } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [showMiRecinto, setShowMiRecinto] = useState(false);
  const [showIncidencia, setShowIncidencia] = useState(false);
  const [showNotif, setShowNotif] = useState(false);
  const [notifs, setNotifs] = useState<NotificacionItem[]>([]);
  const [noLeidas, setNoLeidas] = useState(0);
  const esOperador = user?.roles.includes('OPERADOR_CDA') ?? false;
  // El operador no es destinatario de notificaciones (van al supervisor + admins).
  const recibeNotif = !!user && !esOperador;
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!recibeNotif) return;
    let activo = true;
    const cargar = () => {
      getMisNotificaciones({ pageSize: 10 })
        .then((d) => {
          if (!activo) return;
          setNotifs(d.items);
          setNoLeidas(d.noLeidas);
        })
        .catch(() => {});
    };
    cargar();
    const id = setInterval(cargar, 30_000);
    return () => {
      activo = false;
      clearInterval(id);
    };
  }, [recibeNotif]);

  const marcarLeida = async (notifId: string) => {
    setNotifs((prev) => prev.map((n) => (n.id === notifId ? { ...n, leidaEn: new Date().toISOString() } : n)));
    setNoLeidas((prev) => Math.max(0, prev - 1));
    try {
      await marcarNotificacionLeida(notifId);
    } catch {
      /* el próximo polling reconcilia el estado */
    }
  };

  useEffect(() => {
    if (!refreshing) {
      spin.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 700, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [refreshing, spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 10 }]}>
      <Logo height={32} />
      <View style={styles.textWrap}>
        <Text style={styles.title}>CNE Imbabura</Text>
        <Text style={styles.subtitle}>{subtitle ?? 'Trazabilidad Electoral'}</Text>
      </View>
      {onRefresh && (
        <Pressable onPress={onRefresh} disabled={refreshing} hitSlop={8} accessibilityLabel="Actualizar">
          <Animated.View style={{ transform: [{ rotate }] }}>
            <Ionicons name="refresh-circle" size={28} color={colors.primary} />
          </Animated.View>
        </Pressable>
      )}
      {esOperador && (
        <Pressable onPress={() => setShowMiRecinto(true)} hitSlop={8} accessibilityLabel="Mi recinto">
          <Ionicons name="information-circle-outline" size={22} color={colors.textSecondary} />
        </Pressable>
      )}
      {esOperador && (
        <Pressable onPress={() => setShowIncidencia(true)} hitSlop={8} accessibilityLabel="Reportar incidencia">
          <Ionicons name="warning-outline" size={22} color={colors.textSecondary} />
        </Pressable>
      )}
      {recibeNotif && (
        <Pressable onPress={() => setShowNotif(true)} hitSlop={8} accessibilityLabel="Notificaciones">
          <View>
            <Ionicons name="notifications-outline" size={22} color={colors.textSecondary} />
            {noLeidas > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{noLeidas > 99 ? '99+' : noLeidas}</Text>
              </View>
            )}
          </View>
        </Pressable>
      )}
      <Pressable onPress={toggle} hitSlop={8} accessibilityLabel={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}>
        <Ionicons
          name={theme === 'dark' ? 'sunny-outline' : 'moon-outline'}
          size={22}
          color={colors.textSecondary}
        />
      </Pressable>
      {esOperador && <MiRecintoModal visible={showMiRecinto} onClose={() => setShowMiRecinto(false)} />}
      {esOperador && (
        <ReportarIncidenciaModal visible={showIncidencia} onClose={() => setShowIncidencia(false)} />
      )}
      {recibeNotif && (
        <NotificacionesModal
          visible={showNotif}
          items={notifs}
          noLeidas={noLeidas}
          onMarkLeida={marcarLeida}
          onClose={() => setShowNotif(false)}
        />
      )}
    </View>
  );
}

const makeStyles = (c: Colors) => StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: c.bgCard,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  textWrap: { flex: 1 },
  title: { fontSize: 15, fontFamily: fontFamily.bold, color: c.textPrimary },
  subtitle: { fontSize: 11, fontFamily: fontFamily.medium, color: c.textSecondary, marginTop: 1 },
  badge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: c.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 9, fontFamily: fontFamily.bold, color: '#fff' },
});
