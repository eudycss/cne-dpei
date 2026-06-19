import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { EstadoIncidencia, Incidencia, TipoIncidencia } from '@cne/shared-types';
import { misIncidencias, reportarIncidencia } from '../lib/queries/incidencias';
import { obtenerUbicacionPuntual } from '../lib/location';
import { useTheme } from '../theme/ThemeContext';
import { fontFamily } from '../theme/typography';
import { Colors } from '../theme/colors';
import { CameraFoto } from './CameraFoto';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const TIPOS: { value: TipoIncidencia; label: string }[] = [
  { value: 'KIT_DANADO', label: 'Kit dañado' },
  { value: 'KIT_FALTANTE', label: 'Kit faltante' },
  { value: 'PROBLEMA_RECINTO', label: 'Problema en el recinto' },
  { value: 'RETRASO', label: 'Retraso' },
  { value: 'PROBLEMA_SEGURIDAD', label: 'Problema de seguridad' },
  { value: 'OTRO', label: 'Otro' },
];

function formatHora(iso: string): string {
  return new Date(iso).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' });
}

function estadoInfo(estado: EstadoIncidencia, c: Colors): { label: string; color: string } {
  if (estado === 'ATENDIDA') return { label: 'Atendida', color: c.warningText };
  if (estado === 'CERRADA') return { label: 'Cerrada', color: c.successText };
  return { label: 'Abierta', color: c.textSecondary };
}

