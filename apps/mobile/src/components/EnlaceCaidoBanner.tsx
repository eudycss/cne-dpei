import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NotificacionItem } from '@cne/shared-types';
import { describirNotificacion } from '../lib/notifications';
import { fontFamily } from '../theme/typography';

interface Props {
  items: NotificacionItem[];
  onConfirmar: () => Promise<void>;
}

// Rojo fijo (no el token `error` del tema, que en modo oscuro es #f87171 y
// da ~2.77:1 de contraste con texto blanco — falla WCAG AA). Mismo valor
// que usa el banner de web, ~10:1 de contraste, independiente del tema.
const BANNER_RED = '#7f1d1d';

/**
 * Aviso de enlaces caídos que no se cierra solo ni se puede descartar sin
 * confirmar, pero NO bloquea el resto de la app (no usa <Modal>): el
 * usuario puede seguir navegando y usando otras pantallas mientras resuelve
 * la caída. Reaparece mientras la notificación siga sin leer en el backend
 * (sobrevive a reabrir la app).
 */
export function EnlaceCaidoBanner({ items, onConfirmar }: Props) {
  const [confirmando, setConfirmando] = useState(false);

  async function handleConfirmar() {
    setConfirmando(true);
    try {
      await onConfirmar();
    } finally {
      setConfirmando(false);
    }
  }

  return (
    <View style={styles.banner} accessibilityRole="alert">
      <View style={styles.textCol}>
        <Text style={styles.title}>
          {items.length > 1 ? `${items.length} enlaces caídos` : 'Enlace caído'}
        </Text>
        {items.map((n) => (
          <Text key={n.id} style={styles.item} numberOfLines={1}>
            {describirNotificacion(n)}
          </Text>
        ))}
      </View>
      <Pressable
        style={styles.confirmBtn}
        onPress={handleConfirmar}
        disabled={confirmando}
        accessibilityRole="button"
        accessibilityState={{ disabled: confirmando, busy: confirmando }}
      >
        {confirmando ? (
          <ActivityIndicator size="small" color={BANNER_RED} />
        ) : (
          <Text style={styles.confirmBtnText}>Ya notifiqué</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: BANNER_RED,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  textCol: { flex: 1 },
  title: { fontSize: 12, fontFamily: fontFamily.bold, color: '#fff' },
  item: { fontSize: 11, fontFamily: fontFamily.regular, color: '#fff' },
  confirmBtn: { backgroundColor: '#fff', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10 },
  confirmBtnText: { fontSize: 12, fontFamily: fontFamily.bold, color: BANNER_RED },
});
