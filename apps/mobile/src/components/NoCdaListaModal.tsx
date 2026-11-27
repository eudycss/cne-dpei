import { useMemo } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MiAsignacionRecinto } from '@cne/shared-types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoCdaChecklist } from './NoCdaChecklist';
import { useTheme } from '../theme/ThemeContext';
import { fontFamily } from '../theme/typography';
import { Colors } from '../theme/colors';

interface Props {
  visible: boolean;
  noCdas: MiAsignacionRecinto[];
  bloqueo: string | null;
  /** Texto de bienvenida (al llegar al recinto); sin él es el listado simple. */
  intro?: string;
  onMarcado: () => void;
  onCerrar: () => void;
}

/** Ventana desde abajo con el listado de NO CDA y sus botones "Marcar llegada". */
export function NoCdaListaModal({ visible, noCdas, bloqueo, intro, onMarcado, onCerrar }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const faltan = noCdas.filter((nc) => !nc.llegadaRegistradaEn).length;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCerrar}>
      <View style={styles.fondo}>
        <View style={[styles.hoja, { paddingBottom: 20 + insets.bottom }]} accessibilityViewIsModal>
          <View style={styles.encabezado}>
            <Text style={styles.titulo} accessibilityRole="header">
              Recintos NO CDA
            </Text>
            <Pressable
              onPress={onCerrar}
              accessibilityRole="button"
              accessibilityLabel="Cerrar la lista de recintos NO CDA"
              hitSlop={8}
              style={({ pressed }) => [styles.flecha, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="chevron-down" size={26} color={colors.textPrimary} />
            </Pressable>
          </View>
          {intro ? <Text style={styles.intro}>{intro}</Text> : null}
          <ScrollView style={styles.lista}>
            <NoCdaChecklist noCdas={noCdas} onMarcado={onMarcado} bloqueo={bloqueo} conProgreso />
          </ScrollView>
          <Pressable style={styles.cerrar} onPress={onCerrar} accessibilityRole="button">
            <Text style={styles.cerrarTexto}>{intro && faltan > 0 && !bloqueo ? 'Entendido' : 'Cerrar'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** Texto de la ventana al llegar al recinto. */
export function introLlegada(total: number): string {
  return total === 1
    ? 'Tiene 1 recinto NO CDA a su cargo. Cuando llegue, márquelo aquí o desde la barra de abajo.'
    : `Tiene ${total} recintos NO CDA a su cargo. Cuando llegue cada uno, márquelo aquí o desde la barra de abajo.`;
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    fondo: { flex: 1, backgroundColor: c.modalOverlay, justifyContent: 'flex-end' },
    hoja: { backgroundColor: c.bgCard, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, maxHeight: '85%' },
    encabezado: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
    titulo: { flex: 1, fontSize: 20, fontFamily: fontFamily.bold, color: c.textPrimary },
    flecha: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border },
    intro: { fontSize: 15, fontFamily: fontFamily.medium, color: c.textPrimary, marginBottom: 12, lineHeight: 21 },
    lista: { flexGrow: 0 },
    cerrar: {
      marginTop: 12,
      minHeight: 48,
      borderRadius: 10,
      backgroundColor: c.primaryBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cerrarTexto: { color: '#ffffff', fontSize: 16, fontFamily: fontFamily.bold },
  });
