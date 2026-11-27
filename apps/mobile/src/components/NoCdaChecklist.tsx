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
  /** Motivo por el que todavía no se puede marcar (p. ej. aún no llega al CDA); null = habilitado. */
  bloqueo?: string | null;
  /** Muestra "Llegaron X de N" arriba de la lista (cuando no hay otra tarjeta que lo diga). */
  conProgreso?: boolean;
}

export function juntasTotales(r: MiAsignacionRecinto): number {
  return (r.juntasFemeninas ?? 0) + (r.juntasMasculinas ?? 0);
}

function formatHora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
}

/** Mensaje de la API (400/409) si viene; si no, uno genérico. */
function mensajeError(e: unknown): string {
  const m = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  const texto = Array.isArray(m) ? m.join('. ') : typeof m === 'string' ? m : '';
  return texto || 'No se pudo registrar la llegada. Intente de nuevo.';
}

/** Motivo por defecto del bloqueo antes de llegar al CDA. */
export const BLOQUEO_ANTES_DE_LLEGAR = 'Se habilita cuando registre su llegada al CDA.';
export const BLOQUEO_TRAS_SALIDA = 'Ya registró la salida del CDA: los NO CDA ya no se marcan.';

/**
 * Lista de los NO CDA del CDA como tarjetas. Cada pendiente tiene un botón
 * grande "Marcar llegada" (sin señal queda en la cola offline); ya marcado se
 * pinta en verde con la hora y no se desmarca. Con `bloqueo`, las tarjetas
 * quedan con candado y un aviso explica cuándo se habilitan.
 */
export function NoCdaChecklist({ noCdas, onMarcado, bloqueo = null, conProgreso = false }: Props) {
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
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setMarcando(null);
    }
  };

  if (noCdas.length === 0) {
    return <Text style={styles.muted}>Sin NO-CDAs asignados a este CDA.</Text>;
  }

  const llegaron = noCdas.filter((nc) => !!nc.llegadaRegistradaEn).length;

  return (
    <View>
      {bloqueo ? (
        <View style={styles.bloqueo} testID="no-cda-bloqueo" accessibilityLiveRegion="polite">
          <Ionicons name="lock-closed" size={20} color={colors.warningText} />
          <Text style={styles.bloqueoTexto}>{bloqueo}</Text>
        </View>
      ) : null}
      {conProgreso ? (
        <Text style={styles.progreso} accessibilityLiveRegion="polite">
          Llegaron {llegaron} de {noCdas.length}
        </Text>
      ) : null}
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {noCdas.map((nc) => {
        const llegado = !!nc.llegadaRegistradaEn;
        const enCurso = marcando === nc.id;
        const deshabilitado = llegado || !!bloqueo || marcando !== null;
        return (
          <Pressable
            key={nc.id}
            style={({ pressed }) => [
              styles.tarjeta,
              llegado ? styles.tarjetaOk : bloqueo ? styles.tarjetaBloqueada : styles.tarjetaPendiente,
              pressed && !deshabilitado ? styles.presionada : null,
            ]}
            disabled={deshabilitado}
            onPress={() => marcarLlegada(nc.id)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: llegado, disabled: deshabilitado }}
            accessibilityLabel={`${nc.nombre}, ${nc.codigoRecinto}${
              llegado
                ? `, llegó a las ${formatHora(nc.llegadaRegistradaEn!)}`
                : bloqueo
                  ? ', bloqueado hasta llegar al CDA'
                  : ', sin marcar'
            }`}
            accessibilityHint={llegado || bloqueo ? undefined : 'Toque para marcar que este NO CDA ya llegó'}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.nombre}>{nc.nombre}</Text>
              <Text style={styles.meta}>
                {nc.codigoRecinto}
                {nc.parroquia ? ` · ${nc.parroquia}` : ''}
              </Text>
              <Text style={styles.meta}>
                JF: {nc.juntasFemeninas ?? '—'} · JM: {nc.juntasMasculinas ?? '—'} · JT: {juntasTotales(nc)}
              </Text>
            </View>
            {llegado ? (
              <View style={[styles.chip, styles.chipOk]}>
                <Ionicons name="checkmark-circle" size={18} color={colors.successText} />
                <Text style={[styles.chipTexto, { color: colors.successText }]}>
                  Llegó {formatHora(nc.llegadaRegistradaEn!)}
                </Text>
              </View>
            ) : bloqueo ? (
              <View style={[styles.chip, styles.chipBloqueado]}>
                <Ionicons name="lock-closed" size={16} color={colors.textSecondary} />
                <Text style={[styles.chipTexto, { color: colors.textSecondary }]}>Bloqueado</Text>
              </View>
            ) : (
              <View style={[styles.chip, styles.chipAccion]}>
                {enCurso ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Ionicons name="location" size={18} color="#ffffff" />
                )}
                <Text style={[styles.chipTexto, { color: '#ffffff' }]}>{enCurso ? 'Marcando…' : 'Marcar llegada'}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    tarjeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      minHeight: 64,
      padding: 12,
      marginBottom: 10,
      borderRadius: 10,
      borderWidth: 2,
      backgroundColor: c.bgCard,
    },
    tarjetaPendiente: { borderColor: c.primary },
    tarjetaOk: { borderColor: c.success, backgroundColor: c.successBg },
    tarjetaBloqueada: { borderColor: c.border, borderStyle: 'dashed', backgroundColor: c.bgPage },
    presionada: { opacity: 0.7 },
    nombre: { fontSize: 15, fontFamily: fontFamily.bold, color: c.textPrimary },
    meta: { fontSize: 12, fontFamily: fontFamily.regular, color: c.textMeta },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 48,
      paddingHorizontal: 12,
      borderRadius: 24,
    },
    chipAccion: { backgroundColor: c.primaryBg },
    chipOk: { backgroundColor: c.bgCard, borderWidth: 1, borderColor: c.success },
    chipBloqueado: { backgroundColor: c.bgPage, borderWidth: 1, borderColor: c.border },
    chipTexto: { fontSize: 14, fontFamily: fontFamily.bold },
    bloqueo: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      padding: 12,
      marginBottom: 10,
      borderRadius: 10,
      backgroundColor: c.warningBg,
    },
    bloqueoTexto: { flex: 1, fontSize: 14, fontFamily: fontFamily.medium, color: c.warningText },
    progreso: { fontSize: 14, fontFamily: fontFamily.bold, color: c.textPrimary, marginBottom: 8 },
    muted: { fontSize: 13, fontFamily: fontFamily.regular, color: c.textSecondary },
    error: { fontSize: 13, fontFamily: fontFamily.medium, color: c.error, marginBottom: 8 },
  });
