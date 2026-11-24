import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { MiAsignacionRecinto } from '@cne/shared-types';
import { postLlegadaNoCda } from '../lib/queries/tracking';
import { useTheme } from '../theme/ThemeContext';
import { fontFamily } from '../theme/typography';
import { Colors } from '../theme/colors';

interface Props {
  noCdas: MiAsignacionRecinto[];
  /** Se llama tras marcar una llegada (con o sin señal) para recargar la asignación. */
  onMarcado: () => void;
}

export function juntasTotales(r: MiAsignacionRecinto): number {
  return (r.juntasFemeninas ?? 0) + (r.juntasMasculinas ?? 0);
}

function formatHora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Lista de los NO CDA del CDA con su casilla de llegada. Un toque marca la
 * llegada (sin señal queda en la cola offline). Ya marcado no se desmarca.
 */
export function NoCdaChecklist({ noCdas, onMarcado }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [marcando, setMarcando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const marcarLlegada = async (recintoId: string) => {
    setMarcando(recintoId);
    setError(null);
    try {
      await postLlegadaNoCda(recintoId);
      onMarcado();
    } catch {
      setError('No se pudo registrar la llegada. Intente de nuevo.');
    } finally {
      setMarcando(null);
    }
  };

  if (noCdas.length === 0) {
    return <Text style={styles.muted}>Sin NO-CDAs asignados a este CDA.</Text>;
  }

  return (
    <View>
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {noCdas.map((nc) => {
        const llegado = !!nc.llegadaRegistradaEn;
        const enCurso = marcando === nc.id;
        return (
          <Pressable
            key={nc.id}
            style={styles.row}
            disabled={llegado || marcando !== null}
            onPress={() => marcarLlegada(nc.id)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: llegado, disabled: llegado || marcando !== null }}
            accessibilityLabel={`${nc.nombre}, ${nc.codigoRecinto}${
              llegado ? `, llegó a las ${formatHora(nc.llegadaRegistradaEn!)}` : ', sin marcar'
            }`}
            accessibilityHint={llegado ? undefined : 'Toque para marcar que este NO CDA ya llegó'}
          >
            {enCurso ? (
              <ActivityIndicator size="small" color={colors.primary} style={styles.checkbox} />
            ) : (
              <Ionicons
                name={llegado ? 'checkbox' : 'square-outline'}
                size={22}
                color={llegado ? colors.success : colors.textSecondary}
                style={styles.checkbox}
              />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.nombre}>{nc.nombre}</Text>
              <Text style={styles.meta}>
                {nc.codigoRecinto}
                {nc.parroquia ? ` · ${nc.parroquia}` : ''}
              </Text>
              <Text style={styles.meta}>
                JF: {nc.juntasFemeninas ?? '—'} · JM: {nc.juntasMasculinas ?? '—'} · JT: {juntasTotales(nc)}
              </Text>
              {llegado && (
                <Text style={styles.llegada}>Llegada registrada a las {formatHora(nc.llegadaRegistradaEn!)}</Text>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    row: { marginBottom: 12, flexDirection: 'row', alignItems: 'flex-start', minHeight: 44 },
    checkbox: { marginRight: 10, marginTop: 1, width: 22 },
    nombre: { fontSize: 14, fontFamily: fontFamily.medium, color: c.textPrimary },
    meta: { fontSize: 12, fontFamily: fontFamily.regular, color: c.textMeta },
    llegada: { fontSize: 12, fontFamily: fontFamily.medium, color: c.successText },
    muted: { fontSize: 13, fontFamily: fontFamily.regular, color: c.textSecondary },
    error: { fontSize: 13, fontFamily: fontFamily.regular, color: c.error, marginBottom: 8 },
  });
