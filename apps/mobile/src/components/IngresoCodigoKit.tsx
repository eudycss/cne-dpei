import { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';
import { fontFamily } from '../theme/typography';
import { CameraQr } from './CameraQr';

/**
 * Escanear el QR del kit o, si el QR está dañado o la cámara falla, escribir
 * el código impreso. Lo usan la entrega al militar y la verificación de retorno.
 */
export function IngresoCodigoKit({
  onCodigo,
  ocupado,
}: {
  onCodigo: (codigo: string) => void;
  ocupado: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [mostrarCamara, setMostrarCamara] = useState(false);
  const [codigoManual, setCodigoManual] = useState('');
  const codigo = codigoManual.trim();
  const puedeValidar = codigo.length > 0 && !ocupado;

  function enviar(valor: string) {
    setCodigoManual('');
    onCodigo(valor);
  }

  return (
    <View>
      <Pressable
        style={[styles.btnPrimary, ocupado && styles.btnDisabled]}
        onPress={() => setMostrarCamara(true)}
        disabled={ocupado}
        accessibilityRole="button"
        accessibilityState={{ disabled: ocupado }}
      >
        <Text style={styles.btnPrimaryText}>Escanear Kit</Text>
      </Pressable>

      <Text style={styles.manualLabel}>O escribe el código del kit</Text>
      <View style={styles.manualRow}>
        <TextInput
          style={styles.manualInput}
          value={codigoManual}
          onChangeText={(t) => setCodigoManual(t.toUpperCase())}
          placeholder="Ej. ABCD2345"
          placeholderTextColor={colors.textPlaceholder}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={40}
          accessibilityLabel="Código del kit"
          onSubmitEditing={() => puedeValidar && enviar(codigo)}
        />
        <Pressable
          style={[styles.btnValidar, !puedeValidar && styles.btnDisabled]}
          disabled={!puedeValidar}
          onPress={() => enviar(codigo)}
          accessibilityRole="button"
          accessibilityLabel="Validar código"
          accessibilityState={{ disabled: !puedeValidar }}
        >
          {ocupado ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Validar</Text>}
        </Pressable>
      </View>

      <Modal visible={mostrarCamara} animationType="slide" presentationStyle="fullScreen">
        <CameraQr
          onScan={(c) => {
            setMostrarCamara(false);
            onCodigo(c);
          }}
          onCancel={() => setMostrarCamara(false)}
        />
      </Modal>
    </View>
  );
}

const makeStyles = (c: Colors) => StyleSheet.create({
  btnPrimary: { backgroundColor: c.primaryBg, paddingVertical: 14, borderRadius: 8, marginBottom: 10, minHeight: 48 },
  btnPrimaryText: { color: '#fff', textAlign: 'center', fontSize: 14, fontFamily: fontFamily.semiBold },
  btnDisabled: { backgroundColor: c.primaryDisabled },
  manualLabel: { fontSize: 13, fontFamily: fontFamily.semiBold, color: c.textSecondary, marginTop: 8, marginBottom: 6 },
  manualRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  manualInput: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderColor: c.borderInput,
    backgroundColor: c.bgCard,
    color: c.textPrimary,
    paddingHorizontal: 12,
    borderRadius: 8,
    fontSize: 15,
    fontFamily: fontFamily.medium,
    letterSpacing: 1,
  },
  btnValidar: { backgroundColor: c.primaryBg, paddingHorizontal: 18, borderRadius: 8, justifyContent: 'center', minHeight: 48 },
});
