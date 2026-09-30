import { useMemo } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';
import { fontFamily } from '../theme/typography';

interface Props {
  activando: boolean;
  permisoDenegado: boolean;
  onActivar: () => void;
}

/** Aviso cuando el rastreo en segundo plano no está funcionando. */
export function AvisoRastreo({ activando, permisoDenegado, onActivar }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.card} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={styles.titulo}>Rastreo de ubicación detenido</Text>
      <Text style={styles.texto}>
        {permisoDenegado
          ? 'La app no tiene permiso de ubicación "Permitir todo el tiempo". Actívalo en Ajustes > Ubicación para que el técnico vea tu recorrido.'
          : 'Si minimizas la app, el técnico no verá tu recorrido. Actívalo y verifica que el GPS esté encendido.'}
      </Text>
      {permisoDenegado ? (
        <Pressable
          style={styles.boton}
          onPress={() => Linking.openSettings()}
          accessibilityRole="button"
          accessibilityHint="Abre los ajustes del teléfono para permitir la ubicación"
        >
          <Text style={styles.botonTexto}>Abrir ajustes</Text>
        </Pressable>
      ) : (
        <Pressable
          style={[styles.boton, activando && styles.botonDeshabilitado]}
          onPress={onActivar}
          disabled={activando}
          accessibilityRole="button"
          accessibilityLabel="Activar rastreo"
          accessibilityState={{ disabled: activando, busy: activando }}
        >
          {activando ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.botonTexto}>Activar rastreo</Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

const makeStyles = (c: Colors) => StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: c.warningText,
    backgroundColor: c.warningBg,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  titulo: { fontFamily: fontFamily.semiBold, fontSize: 14, color: c.warningText },
  texto: { fontFamily: fontFamily.regular, fontSize: 13, color: c.warningText, marginTop: 6, lineHeight: 19 },
  boton: {
    marginTop: 12,
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botonDeshabilitado: { opacity: 0.6 },
  botonTexto: { color: '#fff', fontFamily: fontFamily.semiBold, fontSize: 14 },
});
