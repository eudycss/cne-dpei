import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { MiAsignacionRecinto } from '@cne/shared-types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BLOQUEO_ANTES_DE_LLEGAR } from './NoCdaChecklist';
import { useTheme } from '../theme/ThemeContext';
import { fontFamily } from '../theme/typography';
import { Colors } from '../theme/colors';

interface Props {
  noCdas: MiAsignacionRecinto[];
  /** Motivo del bloqueo (aún no llega al recinto, ya salió); null = se puede marcar. */
  bloqueo: string | null;
  onPress: () => void;
}

/** "Llegaron 2 de 5 NO CDA" y su estado (para la barra y el lector de pantalla). */
export function resumenNoCda(noCdas: MiAsignacionRecinto[], bloqueo: string | null) {
  const total = noCdas.length;
  const llegaron = noCdas.filter((nc) => !!nc.llegadaRegistradaEn).length;
  const estado: 'bloqueado' | 'completo' | 'pendiente' = bloqueo ? 'bloqueado' : llegaron === total ? 'completo' : 'pendiente';
  const titulo =
    estado === 'bloqueado'
      ? `${total} NO CDA a su cargo`
      : estado === 'completo'
        ? `Llegaron los ${total} NO CDA`
        : `NO CDA: llegaron ${llegaron} de ${total}`;
  const detalle =
    estado === 'bloqueado'
      ? bloqueo === BLOQUEO_ANTES_DE_LLEGAR
        ? 'Se habilitan al llegar al recinto'
        : 'Ya no se marcan: registró la salida'
      : estado === 'completo'
        ? 'Ver lista'
        : 'Toque para marcar los que llegan';
  return { total, llegaron, estado, titulo, detalle };
}

/**
 * Barra fija al pie de la pantalla (no se va con el scroll): cuántos NO CDA
 * llegaron y acceso directo al listado. Ámbar mientras falte alguno, verde
 * cuando llegaron todos y gris con candado mientras no se pueda marcar.
 * No se muestra si el CDA no tiene NO CDA.
 */
export function NoCdaBarra({ noCdas, bloqueo, onPress }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  if (noCdas.length === 0) return null;
  const r = resumenNoCda(noCdas, bloqueo);
  const tono =
    r.estado === 'completo'
      ? { fondo: colors.successBg, texto: colors.successText, borde: colors.success, icono: 'checkmark-circle' as const }
      : r.estado === 'pendiente'
        ? { fondo: colors.warningBg, texto: colors.warningText, borde: colors.warningText, icono: 'school' as const }
        : { fondo: colors.bgCard, texto: colors.textPrimary, borde: colors.border, icono: 'lock-closed' as const };

  return (
    <Pressable
      testID="barra-no-cda"
      onPress={onPress}
      style={({ pressed }) => [
        styles.barra,
        { backgroundColor: tono.fondo, borderTopColor: tono.borde, paddingBottom: 10 + insets.bottom },
        pressed && styles.presionada,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${r.titulo}. ${r.detalle}`}
      accessibilityHint="Abre el listado de recintos NO CDA"
    >
      <Ionicons name={tono.icono} size={26} color={tono.texto} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.titulo, { color: tono.texto }]}>{r.titulo}</Text>
        <Text style={[styles.detalle, { color: tono.texto }]}>{r.detalle}</Text>
      </View>
      {r.estado === 'pendiente' ? (
        <View style={styles.accion}>
          <Text style={styles.accionTexto}>Marcar</Text>
        </View>
      ) : (
        <Ionicons name="chevron-up" size={22} color={tono.texto} />
      )}
    </Pressable>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    barra: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 64,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderTopWidth: 3,
    },
    presionada: { opacity: 0.85 },
    titulo: { fontSize: 16, fontFamily: fontFamily.bold },
    detalle: { fontSize: 13, fontFamily: fontFamily.medium },
    accion: { backgroundColor: c.primaryBg, borderRadius: 24, minHeight: 44, paddingHorizontal: 18, justifyContent: 'center' },
    accionTexto: { color: '#ffffff', fontSize: 15, fontFamily: fontFamily.bold },
  });
