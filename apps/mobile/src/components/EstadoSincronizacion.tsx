import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEstadoSincronizacion, type AccionRechazada } from '../lib/offline-queue';
import { useTheme } from '../theme/ThemeContext';
import { fontFamily } from '../theme/typography';
import { Colors } from '../theme/colors';

const NOMBRE_REGISTRO: Record<string, string> = {
  '/tracking/salida-dpi': 'Salida de la Delegación',
  '/tracking/llegada-no-cda': 'Llegada a un recinto NO-CDA',
  '/tracking/prueba-conexion': 'Prueba de conexión',
  '/tracking/recepcion-kit': 'Recepción de kit',
  '/tracking/llegada-recinto': 'Llegada al recinto',
  '/tracking/salida-recinto': 'Salida del recinto',
  '/tracking/posiciones': 'Ubicación en ruta',
  '/tracking/llegada-dpi': 'Llegada a la Delegación',
  '/incidencias': 'Incidencia',
};

export function nombreRegistro(endpoint: string): string {
  return NOMBRE_REGISTRO[endpoint] ?? 'Registro';
}

function formatHora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Indicadores de la barra superior del operador:
 * - Pendientes: registros guardados sin señal que se enviarán solos.
 * - Rechazados: registros que el servidor no aceptó al sincronizar, con el
 *   motivo, para que el operador avise a su supervisor (antes se perdían en silencio).
 */
export function EstadoSincronizacion() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { pendientes, rechazadas, descartar } = useEstadoSincronizacion();
  const [verPendientes, setVerPendientes] = useState(false);
  const [verRechazadas, setVerRechazadas] = useState(false);
  const rechazadasAnunciadas = useRef(0);

  useEffect(() => {
    // Un rechazo nuevo se anuncia aunque el operador no esté mirando la barra.
    if (rechazadas.length > rechazadasAnunciadas.current) {
      AccessibilityInfo.announceForAccessibility(
        `${rechazadas.length} registro(s) no se pudieron enviar. Toca el aviso rojo para ver el motivo.`,
      );
    }
    rechazadasAnunciadas.current = rechazadas.length;
  }, [rechazadas.length]);

  return (
    <>
      {pendientes > 0 && (
        <Pressable
          style={styles.badge}
          onPress={() => setVerPendientes(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${pendientes} registro(s) sin enviar. Se enviarán al recuperar señal.`}
        >
          <Ionicons name="cloud-upload-outline" size={16} color={colors.warningText} />
          <Text style={styles.badgePendientesText}>{pendientes}</Text>
        </Pressable>
      )}
      {rechazadas.length > 0 && (
        <Pressable
          style={styles.badge}
          onPress={() => setVerRechazadas(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${rechazadas.length} registro(s) no se pudieron enviar. Ver el motivo.`}
        >
          <Ionicons name="alert-circle" size={18} color={colors.error} />
          <Text style={styles.badgeRechazadasText}>{rechazadas.length}</Text>
        </Pressable>
      )}

      <Modal visible={verPendientes} transparent animationType="fade" onRequestClose={() => setVerPendientes(false)}>
        <View style={styles.backdrop}>
          <View style={styles.card} accessibilityViewIsModal>
            <Text style={styles.title} accessibilityRole="header">Sin conexión</Text>
            <Text style={styles.texto}>
              Tienes {pendientes} registro(s) guardado(s) en el celular. Se enviarán solos al recuperar señal, en
              el mismo orden en que los hiciste.
            </Text>
            <Text style={styles.texto}>No cierres sesión hasta que se envíen: se perderían.</Text>
            <Pressable style={styles.closeBtn} onPress={() => setVerPendientes(false)} accessibilityRole="button">
              <Text style={styles.closeBtnText}>Entendido</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={verRechazadas} transparent animationType="fade" onRequestClose={() => setVerRechazadas(false)}>
        <View style={styles.backdrop}>
          <View style={styles.card} accessibilityViewIsModal>
            <Text style={styles.title} accessibilityRole="header">Registros no enviados</Text>
            <Text style={styles.texto}>
              El servidor no aceptó estos registros. Avisa a tu supervisor con el motivo de cada uno.
            </Text>
            <ScrollView style={styles.lista}>
              {rechazadas.map((r: AccionRechazada) => (
                <View key={r.id} style={styles.item}>
                  <Text style={styles.itemTitulo}>
                    {nombreRegistro(r.endpoint)} · {formatHora(r.registradaEn)}
                  </Text>
                  <Text style={styles.itemMotivo}>{r.motivo}</Text>
                </View>
              ))}
            </ScrollView>
            <View style={styles.acciones}>
              <Pressable style={styles.closeBtn} onPress={() => setVerRechazadas(false)} accessibilityRole="button">
                <Text style={styles.closeBtnText}>Cerrar</Text>
              </Pressable>
              <Pressable
                style={styles.closeBtn}
                onPress={async () => {
                  await descartar(rechazadas.map((r) => r.id));
                  setVerRechazadas(false);
                }}
                accessibilityRole="button"
                accessibilityHint="Quita estos avisos de la lista"
              >
                <Text style={styles.closeBtnText}>Ya avisé, quitar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const makeStyles = (c: Colors) => StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 32, justifyContent: 'center' },
  badgePendientesText: { fontSize: 11, fontFamily: fontFamily.semiBold, color: c.warningText },
  badgeRechazadasText: { fontSize: 11, fontFamily: fontFamily.bold, color: c.error },
  backdrop: { flex: 1, backgroundColor: c.modalOverlay, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: c.bgCard, borderRadius: 12, padding: 22, width: '100%', maxWidth: 380 },
  title: { fontSize: 18, fontFamily: fontFamily.bold, color: c.textPrimary, marginBottom: 10 },
  texto: { fontSize: 14, fontFamily: fontFamily.regular, color: c.textPrimary, marginBottom: 8, lineHeight: 20 },
  lista: { maxHeight: 280, marginTop: 4 },
  item: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border },
  itemTitulo: { fontSize: 14, fontFamily: fontFamily.semiBold, color: c.textPrimary },
  itemMotivo: { fontSize: 13, fontFamily: fontFamily.regular, color: c.error, marginTop: 2 },
  acciones: { flexDirection: 'row', justifyContent: 'flex-end', gap: 4, marginTop: 10 },
  closeBtn: { paddingVertical: 10, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center' },
  closeBtnText: { fontSize: 14, fontFamily: fontFamily.bold, color: c.primary },
});
