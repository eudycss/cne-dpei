import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { EstadoOperadorCda, RecintoDificilAccesoDto } from '@cne/shared-types';
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';
import { AppBar } from '../components/AppBar';
import { getRecintosDificilAcceso, postLlegadaRecintoManual } from '../lib/queries/monitoreo';
import { fontFamily } from '../theme/typography';

const ESTADO_INFO: Record<EstadoOperadorCda, { label: string; color: string }> = {
  EN_DPI: { label: 'En DPI', color: '#9ca3af' },
  EN_TRANSITO: { label: 'En tránsito', color: '#2563eb' },
  EN_RECINTO: { label: 'En el recinto', color: '#f59e0b' },
  EN_RETORNO: { label: 'En retorno', color: '#2563eb' },
  RETORNADO: { label: 'Retornado', color: '#16a34a' },
};

const YA_LLEGO: EstadoOperadorCda[] = ['EN_RECINTO', 'EN_RETORNO', 'RETORNADO'];

export function RecintosDificilAccesoScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [recintos, setRecintos] = useState<RecintoDificilAccesoDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [registrando, setRegistrando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getRecintosDificilAcceso();
      setRecintos(data);
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'No se pudieron cargar los recintos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function registrarLlegada(recinto: RecintoDificilAccesoDto) {
    setRegistrando(recinto.recintoId);
    try {
      await postLlegadaRecintoManual(recinto.recintoId);
      setRecintos((prev) =>
        prev.map((r) => (r.recintoId === recinto.recintoId ? { ...r, estado: 'EN_RECINTO' } : r)),
      );
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.message ?? 'No se pudo registrar la llegada.');
    } finally {
      setRegistrando(null);
    }
  }

  return (
    <View style={styles.container}>
      <AppBar subtitle="Recintos difíciles" onRefresh={cargar} refreshing={loading} />

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={cargar}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : recintos.length === 0 ? (
          <Text style={styles.empty}>No hay recintos de difícil acceso para tus operadores.</Text>
        ) : (
          recintos.map((r) => {
            const info = ESTADO_INFO[r.estado];
            const yaLlego = YA_LLEGO.includes(r.estado);
            return (
              <View key={r.recintoId} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={[styles.dot, { backgroundColor: info.color }]} />
                  <Text style={styles.codigo}>{r.codigoRecinto}</Text>
                </View>
                <Text style={styles.nombre}>{r.nombreRecinto}</Text>
                <Text style={styles.operador}>{r.operadorNombre}</Text>
                <Text style={[styles.estado, { color: info.color }]}>{info.label}</Text>
                {!yaLlego && (
                  <Pressable
                    style={[styles.btn, registrando === r.recintoId && styles.btnDisabled]}
                    disabled={registrando === r.recintoId}
                    onPress={() => registrarLlegada(r)}
                  >
                    <Text style={styles.btnText}>
                      {registrando === r.recintoId ? 'Registrando…' : 'Registrar llegada'}
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bgPage },
    list: { flex: 1 },
    listContent: { padding: 16, paddingTop: 4, gap: 10 },
    card: {
      backgroundColor: c.bgCard,
      borderRadius: 10,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
    dot: { width: 10, height: 10, borderRadius: 5 },
    codigo: { fontSize: 14, fontFamily: fontFamily.semiBold, color: c.textPrimary, flex: 1 },
    nombre: { fontSize: 13, fontFamily: fontFamily.regular, color: c.textSecondary, marginBottom: 4 },
    operador: { fontSize: 13, fontFamily: fontFamily.medium, color: c.primary, marginBottom: 4 },
    estado: { fontSize: 13, fontFamily: fontFamily.semiBold, marginBottom: 10 },
    btn: {
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingVertical: 8,
      alignItems: 'center',
    },
    btnText: { fontSize: 13, fontFamily: fontFamily.semiBold, color: '#fff' },
    btnDisabled: { opacity: 0.5 },
    empty: { fontSize: 14, fontFamily: fontFamily.regular, color: c.textSecondary, marginTop: 8 },
    errorText: { fontSize: 14, fontFamily: fontFamily.medium, color: c.error, marginTop: 8 },
  });
