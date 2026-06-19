import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Logo } from './Logo';
import { MiRecintoModal } from './MiRecintoModal';
import { ReportarIncidenciaModal } from './ReportarIncidenciaModal';
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
  const esOperador = user?.roles.includes('OPERADOR_CDA') ?? false;
  const spin = useRef(new Animated.Value(0)).current;

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
});
