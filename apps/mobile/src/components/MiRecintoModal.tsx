import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MiAsignacionResponse } from '@cne/shared-types';
import { getMiAsignacion } from '../lib/queries/tracking';
import { hayPendiente } from '../lib/offline-queue';
import { SuParejaCard } from './SuParejaCard';
import { BLOQUEO_ANTES_DE_LLEGAR, BLOQUEO_TRAS_SALIDA, NoCdaChecklist, juntasTotales as jt } from './NoCdaChecklist';
import { useTheme } from '../theme/ThemeContext';
import { fontFamily } from '../theme/typography';
import { Colors } from '../theme/colors';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Los NO CDA se marcan solo mientras el operador está en su CDA (entre su
 * llegada y su salida). Una llegada al CDA que aún está en la cola sin señal
 * cuenta como hecha: la cola la envía antes que las marcas de NO CDA.
 */
export function bloqueoNoCda(
  a: Pick<MiAsignacionResponse, 'yaRegistroLlegada' | 'yaRegistroSalidaRecinto'>,
  llegadaEnCola = false,
): string | null {
  if (!a.yaRegistroLlegada && !llegadaEnCola) return BLOQUEO_ANTES_DE_LLEGAR;
  if (a.yaRegistroSalidaRecinto) return BLOQUEO_TRAS_SALIDA;
  return null;
}

export function MiRecintoModal({ visible, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<MiAsignacionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [llegadaEnCola, setLlegadaEnCola] = useState(false);
  const cargar = () => {
    setError(null);
    hayPendiente('/tracking/llegada-recinto')
      .catch(() => false)
      .then(setLlegadaEnCola);
    getMiAsignacion()
      .then(setData)
      .catch(() => setError('No se pudo cargar la información de tu recinto.'));
  };

  useEffect(() => {
    if (!visible) return;
    cargar();
  }, [visible]);

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

              <View style={{ marginTop: 14 }}>
                <SuParejaCard pareja={data.pareja} />
              </View>

              <Text style={[styles.sectionLabel, { marginTop: 4 }]}>NO-CDAs a mi cargo</Text>
              <NoCdaChecklist noCdas={data.noCdas} onMarcado={cargar} bloqueo={bloqueoNoCda(data, llegadaEnCola)} conProgreso />

              <Text style={styles.totalJuntas}>Nro Juntas Total: {totalJuntas}</Text>

              <Text style={[styles.sectionLabel, { marginTop: 18 }]}>
                En caso de problema con el kit, dirigirse a
              </Text>
              {data.contingencia ? (
                <>
                  <Text style={styles.recintoNombre}>{data.contingencia.nombre}</Text>
                  {data.contingencia.direccion ? <Text style={styles.recintoMeta}>{data.contingencia.direccion}</Text> : null}
                </>
              ) : (
                <Text style={styles.muted}>Sin unidad de contingencia configurada.</Text>
              )}
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
  totalJuntas: { fontSize: 13, fontFamily: fontFamily.bold, color: c.textPrimary, marginTop: 6 },
  muted: { fontSize: 13, fontFamily: fontFamily.regular, color: c.textSecondary },
  error: { fontSize: 13, fontFamily: fontFamily.regular, color: c.error, marginVertical: 12 },
  closeBtn: { marginTop: 18, alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 14 },
  closeBtnText: { fontSize: 14, fontFamily: fontFamily.bold, color: c.primary },
});
