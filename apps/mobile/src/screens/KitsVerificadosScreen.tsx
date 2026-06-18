import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { KitVerificadoRetorno } from '@cne/shared-types';
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';
import { AppBar } from '../components/AppBar';
import { getKitsVerificadosRetorno } from '../lib/queries/retorno';
import { fontFamily } from '../theme/typography';

function formatearHora(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
}

export function KitsVerificadosScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<KitVerificadoRetorno[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const data = await getKitsVerificadosRetorno();
      setTotal(data.total);
      setItems(data.items);
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'No se pudo cargar la lista de kits verificados');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <View style={styles.container}>
      <AppBar subtitle="Kits verificados" onRefresh={cargar} refreshing={loading} />
      <View style={styles.totalWrap}>
        <Text style={styles.totalNumero}>{total}</Text>
        <Text style={styles.totalLabel}>kit{total === 1 ? '' : 's'} verificado{total === 1 ? '' : 's'}</Text>
      </View>
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={cargar} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : items.length === 0 ? (
          <Text style={styles.empty}>Todavía no se ha verificado ningún kit.</Text>
        ) : (
          items.map((it) => (
            <View key={it.kitId} style={styles.row}>
              <Text style={styles.rowCodigo}>{it.codigoUnico}</Text>
              <Text style={styles.rowNombre}>{it.nombre}</Text>
              <Text style={styles.rowMeta}>
                {it.operadorNombre} · {formatearHora(it.confirmadoEn)}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bgPage },
  totalWrap: { flexDirection: 'row', alignItems: 'baseline', gap: 8, padding: 16, paddingBottom: 8 },
  totalNumero: { fontSize: 32, fontFamily: fontFamily.bold, color: c.primary },
  totalLabel: { fontSize: 14, fontFamily: fontFamily.medium, color: c.textSecondary },
  list: { flex: 1 },
  listContent: { padding: 16, paddingTop: 4 },
  row: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  rowCodigo: { fontSize: 14, fontFamily: fontFamily.bold, color: c.primary, letterSpacing: 0.5 },
  rowNombre: { fontSize: 15, fontFamily: fontFamily.semiBold, color: c.textPrimary, marginTop: 2 },
  rowMeta: { fontSize: 13, fontFamily: fontFamily.regular, color: c.textSecondary, marginTop: 2 },
  empty: { fontSize: 14, fontFamily: fontFamily.regular, color: c.textSecondary, marginTop: 8 },
  error: { fontSize: 14, fontFamily: fontFamily.medium, color: c.error, marginTop: 8 },
});
