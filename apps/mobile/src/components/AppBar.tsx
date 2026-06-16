import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Logo } from './Logo';
import { fontFamily } from '../theme/typography';
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';

interface AppBarProps {
  subtitle?: string;
}

export function AppBar({ subtitle }: AppBarProps) {
  const insets = useSafeAreaInsets();
  const { theme, colors, toggle } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 10 }]}>
      <Logo height={32} />
      <View style={styles.textWrap}>
        <Text style={styles.title}>CNE Imbabura</Text>
        <Text style={styles.subtitle}>{subtitle ?? 'Trazabilidad Electoral'}</Text>
      </View>
      <Pressable onPress={toggle} hitSlop={8} accessibilityLabel={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}>
        <Ionicons
          name={theme === 'dark' ? 'sunny-outline' : 'moon-outline'}
          size={22}
          color={colors.textSecondary}
        />
      </Pressable>
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
