import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { MiAsignacionRecinto } from '@cne/shared-types';
import { salidaRecintoSchema } from '@cne/shared-validation';
import { textoFaltan } from '../lib/aviso-no-cda';
import { useTheme } from '../theme/ThemeContext';
import { fontFamily } from '../theme/typography';
import { Colors } from '../theme/colors';

const MAX = 500;
const esquemaMotivo = salidaRecintoSchema.shape.justificacionNoCda.unwrap();

/** Mensaje de error del motivo, o null si es válido (mismas reglas que el servidor). */
export function errorJustificacion(texto: string): string | null {
  const r = esquemaMotivo.safeParse(texto);
  return r.success ? null : (r.error.issues[0]?.message ?? 'Motivo no válido');
}

interface Props {
  visible: boolean;
  pendientes: MiAsignacionRecinto[];
  registrando: boolean;
  onConfirmar: (justificacion: string) => void;
  onCancelar: () => void;
}

/**
 * Antes de registrar la salida con NO CDA sin marcar: muestra cuáles faltan y
 * pide el motivo. "Volver" deja marcarlos primero.
 */
export function JustificacionNoCdaModal({ visible, pendientes, registrando, onConfirmar, onCancelar }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [texto, setTexto] = useState('');
  const [tocado, setTocado] = useState(false);

  useEffect(() => {
    if (visible) {
      setTexto('');
      setTocado(false);
    }
  }, [visible]);

  const error = errorJustificacion(texto);
  const mostrarError = tocado && !!error;

  const confirmar = () => {
    setTocado(true);
    if (!error) onConfirmar(texto.trim());
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancelar}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          style={{ width: '100%', maxWidth: 400 }}
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
          keyboardShouldPersistTaps="handled"
        >
        <View style={styles.card} accessibilityViewIsModal>
          <Text style={styles.titulo} accessibilityRole="header">
            {textoFaltan(pendientes.length)} sin marcar
          </Text>
          <Text style={styles.texto}>
            Si ya llegaron, vuelva y márquelos. Si no llegaron, escriba el motivo para registrar la salida.
          </Text>

          <ScrollView style={styles.lista} nestedScrollEnabled>
            {pendientes.map((nc) => (
              <Text key={nc.id} style={styles.item}>
                • {nc.codigoRecinto} · {nc.nombre}
              </Text>
            ))}
          </ScrollView>

          <Text style={styles.label} nativeID="label-justificacion">
            Motivo
          </Text>
          <TextInput
            style={[styles.input, mostrarError && styles.inputError]}
            value={texto}
            onChangeText={setTexto}
            onBlur={() => setTocado(true)}
            placeholder="Ej.: el NO CDA 1917 no llegó; se avisó al técnico"
            placeholderTextColor={colors.textMeta}
            multiline
            maxLength={MAX}
            accessibilityLabel="Motivo de salir sin marcar los NO CDA"
            editable={!registrando}
            autoFocus
          />
          <View style={styles.pie}>
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {mostrarError ? error : ''}
            </Text>
            <Text style={styles.contador}>
              {texto.length}/{MAX}
            </Text>
          </View>

          <Pressable
            style={[styles.btnPrimario, registrando && styles.btnDeshabilitado]}
            onPress={confirmar}
            disabled={registrando}
            accessibilityRole="button"
            accessibilityState={{ disabled: registrando }}
          >
            {registrando ? (
              <ActivityIndicator color="#fff" accessibilityLabel="Registrando salida" />
            ) : (
              <Text style={styles.btnPrimarioTexto}>Registrar salida con este motivo</Text>
            )}
          </Pressable>
          <Pressable style={styles.btnSecundario} onPress={onCancelar} disabled={registrando} accessibilityRole="button">
            <Text style={styles.btnSecundarioTexto}>Volver y marcar los NO CDA</Text>
          </Pressable>
        </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: c.modalOverlay, alignItems: 'center', justifyContent: 'center', padding: 20 },
    card: { backgroundColor: c.bgCard, borderRadius: 12, padding: 20, width: '100%', maxWidth: 400 },
    titulo: { fontSize: 18, fontFamily: fontFamily.bold, color: c.warningText, marginBottom: 6 },
    texto: { fontSize: 14, fontFamily: fontFamily.regular, color: c.textPrimary, marginBottom: 10 },
    lista: { maxHeight: 140, backgroundColor: c.warningBg, borderRadius: 8, padding: 10, marginBottom: 12 },
    item: { fontSize: 13, fontFamily: fontFamily.medium, color: c.textPrimary, marginBottom: 4 },
    label: { fontSize: 13, fontFamily: fontFamily.bold, color: c.textSecondary, marginBottom: 4 },
    input: {
      minHeight: 80,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 8,
      padding: 10,
      fontSize: 14,
      fontFamily: fontFamily.regular,
      color: c.textPrimary,
      textAlignVertical: 'top',
    },
    inputError: { borderColor: c.error },
    pie: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, marginBottom: 12 },
    error: { flex: 1, fontSize: 12, fontFamily: fontFamily.regular, color: c.error },
    contador: { fontSize: 12, fontFamily: fontFamily.regular, color: c.textMeta },
    btnPrimario: { backgroundColor: c.primaryBg, borderRadius: 10, paddingVertical: 14, alignItems: 'center', minHeight: 48 },
    btnDeshabilitado: { opacity: 0.6 },
    btnPrimarioTexto: { color: '#fff', fontSize: 15, fontFamily: fontFamily.bold },
    btnSecundario: { paddingVertical: 12, alignItems: 'center', minHeight: 44 },
    btnSecundarioTexto: { color: c.primary, fontSize: 14, fontFamily: fontFamily.bold },
  });