export function ReportarIncidenciaModal({ visible, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [vista, setVista] = useState<'form' | 'lista'>('form');

  const [tipo, setTipo] = useState<TipoIncidencia | null>(null);
  const [descripcion, setDescripcion] = useState('');
  const [fotoUri, setFotoUri] = useState<string | null>(null);
  const [fotoBase64, setFotoBase64] = useState<string | null>(null);
  const [mostrarCamara, setMostrarCamara] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);

  const [incidencias, setIncidencias] = useState<Incidencia[] | null>(null);
  const [errorLista, setErrorLista] = useState<string | null>(null);

  const cargarLista = () => {
    setErrorLista(null);
    misIncidencias()
      .then((res) => setIncidencias(res.items))
      .catch(() => setErrorLista('No se pudo cargar tu historial de incidencias.'));
  };

  useEffect(() => {
    if (!visible) return;
    cargarLista();
  }, [visible]);

  function limpiarFormulario() {
    setTipo(null);
    setDescripcion('');
    setFotoUri(null);
    setFotoBase64(null);
    setExito(false);
  }

  async function onGuardar() {
    if (!tipo) {
      setError('Selecciona el tipo de incidencia.');
      return;
    }
    setError(null);
    setEnviando(true);
    try {
      let lat: number | undefined;
      let lng: number | undefined;
      try {
        const pos = await obtenerUbicacionPuntual();
        lat = pos.latitud;
        lng = pos.longitud;
      } catch {
        // Ubicación opcional: se reporta igual sin coordenadas si falla.
      }

      await reportarIncidencia({
        tipo,
        descripcion: descripcion.trim() || undefined,
        fotoBase64: fotoBase64 ?? undefined,
        lat,
        lng,
      });
      limpiarFormulario();
      setExito(true);
      cargarLista();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'No se pudo reportar la incidencia. Intenta de nuevo.');
    } finally {
      setEnviando(false);
    }
  }

  if (mostrarCamara) {
    return (
      <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
        <CameraFoto
          onCapture={(uri, base64) => {
            setFotoUri(uri);
            setFotoBase64(base64 ?? null);
            setMostrarCamara(false);
          }}
          onCancel={() => setMostrarCamara(false)}
        />
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Incidencias</Text>

          <View style={styles.tabs}>
            <Pressable style={[styles.tab, vista === 'form' && styles.tabActive]} onPress={() => setVista('form')}>
              <Text style={[styles.tabText, vista === 'form' && styles.tabTextActive]}>Reportar</Text>
            </Pressable>
            <Pressable style={[styles.tab, vista === 'lista' && styles.tabActive]} onPress={() => setVista('lista')}>
              <Text style={[styles.tabText, vista === 'lista' && styles.tabTextActive]}>Mis incidencias</Text>
            </Pressable>
          </View>

          {vista === 'form' ? (
            <ScrollView style={{ maxHeight: '65%' }}>
              {exito && <Text style={styles.exito}>Incidencia reportada correctamente.</Text>}

              <Text style={styles.sectionLabel}>Tipo</Text>
              <View style={styles.chipsWrap}>
                {TIPOS.map((t) => (
                  <Pressable
                    key={t.value}
                    style={[styles.chip, tipo === t.value && styles.chipActive]}
                    onPress={() => setTipo(t.value)}
                  >
                    <Text style={[styles.chipText, tipo === t.value && styles.chipTextActive]}>{t.label}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={[styles.sectionLabel, { marginTop: 14 }]}>Descripción (opcional)</Text>
              <TextInput
                style={styles.textArea}
                multiline
                numberOfLines={3}
                placeholder="Describe lo ocurrido…"
                placeholderTextColor={colors.textPlaceholder}
                value={descripcion}
                onChangeText={setDescripcion}
              />

              <Pressable style={styles.btnSecondary} onPress={() => setMostrarCamara(true)}>
                <Text style={styles.btnSecondaryText}>{fotoUri ? 'Cambiar foto' : 'Agregar foto'}</Text>
              </Pressable>
              {fotoUri && <Text style={styles.muted}>Foto adjuntada.</Text>}

              {error && <Text style={styles.error}>{error}</Text>}

              <Pressable style={[styles.btnPrimary, enviando && { opacity: 0.6 }]} onPress={onGuardar} disabled={enviando}>
                {enviando ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Guardar</Text>}
              </Pressable>
            </ScrollView>
          ) : (
            <ScrollView style={{ maxHeight: '65%' }}>
              {errorLista ? (
                <Text style={styles.error}>{errorLista}</Text>
              ) : !incidencias ? (
                <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
              ) : incidencias.length === 0 ? (
                <Text style={styles.muted}>Todavía no has reportado incidencias.</Text>
              ) : (
                incidencias.map((inc) => {
                  const info = estadoInfo(inc.estado, colors);
                  return (
                    <View key={inc.id} style={styles.incidenciaRow}>
                      <Text style={styles.recintoNombre}>
                        {TIPOS.find((t) => t.value === inc.tipo)?.label ?? inc.tipo}
                      </Text>
                      {inc.descripcion && <Text style={styles.recintoMeta}>{inc.descripcion}</Text>}
                      <View style={styles.row}>
                        <View style={[styles.dot, { backgroundColor: info.color }]} />
                        <Text style={[styles.recintoMeta, { color: info.color }]}>{info.label}</Text>
                        <Text style={styles.recintoMeta}> · {formatHora(inc.reportadoEn)}</Text>
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>
          )}

          <Pressable style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Cerrar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: Colors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: c.modalOverlay, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: c.bgCard, borderRadius: 12, padding: 22, width: '100%', maxWidth: 380 },
  title: { fontSize: 18, fontFamily: fontFamily.bold, color: c.textPrimary, marginBottom: 10 },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center', backgroundColor: c.placeholder },
  tabActive: { backgroundColor: c.primary },
  tabText: { fontSize: 13, fontFamily: fontFamily.medium, color: c.textSecondary },
  tabTextActive: { color: '#fff' },
  sectionLabel: { fontSize: 12, fontFamily: fontFamily.bold, color: c.textSecondary, marginBottom: 6 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: c.borderInput },
  chipActive: { backgroundColor: c.primary, borderColor: c.primary },
  chipText: { fontSize: 12, fontFamily: fontFamily.medium, color: c.textPrimary },
  chipTextActive: { color: '#fff' },
  textArea: {
    borderWidth: 1, borderColor: c.borderInput, borderRadius: 8, padding: 10,
    fontSize: 13, fontFamily: fontFamily.regular, color: c.textPrimary, textAlignVertical: 'top', minHeight: 70,
  },
  btnSecondary: {
    marginTop: 14, alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: 8, borderWidth: 1, borderColor: c.borderInput,
  },
  btnSecondaryText: { fontSize: 13, fontFamily: fontFamily.medium, color: c.textPrimary },
  btnPrimary: { marginTop: 16, backgroundColor: c.primary, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  btnPrimaryText: { color: '#fff', fontFamily: fontFamily.bold, fontSize: 14 },
  muted: { fontSize: 12, fontFamily: fontFamily.regular, color: c.textSecondary, marginTop: 6 },
  exito: { fontSize: 13, fontFamily: fontFamily.medium, color: c.successText, marginBottom: 10 },
  error: { fontSize: 13, fontFamily: fontFamily.regular, color: c.error, marginTop: 10 },
  incidenciaRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border },
  recintoNombre: { fontSize: 14, fontFamily: fontFamily.medium, color: c.textPrimary },
  recintoMeta: { fontSize: 12, fontFamily: fontFamily.regular, color: c.textMeta },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  closeBtn: { marginTop: 18, alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 14 },
  closeBtnText: { fontSize: 14, fontFamily: fontFamily.bold, color: c.primary },
});
