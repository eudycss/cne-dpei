import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Alerta, EstadoAlerta, TipoAlerta } from '@cne/shared-types';
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';
import { AppBar } from '../components/AppBar';
import { actualizarEstadoAlerta, getAlertas, getEventoActivo } from '../lib/queries/alertas';
import { fontFamily } from '../theme/typography';

const TIPO_LABELS: Record<TipoAlerta, string> = {
  NO_LLEGO_RECINTO: 'No llegó al recinto',
  NO_LLEGO_DPI: 'No llegó al DPI',
  SIN_SINCRONIZAR: 'Sin sincronización',
  KIT_NO_CORRESPONDE: 'Kit no corresponde',
};

const ESTADO_COLOR: Record<EstadoAlerta, string> = {
  GENERADA: '#ef4444',
  VISTA: '#f59e0b',
  ATENDIDA: '#16a34a',
};

type FiltroEstado = '' | 'GENERADA' | 'VISTA' | 'ATENDIDA';

export function AlertasScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [filtro, setFiltro] = useState<FiltroEstado>('GENERADA');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accionando, setAccionando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const evento = await getEventoActivo();
      if (!evento) {
        setAlertas([]);
        setError('No hay ningún evento activo.');
        return;
      }
      const data = await getAlertas({ eventoId: evento.id, estado: filtro || undefined });
      setAlertas(data);
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'No se pudieron cargar las alertas.');
    } finally {
      setLoading(false);
    }
  }, [filtro]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function marcar(id: string, estado: 'VISTA' | 'ATENDIDA') {
    setAccionando(id);
    try {
      await actualizarEstadoAlerta(id, { estado });
      setAlertas((prev) =>
        prev.map((a) => (a.id === id ? { ...a, estado } : a)),
      );
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Error al actualizar la alerta.');
    } finally {
      setAccionando(null);
    }
  }

  const filtros: { label: string; value: FiltroEstado }[] = [
    { label: 'Generadas', value: 'GENERADA' },
    { label: 'Vistas', value: 'VISTA' },
    { label: 'Atendidas', value: 'ATENDIDA' },
    { label: 'Todas', value: '' },
  ];

  return (
    <View style={styles.container}>
      <AppBar subtitle="Alertas" onRefresh={cargar} refreshing={loading} />

      <View style={styles.filtros}>
        {filtros.map((f) => (
          <Pressable
            key={f.value}
            style={[styles.chip, filtro === f.value && styles.chipActive]}
            onPress={() => setFiltro(f.value)}
          >
            <Text style={[styles.chipText, filtro === f.value && styles.chipTextActive]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

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
        ) : alertas.length === 0 ? (
          <Text style={styles.empty}>No hay alertas con este filtro.</Text>
        ) : (
          alertas.map((a) => (
            <View key={a.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={[styles.dot, { backgroundColor: ESTADO_COLOR[a.estado] }]} />
                <Text style={styles.tipo}>{TIPO_LABELS[a.tipo]}</Text>
              </View>
              {a.operadorNombre ? (
                <Text style={styles.operador}>{a.operadorNombre}</Text>
              ) : null}
              <Text style={styles.mensaje}>{a.mensaje}</Text>
              {a.estado !== 'ATENDIDA' && (
                <View style={styles.acciones}>
                  {a.estado === 'GENERADA' && (
                    <Pressable
                      style={[styles.btnSec, accionando === a.id && styles.btnDisabled]}
                      disabled={accionando === a.id}
                      onPress={() => marcar(a.id, 'VISTA')}
                    >
                      <Text style={styles.btnSecText}>Ver</Text>
                    </Pressable>
                  )}
                  <Pressable
                    style={[styles.btn, accionando === a.id && styles.btnDisabled]}
                    disabled={accionando === a.id}
                    onPress={() => marcar(a.id, 'ATENDIDA')}
                  >
                    <Text style={styles.btnText}>Atender</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bgPage },
    filtros: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 10,
      flexWrap: 'wrap',
    },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.bgCard,
    },
    chipActive: { backgroundColor: c.primary, borderColor: c.primary },
    chipText: { fontSize: 13, fontFamily: fontFamily.medium, color: c.textSecondary },
    chipTextActive: { color: '#fff' },
    list: { flex: 1 },
    listContent: { padding: 16, paddingTop: 4, gap: 10 },
    card: {
      backgroundColor: c.bgCard,
      borderRadius: 10,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    dot: { width: 10, height: 10, borderRadius: 5 },
    tipo: { fontSize: 14, fontFamily: fontFamily.semiBold, color: c.textPrimary, flex: 1 },
    operador: { fontSize: 13, fontFamily: fontFamily.medium, color: c.primary, marginBottom: 4 },
    mensaje: { fontSize: 13, fontFamily: fontFamily.regular, color: c.textSecondary },
    acciones: { flexDirection: 'row', gap: 8, marginTop: 10 },
    btn: {
      flex: 1,
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingVertical: 8,
      alignItems: 'center',
    },
    btnText: { fontSize: 13, fontFamily: fontFamily.semiBold, color: '#fff' },
    btnSec: {
      flex: 1,
      backgroundColor: c.btnSecondaryBg,
      borderRadius: 8,
      paddingVertical: 8,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: c.btnSecondaryBorder,
    },
    btnSecText: { fontSize: 13, fontFamily: fontFamily.semiBold, color: c.btnSecondaryText },
    btnDisabled: { opacity: 0.5 },
    empty: { fontSize: 14, fontFamily: fontFamily.regular, color: c.textSecondary, marginTop: 8 },
    errorText: { fontSize: 14, fontFamily: fontFamily.medium, color: c.error, marginTop: 8 },
  });
