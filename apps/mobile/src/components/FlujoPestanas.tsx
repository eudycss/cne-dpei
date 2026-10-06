import { ReactNode, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';
import { fontFamily } from '../theme/typography';
import { AppBarSinInsetSuperior } from './AppBar';

/** Al menos una pestaña: la primera es la activa al montar. */
export type ListaPestanas = [Pestana, ...Pestana[]];

export interface Pestana {
  id: string;
  label: string;
  render: () => ReactNode;
}

/**
 * Barra de pestañas superior + la pantalla de la pestaña activa. La comparten
 * los roles que no siguen el flujo lineal del operador (supervisor, asistente).
 */
export function FlujoPestanas({ pestanas }: { pestanas: ListaPestanas }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [activa, setActiva] = useState(pestanas[0].id);
  const actual = pestanas.find((p) => p.id === activa) ?? pestanas[0];

  return (
    <View style={styles.container}>
      <View style={[styles.tabBar, { paddingTop: insets.top + 6 }]} accessibilityRole="tablist">
        {pestanas.map(({ id, label }) => {
          const seleccionada = actual.id === id;
          // Una palabra sola nunca se parte ("Verificado/s"): se achica para caber.
          const unaPalabra = !label.includes(' ');
          return (
            <Pressable
              key={id}
              style={[styles.tabBtn, seleccionada && styles.tabBtnActive]}
              onPress={() => setActiva(id)}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: seleccionada }}
            >
              <Text
                style={[styles.tabText, seleccionada && styles.tabTextActive]}
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
      <AppBarSinInsetSuperior.Provider value={true}>{actual.render()}</AppBarSinInsetSuperior.Provider>
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
  tabBtnActive: { backgroundColor: c.primaryBg },
  tabText: { fontSize: 13, fontFamily: fontFamily.semiBold, color: c.textSecondary, textAlign: 'center' },
  tabTextActive: { color: '#fff' },
});
