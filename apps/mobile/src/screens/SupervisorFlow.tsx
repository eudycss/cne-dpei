import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';
import { fontFamily } from '../theme/typography';
import { MonitoreoScreen } from './MonitoreoScreen';
import { VerificacionDpiScreen } from './VerificacionDpiScreen';
import { KitsVerificadosScreen } from './KitsVerificadosScreen';
import { AlertasScreen } from './AlertasScreen';
import { RecintosDificilAccesoScreen } from './RecintosDificilAccesoScreen';

type Tab = 'MONITOREO' | 'VERIFICAR_DPI' | 'VERIFICADOS' | 'ALERTAS' | 'DIFICIL_ACCESO';

export function SupervisorFlow() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tab, setTab] = useState<Tab>('MONITOREO');

  return (
    <View style={styles.container}>
      <View style={[styles.tabBar, { paddingTop: insets.top + 6 }]}>
        <Pressable
          style={[styles.tabBtn, tab === 'MONITOREO' && styles.tabBtnActive]}
          onPress={() => setTab('MONITOREO')}
        >
          <Text style={[styles.tabText, tab === 'MONITOREO' && styles.tabTextActive]}>Monitoreo</Text>
        </Pressable>
        <Pressable
          style={[styles.tabBtn, tab === 'VERIFICAR_DPI' && styles.tabBtnActive]}
          onPress={() => setTab('VERIFICAR_DPI')}
        >
          <Text style={[styles.tabText, tab === 'VERIFICAR_DPI' && styles.tabTextActive]}>
            Verificar Kits DPI
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tabBtn, tab === 'VERIFICADOS' && styles.tabBtnActive]}
          onPress={() => setTab('VERIFICADOS')}
        >
          <Text style={[styles.tabText, tab === 'VERIFICADOS' && styles.tabTextActive]}>Verificados</Text>
        </Pressable>
        <Pressable
          style={[styles.tabBtn, tab === 'ALERTAS' && styles.tabBtnActive]}
          onPress={() => setTab('ALERTAS')}
        >
          <Text style={[styles.tabText, tab === 'ALERTAS' && styles.tabTextActive]}>Alertas</Text>
        </Pressable>
        <Pressable
          style={[styles.tabBtn, tab === 'DIFICIL_ACCESO' && styles.tabBtnActive]}
          onPress={() => setTab('DIFICIL_ACCESO')}
        >
          <Text style={[styles.tabText, tab === 'DIFICIL_ACCESO' && styles.tabTextActive]}>
            Recintos difíciles
          </Text>
        </Pressable>
      </View>
      {tab === 'MONITOREO' ? (
        <MonitoreoScreen />
      ) : tab === 'VERIFICAR_DPI' ? (
        <VerificacionDpiScreen />
      ) : tab === 'VERIFICADOS' ? (
        <KitsVerificadosScreen />
      ) : tab === 'ALERTAS' ? (
        <AlertasScreen />
      ) : (
        <RecintosDificilAccesoScreen />
      )}
    </View>
  );
}

const makeStyles = (c: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bgPage },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: c.bgCard,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 8,
  },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  tabBtnActive: { backgroundColor: c.primary },
  tabText: { fontSize: 13, fontFamily: fontFamily.semiBold, color: c.textSecondary },
  tabTextActive: { color: '#fff' },
});
