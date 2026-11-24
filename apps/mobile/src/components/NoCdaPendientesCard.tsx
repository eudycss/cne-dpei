import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { MiAsignacionRecinto } from '@cne/shared-types';
import { NoCdaChecklist } from './NoCdaChecklist';
import { textoFaltan } from '../lib/aviso-no-cda';
import { useTheme } from '../theme/ThemeContext';
import { fontFamily } from '../theme/typography';
import { Colors } from '../theme/colors';

interface Props {
  noCdas: MiAsignacionRecinto[];
  onMarcado: () => void;
}

/**
 * Tarjeta fija arriba de "Salida del recinto": cuántos NO CDA llegaron y
 * cuántos faltan. Ámbar y con la lista abierta mientras falte alguno; verde y
 * plegada cuando ya llegaron todos. No se muestra si el CDA no tiene NO CDA.
 */
export function NoCdaPendientesCard({ noCdas, onMarcado }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const llegaron = noCdas.filter((nc) => !!nc.llegadaRegistradaEn).length;
  const faltan = noCdas.length - llegaron;
  const completo = faltan === 0;
  const [verLista, setVerLista] = useState(false);

  if (noCdas.length === 0) return null;
  const listaAbierta = !completo || verLista;

  return (
    <View
      style={[styles.card, completo ? styles.cardOk : styles.cardPendiente]}
      testID="tarjeta-no-cda"
      accessibilityRole="summary"
    >
      <View style={styles.header}>
        <Ionicons
          name={completo ? 'checkmark-circle' : 'alert-circle'}
          size={30}
          color={completo ? colors.success : colors.warningText}
        />
        <View style={{ flex: 1 }}>
          <Text
            style={[styles.titulo, { color: completo ? colors.successText : colors.warningText }]}
            accessibilityRole="header"
            accessibilityLiveRegion="polite"
          >
            {completo ? `Llegaron los ${noCdas.length} NO CDA` : `${textoFaltan(faltan)} por marcar`}
          </Text>
          <Text style={styles.detalle}>
            Llegaron {llegaron} de {noCdas.length}
            {completo ? '' : ' · toque cada uno cuando llegue'}
          </Text>
        </View>
        <Text
          style={[styles.contador, { color: completo ? colors.successText : colors.warningText }]}
          accessibilityLabel={`${llegaron} de ${noCdas.length}`}
        >
          {llegaron}/{noCdas.length}
        </Text>
      </View>

      {listaAbierta ? (
        <View style={styles.lista}>
          <NoCdaChecklist noCdas={noCdas} onMarcado={onMarcado} />
        </View>
      ) : null}

      {completo ? (
        <Pressable
          onPress={() => setVerLista((v) => !v)}
          style={styles.toggle}
          accessibilityRole="button"
          accessibilityState={{ expanded: verLista }}
        >
          <Text style={styles.toggleText}>{verLista ? 'Ocultar lista' : 'Ver lista'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    card: { borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 2 },
    cardPendiente: { backgroundColor: c.warningBg, borderColor: c.warningText },
    cardOk: { backgroundColor: c.successBg, borderColor: c.success },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    titulo: { fontSize: 17, fontFamily: fontFamily.bold },
    detalle: { fontSize: 13, fontFamily: fontFamily.regular, color: c.textPrimary, marginTop: 2 },
    contador: { fontSize: 22, fontFamily: fontFamily.bold },
    lista: { marginTop: 12, backgroundColor: c.bgCard, borderRadius: 8, padding: 12, paddingBottom: 2 },
    toggle: { alignSelf: 'flex-end', marginTop: 6, paddingVertical: 8, paddingHorizontal: 6, minHeight: 44, justifyContent: 'center' },
    toggleText: { fontSize: 13, fontFamily: fontFamily.bold, color: c.primary },
  });
