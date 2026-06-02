import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Logo } from './Logo';
import { fontFamily } from '../theme/typography';

interface AppBarProps {
  subtitle?: string;
}

export function AppBar({ subtitle }: AppBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 10 }]}>
      <Logo height={32} />
      <View style={styles.textWrap}>
        <Text style={styles.title}>CNE Imbabura</Text>
        <Text style={styles.subtitle}>{subtitle ?? 'Trazabilidad Electoral'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  textWrap: { flex: 1 },
  title: { fontSize: 15, fontFamily: fontFamily.bold, color: '#1f2937' },
  subtitle: { fontSize: 11, fontFamily: fontFamily.medium, color: '#6b7280', marginTop: 1 },
});
