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
import type { EstadoItemKit, ItemChecklist, ValidarKitRetornoResponse } from '@cne/shared-types';
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';
import { AppBar } from '../components/AppBar';
import { CameraQr } from '../components/CameraQr';
import { validarKitRetorno, verificarKitRetorno } from '../lib/queries/retorno';
import { fontFamily } from '../theme/typography';

const ESTADOS: { value: EstadoItemKit; label: string }[] = [
  { value: 'BUENO', label: 'Bueno' },
  { value: 'REGULAR', label: 'Regular' },
  { value: 'MALO', label: 'Malo' },
];

export function VerificacionDpiScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [mostrarCamara, setMostrarCamara] = useState(false);
  const [kit, setKit] = useState<ValidarKitRetornoResponse | null>(null);
  const [items, setItems] = useState<ItemChecklist[]>([]);
  const [observaciones, setObservaciones] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [verificados, setVerificados] = useState(0);
  const [codigoManual, setCodigoManual] = useState('');
  const [validando, setValidando] = useState(false);

  const todosMarcados = items.every((i) => i.marcado);
  const puedeConfirmar = todosMarcados || observaciones.trim().length > 0;

  async function onEscanear(codigo: string) {
    setMostrarCamara(false);
    setValidando(true);
    try {
      const data = await validarKitRetorno(codigo);
      if (data.yaVerificado) {
        Alert.alert('Kit ya verificado', `El kit ${data.codigoUnico} ya fue verificado al retorno.`);
        return;
      }
      setKit(data);
      setItems(data.items);
      setObservaciones('');
      setCodigoManual('');
    } catch (e: any) {
      Alert.alert(
        'Kit inválido',
        e?.response?.data?.message ?? 'No se pudo validar el código. Verifica e intenta de nuevo.',
      );
    } finally {
      setValidando(false);
    }
  }

  function cambiarEstado(index: number, estado: EstadoItemKit) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, estado } : it)));
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

        <Pressable style={styles.btnPrimary} onPress={() => setMostrarCamara(true)} accessibilityRole="button">
          <Text style={styles.btnPrimaryText}>Escanear Kit</Text>
        </Pressable>

        {/* Si el QR está dañado o la cámara falla, el código impreso se escribe a mano. */}
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
            onSubmitEditing={() => codigoManual.trim() && onEscanear(codigoManual.trim())}
          />
          <Pressable
            style={[styles.btnValidar, (!codigoManual.trim() || validando) && styles.btnDisabled]}
            disabled={!codigoManual.trim() || validando}
            onPress={() => onEscanear(codigoManual.trim())}
            accessibilityRole="button"
            accessibilityLabel="Validar código"
            accessibilityState={{ disabled: !codigoManual.trim() || validando }}
          >
            {validando ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Validar</Text>}
          </Pressable>
        </View>

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

                <ScrollView style={styles.checklist}>
                  {items.map((it, index) => (
                    <View key={index} style={styles.item}>
                      <Pressable
                        style={styles.itemRow}
                        onPress={() => toggleItem(index)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: it.marcado }}
                        accessibilityLabel={it.itemId ? `${it.texto}, serie ${it.serie || 'S/N'}` : it.texto}
                      >
                        <View style={[styles.checkbox, it.marcado && styles.checkboxOn]}>
                          {it.marcado ? <Text style={styles.checkboxMark}>✓</Text> : null}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.itemTexto}>{it.texto}</Text>
                          {it.itemId ? <Text style={styles.itemSerie}>Serie: {it.serie || 'S/N'}</Text> : null}
                        </View>
                      </Pressable>
                      {/* Estado con el que vuelve el artículo (solo ítems del catálogo). */}
                      {it.estado ? (
                        <View
                          style={styles.estados}
                          accessibilityRole="radiogroup"
                          accessibilityLabel={`Estado de ${it.texto}`}
                        >
                          {ESTADOS.map((e) => {
                            const activo = it.estado === e.value;
                            return (
                              <Pressable
                                key={e.value}
                                style={[styles.estadoBtn, activo && styles.estadoBtnOn]}
                                onPress={() => cambiarEstado(index, e.value)}
                                accessibilityRole="radio"
                                accessibilityState={{ checked: activo }}
                                accessibilityLabel={`${it.texto}: ${e.label}`}
                              >
                                <Text style={[styles.estadoText, activo && styles.estadoTextOn]}>{e.label}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      ) : null}
                    </View>
                  ))}
                </ScrollView>

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
  btnPrimary: { backgroundColor: c.primaryBg, paddingVertical: 14, borderRadius: 8, marginBottom: 10 },
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
  checklist: { marginTop: 4, marginBottom: 8, maxHeight: 320 },
  item: { paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: c.border },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, minHeight: 44 },
  itemSerie: { fontSize: 12, fontFamily: fontFamily.regular, color: c.textSecondary, marginTop: 2 },
  estados: { flexDirection: 'row', gap: 6, marginLeft: 32, marginBottom: 6 },
  estadoBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: c.borderInput,
    alignItems: 'center',
    justifyContent: 'center',
  },
  estadoBtnOn: { backgroundColor: c.primaryBg, borderColor: c.primaryBg },
  estadoText: { fontSize: 13, fontFamily: fontFamily.medium, color: c.textPrimary },
  estadoTextOn: { color: '#fff' },
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
