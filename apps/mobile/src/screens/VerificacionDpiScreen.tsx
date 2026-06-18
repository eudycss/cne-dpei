import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { ItemChecklist, ValidarKitRetornoResponse } from '@cne/shared-types';
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';
import { AppBar } from '../components/AppBar';
import { CameraQr } from '../components/CameraQr';
import { validarKitRetorno, verificarKitRetorno } from '../lib/queries/retorno';
import { fontFamily } from '../theme/typography';

export function VerificacionDpiScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [mostrarCamara, setMostrarCamara] = useState(false);
  const [kit, setKit] = useState<ValidarKitRetornoResponse | null>(null);
  const [items, setItems] = useState<ItemChecklist[]>([]);
  const [observaciones, setObservaciones] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [verificados, setVerificados] = useState(0);

  const todosMarcados = items.every((i) => i.marcado);
  const puedeConfirmar = todosMarcados || observaciones.trim().length > 0;

  async function onEscanear(codigo: string) {
    setMostrarCamara(false);
    try {
      const data = await validarKitRetorno(codigo);
      if (data.yaVerificado) {
        Alert.alert('Kit ya verificado', `El kit ${data.codigoUnico} ya fue verificado al retorno.`);
        return;
      }
      setKit(data);
      setItems(data.items);
      setObservaciones('');
    } catch (e: any) {
      Alert.alert(
        'Kit inválido',
        e?.response?.data?.message ?? 'No se pudo validar el código. Verifica e intenta de nuevo.',
      );
    }
  }

  function toggleItem(index: number) {
    setItems((prev) =>
      prev.map((it, i) => (i === index ? { ...it, marcado: !it.marcado } : it)),
    );
  }

  async function confirmar() {
    if (!kit || !puedeConfirmar) return;
    setConfirmando(true);
    try {
      await verificarKitRetorno({
        kitId: kit.id,
        items,
        observaciones: observaciones.trim() || null,
      });
      setVerificados((n) => n + 1);
      setKit(null);
    } catch (e: any) {
      Alert.alert(
        'Error',
        e?.response?.data?.message ?? 'No se pudo registrar la verificación del kit.',
      );
    } finally {
      setConfirmando(false);
    }
  }

  return (
    <View style={styles.container}>
      <AppBar subtitle="Verificación de retorno" />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>Verificación de kits al retorno al DPI</Text>
        <Text style={styles.subtitle}>
          Escanea el QR de cada kit que el operador entrega y confirma que el contenido vuelve
          completo.
        </Text>

        <Pressable style={styles.btnPrimary} onPress={() => setMostrarCamara(true)}>
          <Text style={styles.btnPrimaryText}>Escanear Kit</Text>
        </Pressable>

        <Text style={styles.contador}>
          {verificados} kit{verificados === 1 ? '' : 's'} verificado{verificados === 1 ? '' : 's'} en
          esta sesión
        </Text>
      </ScrollView>

      <Modal visible={mostrarCamara} animationType="slide" presentationStyle="fullScreen">
        <CameraQr onScan={onEscanear} onCancel={() => setMostrarCamara(false)} />
      </Modal>

      <Modal visible={kit != null} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Verificar contenido del kit</Text>
            {kit ? (
              <>
                <Text style={styles.kitOperador}>Operador: {kit.operadorNombre}</Text>
                <Text style={styles.kitCode}>{kit.codigoUnico}</Text>
                <Text style={styles.kitNombre}>{kit.nombre}</Text>

                <View style={styles.checklist}>
                  {items.map((it, index) => (
                    <Pressable key={index} style={styles.itemRow} onPress={() => toggleItem(index)}>
                      <View style={[styles.checkbox, it.marcado && styles.checkboxOn]}>
                        {it.marcado ? <Text style={styles.checkboxMark}>✓</Text> : null}
                      </View>
                      <Text style={styles.itemTexto}>{it.texto}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={[styles.obsLabel, !todosMarcados && styles.obsLabelRequired]}>
                  Observaciones {todosMarcados ? '(opcional)' : '(obligatorio)'}
                </Text>
                <TextInput
                  style={styles.textArea}
                  value={observaciones}
                  onChangeText={setObservaciones}
                  placeholder="Describe qué falta o qué está dañado"
                  placeholderTextColor={colors.textPlaceholder}
                  multiline
                  numberOfLines={3}
                  maxLength={500}
                />
              </>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable style={styles.btnSecondary} onPress={() => setKit(null)} disabled={confirmando}>
                <Text style={styles.btnSecondaryText}>Cancelar</Text>
              </Pressable>
              <Pressable
                style={[styles.btnPrimary, (!puedeConfirmar || confirmando) && styles.btnDisabled]}
                onPress={confirmar}
                disabled={!puedeConfirmar || confirmando}
              >
                {confirmando ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.btnPrimaryText}>Confirmar verificación</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (c: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bgPage },
  body: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 22, fontFamily: fontFamily.bold, color: c.textPrimary },
  subtitle: {
    fontSize: 14,
    fontFamily: fontFamily.regular,
    color: c.textMeta,
    marginTop: 8,
    marginBottom: 20,
    lineHeight: 20,
  },
  contador: {
    fontSize: 13,
    fontFamily: fontFamily.medium,
    color: c.textSecondary,
    textAlign: 'center',
    marginTop: 8,
  },
  btnPrimary: { backgroundColor: c.primary, paddingVertical: 14, borderRadius: 8, marginBottom: 10 },
  btnPrimaryText: { color: '#fff', textAlign: 'center', fontSize: 14, fontFamily: fontFamily.semiBold },
  btnDisabled: { backgroundColor: c.primaryDisabled },
  btnSecondary: {
    flex: 1,
    backgroundColor: c.btnSecondaryBg,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.btnSecondaryBorder,
  },
  btnSecondaryText: { color: c.btnSecondaryText, textAlign: 'center', fontSize: 14, fontFamily: fontFamily.semiBold },
  modalBackdrop: { flex: 1, backgroundColor: c.modalOverlay, alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: c.bgCard, borderRadius: 12, padding: 22, width: '100%', maxWidth: 380 },
  modalTitle: { fontSize: 18, fontFamily: fontFamily.bold, color: c.textPrimary, marginBottom: 4 },
  kitOperador: { fontSize: 13, fontFamily: fontFamily.medium, color: c.textSecondary, marginTop: 8 },
  kitCode: { fontSize: 18, fontFamily: fontFamily.bold, color: c.primary, letterSpacing: 1, marginTop: 6 },
  kitNombre: { fontSize: 16, fontFamily: fontFamily.semiBold, color: c.textPrimary, marginTop: 2, marginBottom: 8 },
  checklist: { marginTop: 4, marginBottom: 8 },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: c.textPlaceholder,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  checkboxOn: { backgroundColor: c.success, borderColor: c.success },
  checkboxMark: { color: '#fff', fontFamily: fontFamily.bold, fontSize: 13 },
  itemTexto: { flex: 1, fontSize: 14, fontFamily: fontFamily.medium, color: c.textPrimary },
  obsLabel: { fontSize: 13, fontFamily: fontFamily.semiBold, color: c.textSecondary, marginTop: 6, marginBottom: 6 },
  obsLabelRequired: { color: c.error },
  textArea: {
    borderWidth: 1,
    borderColor: c.borderInput,
    backgroundColor: c.bgPage,
    color: c.textPrimary,
    padding: 12,
    borderRadius: 6,
    marginBottom: 14,
    fontSize: 14,
    fontFamily: fontFamily.regular,
    textAlignVertical: 'top',
    minHeight: 70,
  },
  modalActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
});
