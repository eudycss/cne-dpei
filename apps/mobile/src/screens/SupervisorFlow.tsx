import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';
import { fontFamily } from '../theme/typography';
import { AppBarSinInsetSuperior } from '../components/AppBar';
import { MonitoreoScreen } from './MonitoreoScreen';
import { VerificacionDpiScreen } from './VerificacionDpiScreen';
import { KitsVerificadosScreen } from './KitsVerificadosScreen';
import { AlertasScreen } from './AlertasScreen';
import { RecintosDificilAccesoScreen } from './RecintosDificilAccesoScreen';

type Tab = 'MONITOREO' | 'VERIFICAR_DPI' | 'VERIFICADOS' | 'ALERTAS' | 'DIFICIL_ACCESO';

const TABS: { id: Tab; label: string }[] = [
  { id: 'MONITOREO', label: 'Monitoreo' },
  { id: 'VERIFICAR_DPI', label: 'Verificar Kits DPI' },
  { id: 'VERIFICADOS', label: 'Verificados' },
  { id: 'ALERTAS', label: 'Alertas' },
  { id: 'DIFICIL_ACCESO', label: 'Recintos difíciles' },
];

export function SupervisorFlow() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tab, setTab] = useState<Tab>('MONITOREO');

  return (
    <View style={styles.container}>
      <View style={[styles.tabBar, { paddingTop: insets.top + 6 }]} accessibilityRole="tablist">
        {TABS.map(({ id, label }) => {
          const activo = tab === id;
          // Una palabra sola nunca se parte ("Verificado/s"): se achica para caber.
          const unaPalabra = !label.includes(' ');
          return (
            <Pressable
              key={id}
              style={[styles.tabBtn, activo && styles.tabBtnActive]}
              onPress={() => setTab(id)}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: activo }}
            >
              <Text
                style={[styles.tabText, activo && styles.tabTextActive]}
                numberOfLines={unaPalabra ? 1 : 2}
                adjustsFontSizeToFit={unaPalabra}
                minimumFontScale={0.75}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {/* La barra de pestañas ya consumió el inset superior: el AppBar de cada
          pantalla no debe volver a sumarlo (dejaba un hueco del alto de la status bar). */}
      <AppBarSinInsetSuperior.Provider value={true}>
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
      </AppBarSinInsetSuperior.Provider>
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
  tabBtn: { flex: 1, minHeight: 44, paddingVertical: 8, paddingHorizontal: 2, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  tabBtnActive: { backgroundColor: c.primary },
  tabText: { fontSize: 13, fontFamily: fontFamily.semiBold, color: c.textSecondary, textAlign: 'center' },
  tabTextActive: { color: '#fff' },
});
