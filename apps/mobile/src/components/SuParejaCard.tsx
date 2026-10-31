import { useMemo } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { MiAsignacionCompanero } from '@cne/shared-types';
import { useTheme } from '../theme/ThemeContext';
import { fontFamily } from '../theme/typography';
import { Colors } from '../theme/colors';

interface Props {
  /** Pareja CDA del recinto; vacía o ausente (API antigua) = no se muestra. */
  pareja: MiAsignacionCompanero[] | undefined;
}

/** Número para marcar: solo dígitos (con + inicial opcional); null si no parece un teléfono. */
export function numeroParaLlamar(telefono: string | null): string | null {
  if (!telefono) return null;
  const digitos = telefono.replace(/\D/g, '');
  if (digitos.length < 7) return null;
  return telefono.trim().startsWith('+') ? `+${digitos}` : digitos;
}

function llamar(nombre: string, numero: string) {
  Linking.openURL(`tel:${numero}`).catch(() =>
    Alert.alert('No se pudo llamar', `Este celular no pudo abrir el marcador. Marque a ${nombre}: ${numero}`),
  );
}

/** "Su pareja": las dos personas del recinto, con su cargo y un botón para llamar a la otra. */
export function SuParejaCard({ pareja }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Sin nadie más que usted (pareja sin asistente) la tarjeta no aporta.
  if (!pareja?.some((p) => !p.esUsted)) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle} accessibilityRole="header">
        Su pareja
      </Text>
      {pareja.map((p, idx) => {
        const numero = p.esUsted ? null : numeroParaLlamar(p.telefono);
        return (
          <View key={`${p.nombre}-${idx}`} style={[styles.fila, idx === pareja.length - 1 && styles.filaUltima]}>
            <View style={{ flex: 1 }} accessible accessibilityLabel={`${p.nombre}${p.esUsted ? ', usted' : ''}, ${p.cargo}`}>
              <Text style={styles.nombre}>{p.esUsted ? `${p.nombre} (usted)` : p.nombre}</Text>
              <Text style={styles.cargo}>{p.cargo}</Text>
            </View>
            {numero ? (
              <Pressable
                style={styles.llamar}
                accessibilityRole="button"
                accessibilityLabel={`Llamar a ${p.nombre}`}
                hitSlop={8}
                onPress={() => llamar(p.nombre, numero)}
              >
                <Ionicons name="call" size={16} color={colors.primary} />
                <Text style={styles.llamarTexto}>Llamar</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.bgCard,
      padding: 16,
      borderRadius: 10,
      marginBottom: 14,
      shadowColor: '#000',
      shadowOpacity: 0.05,
      shadowRadius: 6,
      elevation: 2,
    },
    cardTitle: {
      fontSize: 13,
      fontFamily: fontFamily.semiBold,
      color: c.textSecondary,
      textTransform: 'uppercase',
      marginBottom: 8,
      letterSpacing: 0.5,
    },
    fila: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    filaUltima: { borderBottomWidth: 0 },
    nombre: {
      fontSize: 15,
      fontFamily: fontFamily.semiBold,
      color: c.textPrimary,
    },
    cargo: {
      fontSize: 12,
      fontFamily: fontFamily.regular,
      color: c.textMeta,
      marginTop: 2,
    },
    llamar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 44,
      paddingHorizontal: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.primary,
    },
    llamarTexto: {
      fontSize: 14,
      fontFamily: fontFamily.bold,
      color: c.primary,
    },
  });
