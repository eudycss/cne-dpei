import { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NotificacionItem } from '@cne/shared-types';
import { describirNotificacion, formatearFechaHora } from '../lib/notifications';
import { useTheme } from '../theme/ThemeContext';
import { fontFamily } from '../theme/typography';
import { Colors } from '../theme/colors';

interface Props {
  visible: boolean;
  items: NotificacionItem[];
  noLeidas: number;
  onMarkLeida: (id: string) => void;
  onClose: () => void;
}

export function NotificacionesModal({ visible, items, noLeidas, onMarkLeida, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Notificaciones</Text>
          <Text style={styles.subtitle}>{noLeidas} sin leer</Text>

          {items.length === 0 ? (
            <Text style={styles.empty}>No tienes notificaciones aún.</Text>
          ) : (
            <ScrollView style={{ maxHeight: '70%', marginTop: 8 }}>
              {items.map((n) => {
                const leida = !!n.leidaEn;
                return (
                  <Pressable
                    key={n.id}
                    style={styles.row}
                    onPress={() => {
                      if (!leida) onMarkLeida(n.id);
                    }}
                  >
                    {!leida && <View style={styles.dot} />}
                    <View style={{ flex: 1, marginLeft: leida ? 14 : 0 }}>
                      <Text style={[styles.text, !leida && styles.textUnread]}>
                        {describirNotificacion(n)}
                      </Text>
                      <Text style={styles.meta}>{formatearFechaHora(n.creadoEn)}</Text>
                    </View>
                  </Pressable>
                );
              })}
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
  title: { fontSize: 18, fontFamily: fontFamily.bold, color: c.textPrimary },
  subtitle: { fontSize: 12, fontFamily: fontFamily.medium, color: c.textSecondary, marginTop: 2 },
  empty: { fontSize: 13, fontFamily: fontFamily.regular, color: c.textSecondary, marginVertical: 18 },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.primary, marginTop: 5, marginRight: 6 },
  text: { fontSize: 14, fontFamily: fontFamily.regular, color: c.textPrimary },
  textUnread: { fontFamily: fontFamily.medium },
  meta: { fontSize: 12, fontFamily: fontFamily.regular, color: c.textMeta, marginTop: 2 },
  closeBtn: { marginTop: 18, alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 14 },
  closeBtnText: { fontSize: 14, fontFamily: fontFamily.bold, color: c.primary },
});
