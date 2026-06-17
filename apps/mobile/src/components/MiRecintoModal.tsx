import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { MiAsignacionRecinto, MiAsignacionResponse } from '@cne/shared-types';
import { getMiAsignacion, postLlegadaNoCda } from '../lib/queries/tracking';
import { useTheme } from '../theme/ThemeContext';
import { fontFamily } from '../theme/typography';
import { Colors } from '../theme/colors';

interface Props {
  visible: boolean;
  onClose: () => void;
}

function jt(r: MiAsignacionRecinto): number {
  return (r.juntasFemeninas ?? 0) + (r.juntasMasculinas ?? 0);
}

function formatHora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
}

export function MiRecintoModal({ visible, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<MiAsignacionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [marcando, setMarcando] = useState<string | null>(null);

  const cargar = () => {
    setError(null);
    getMiAsignacion()
      .then(setData)
      .catch(() => setError('No se pudo cargar la información de tu recinto.'));
  };

  useEffect(() => {
    if (!visible) return;
    cargar();
  }, [visible]);

  const marcarLlegada = async (recintoId: string) => {
    setMarcando(recintoId);
    try {
      await postLlegadaNoCda(recintoId);
      cargar();
    } catch {
      setError('No se pudo registrar la llegada. Intenta de nuevo.');
    } finally {
      setMarcando(null);
    }
  };

  const totalJuntas = data ? jt(data.recinto) + data.noCdas.reduce((sum, nc) => sum + jt(nc), 0) : 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Mi recinto</Text>

          {error ? (
            <Text style={styles.error}>{error}</Text>
          ) : !data ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
          ) : (
            <ScrollView style={{ maxHeight: '70%' }}>
              <Text style={styles.sectionLabel}>CDA asignado</Text>
              <Text style={styles.recintoNombre}>{data.recinto.nombre}</Text>
              <Text style={styles.recintoMeta}>Código: {data.recinto.codigoRecinto}</Text>
              <Text style={styles.recintoMeta}>
                JF: {data.recinto.juntasFemeninas ?? '—'} · JM: {data.recinto.juntasMasculinas ?? '—'} · JT: {jt(data.recinto)}
              </Text>

              <Text style={[styles.sectionLabel, { marginTop: 18 }]}>NO-CDAs a mi cargo</Text>
              {data.noCdas.length === 0 ? (
                <Text style={styles.muted}>Sin NO-CDAs asignados a este CDA.</Text>
              ) : (
                data.noCdas.map((nc) => {
                  const llegado = !!nc.llegadaRegistradaEn;
                  return (
                    <Pressable
                      key={nc.id}
                      style={styles.noCdaRow}
                      disabled={llegado || marcando === nc.id}
                      onPress={() => marcarLlegada(nc.id)}
                    >
                      <Ionicons
                        name={llegado ? 'checkbox' : 'square-outline'}
                        size={20}
                        color={llegado ? colors.success : colors.textSecondary}
                        style={styles.checkbox}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.recintoNombre}>{nc.nombre}</Text>
                        <Text style={styles.recintoMeta}>
                          {nc.codigoRecinto}
                          {nc.parroquia ? ` · ${nc.parroquia}` : ''}
                        </Text>
                        <Text style={styles.recintoMeta}>
                          JF: {nc.juntasFemeninas ?? '—'} · JM: {nc.juntasMasculinas ?? '—'} · JT: {jt(nc)}
                        </Text>
                        {llegado && (
                          <Text style={styles.llegadaText}>
                            Llegada registrada a las {formatHora(nc.llegadaRegistradaEn!)}
                          </Text>
                        )}
                      </View>
                    </Pressable>
                  );
                })
              )}

              <Text style={styles.totalJuntas}>Nro Juntas Total: {totalJuntas}</Text>

              <Text style={[styles.sectionLabel, { marginTop: 18 }]}>
                En caso de problema con el kit, dirigirse a
              </Text>
              <Text style={styles.muted}>Sin unidad de contingencia configurada.</Text>
            </ScrollView>
          )}

          <Pressable style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Cerrar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: Colors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: c.modalOverlay, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: c.bgCard, borderRadius: 12, padding: 22, width: '100%', maxWidth: 380 },
  title: { fontSize: 18, fontFamily: fontFamily.bold, color: c.textPrimary, marginBottom: 10 },
  sectionLabel: { fontSize: 12, fontFamily: fontFamily.bold, color: c.textSecondary, marginBottom: 4 },
  recintoNombre: { fontSize: 14, fontFamily: fontFamily.medium, color: c.textPrimary },
  recintoMeta: { fontSize: 12, fontFamily: fontFamily.regular, color: c.textMeta },
  noCdaRow: { marginBottom: 12, flexDirection: 'row', alignItems: 'flex-start' },
  checkbox: { marginRight: 8, marginTop: 2 },
  llegadaText: { fontSize: 12, fontFamily: fontFamily.medium, color: c.successText },
  totalJuntas: { fontSize: 13, fontFamily: fontFamily.bold, color: c.textPrimary, marginTop: 6 },
  muted: { fontSize: 13, fontFamily: fontFamily.regular, color: c.textSecondary },
  error: { fontSize: 13, fontFamily: fontFamily.regular, color: c.error, marginVertical: 12 },
  closeBtn: { marginTop: 18, alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 14 },
  closeBtnText: { fontSize: 14, fontFamily: fontFamily.bold, color: c.primary },
});
