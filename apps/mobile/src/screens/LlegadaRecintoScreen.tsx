import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type {
  MiAsignacionKit,
  MiAsignacionResponse,
  ValidarKitResponse,
} from '@cne/shared-types';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';
import { AppBar } from '../components/AppBar';
import { CameraFoto } from '../components/CameraFoto';
import { CameraQr } from '../components/CameraQr';
import { getMiAsignacion } from '../lib/queries/tracking';
import {
  confirmarRecepcionKit,
  registrarLlegadaRecinto,
  subirFotoMilitar,
  validarKit,
} from '../lib/queries/llegada';
import {
  LocationPermissionDeniedError,
  LocationServicesDisabledError,
  obtenerUbicacionPuntual,
} from '../lib/location';
import { fontFamily } from '../theme/typography';

type Paso = 1 | 2 | 3;
type Styles = ReturnType<typeof makeStyles>;

type Props = {
  onLlegadaRegistrada: () => void;
};

export function LlegadaRecintoScreen({ onLlegadaRegistrada }: Props) {
  const { user, logout } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [asignacion, setAsignacion] = useState<MiAsignacionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paso, setPaso] = useState<Paso>(1);

  // Paso 1: foto militar
  const [fotoUri, setFotoUri] = useState<string | null>(null);
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [mostrarCamaraFoto, setMostrarCamaraFoto] = useState(false);
  const [subiendoFoto, setSubiendoFoto] = useState(false);

  // Paso 2: escaneo de kits
  const [kitsRecibidos, setKitsRecibidos] = useState<Set<string>>(new Set());
  const [mostrarCamaraQr, setMostrarCamaraQr] = useState(false);
  const [mostrarIngresoManual, setMostrarIngresoManual] = useState(false);
  const [codigoManual, setCodigoManual] = useState('');
  const [kitPreview, setKitPreview] = useState<ValidarKitResponse | null>(null);
  const [confirmandoKit, setConfirmandoKit] = useState(false);

  // Paso 3: confirmar llegada
  const [registrando, setRegistrando] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getMiAsignacion();
      setAsignacion(data);
      if (data.yaRegistroLlegada) {
        onLlegadaRegistrada();
        return;
      }
      if (data.fotoMilitarUrl) {
        setFotoUrl(data.fotoMilitarUrl);
      }
      const recibidos = new Set(data.kits.filter((k) => k.recibido).map((k) => k.id));
      setKitsRecibidos(recibidos);
      if (data.fotoMilitarUrl && recibidos.size === data.kits.length) setPaso(3);
      else if (data.fotoMilitarUrl) setPaso(2);
      else setPaso(1);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'No se pudo cargar tu asignación');
    } finally {
      setLoading(false);
    }
  }, [onLlegadaRegistrada]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function onFotoCapturada(uri: string) {
    setMostrarCamaraFoto(false);
    setFotoUri(uri);
    setSubiendoFoto(true);
    try {
      const { fotoUrl: url } = await subirFotoMilitar(uri);
      setFotoUrl(url);
      // Una vez subida, el uri local apunta a un archivo temporal del cache de
      // la cámara que puede ser eliminado por el OS; descartamos para que el
      // preview no se vea en negro si el usuario regresa al paso 1.
      setFotoUri(null);
      setPaso(2);
    } catch (e: any) {
      Alert.alert(
        'Error subiendo foto',
        e?.response?.data?.message ?? 'No se pudo subir la foto. Intenta de nuevo.',
      );
      setFotoUri(null);
    } finally {
      setSubiendoFoto(false);
    }
  }

  async function onQrEscaneado(codigo: string) {
    setMostrarCamaraQr(false);
    await validarYPreview(codigo);
  }

  async function onIngresoManualOk() {
    if (!codigoManual.trim()) return;
    setMostrarIngresoManual(false);
    await validarYPreview(codigoManual.trim());
    setCodigoManual('');
  }

  async function validarYPreview(codigo: string) {
    try {
      const kit = await validarKit(codigo);
      if (kit.yaRecibido) {
        Alert.alert('Kit ya recibido', `El kit ${kit.codigoUnico} ya fue confirmado.`);
        return;
      }
      setKitPreview(kit);
    } catch (e: any) {
      Alert.alert(
        'Kit inválido',
        e?.response?.data?.message ?? 'No se pudo validar el código. Verifica e intenta de nuevo.',
      );
    }
  }

  async function confirmarRecepcion() {
    if (!kitPreview || !fotoUrl || !asignacion) return;
    setConfirmandoKit(true);
    try {
      const ubicacion = await obtenerUbicacionPuntual();
      await confirmarRecepcionKit({
        kitId: kitPreview.id,
        fotoMilitarUrl: fotoUrl,
        militarId: asignacion.militar?.id ?? null,
        latitud: ubicacion.latitud,
        longitud: ubicacion.longitud,
      });
      const nuevos = new Set(kitsRecibidos);
      nuevos.add(kitPreview.id);
      setKitsRecibidos(nuevos);
      setKitPreview(null);
      if (asignacion.kits.length === nuevos.size) setPaso(3);
    } catch (e: any) {
      manejarErrorUbicacion(e, 'No se pudo confirmar la recepción del kit.');
    } finally {
      setConfirmandoKit(false);
    }
  }

  async function registrarLlegada() {
    setRegistrando(true);
    try {
      const ubicacion = await obtenerUbicacionPuntual();
      await registrarLlegadaRecinto({
        latitud: ubicacion.latitud,
        longitud: ubicacion.longitud,
        ocurridoEn: new Date().toISOString(),
      });
      onLlegadaRegistrada();
    } catch (e: any) {
      if (e?.response?.status === 409) {
        Alert.alert('Llegada ya registrada', 'Ya registraste tu llegada al recinto.');
        onLlegadaRegistrada();
      } else {
        manejarErrorUbicacion(e, 'No se pudo registrar la llegada al recinto.');
      }
    } finally {
      setRegistrando(false);
    }
  }

  function manejarErrorUbicacion(e: any, fallback: string) {
    if (e instanceof LocationPermissionDeniedError) {
      Alert.alert('Ubicación requerida', 'Concede el permiso de ubicación para continuar.');
    } else if (e instanceof LocationServicesDisabledError) {
      Alert.alert('Activa la ubicación', 'Activa los servicios de ubicación para continuar.');
    } else {
      Alert.alert('Error', e?.response?.data?.message ?? fallback);
    }
  }

  const kitsPendientes = useMemo(
    () => asignacion?.kits.filter((k) => !kitsRecibidos.has(k.id)) ?? [],
    [asignacion, kitsRecibidos],
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <AppBar subtitle="Llegada al recinto" />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Cargando…</Text>
        </View>
      </View>
    );
  }

  if (error || !asignacion) {
    return (
      <View style={styles.container}>
        <AppBar subtitle="Llegada al recinto" onRefresh={cargar} />
        <View style={styles.center}>
          <Text style={styles.errorTitle}>No se pudo cargar tu asignación</Text>
          <Text style={styles.errorMsg}>{error}</Text>
          <Pressable style={styles.btnPrimary} onPress={cargar}>
            <Text style={styles.btnPrimaryText}>Reintentar</Text>
          </Pressable>
          <Pressable style={styles.logoutLink} onPress={() => logout()}>
            <Text style={styles.logoutLinkText}>Cerrar sesión</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AppBar subtitle="Llegada al recinto" onRefresh={cargar} refreshing={loading} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={cargar} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        <Text style={styles.greeting}>Hola {user?.nombres} 👋</Text>
        <View style={styles.stepper}>
          <StepBadge n={1} label="Foto militar" active={paso === 1} done={paso > 1} styles={styles} />
          <View style={styles.stepLine} />
          <StepBadge n={2} label="Escanear kits" active={paso === 2} done={paso > 2} styles={styles} />
          <View style={styles.stepLine} />
          <StepBadge n={3} label="Confirmar" active={paso === 3} done={false} styles={styles} />
        </View>

        {paso === 1 ? (
          <Paso1
            militar={asignacion.militar}
            fotoUri={fotoUri}
            fotoUrl={fotoUrl}
            subiendoFoto={subiendoFoto}
            onTomarFoto={() => setMostrarCamaraFoto(true)}
            styles={styles}
            colors={colors}
          />
        ) : null}

        {paso === 2 ? (
          <Paso2
            kits={asignacion.kits}
            kitsRecibidos={kitsRecibidos}
            kitsPendientes={kitsPendientes}
            onEscanear={() => setMostrarCamaraQr(true)}
            onIngresoManual={() => setMostrarIngresoManual(true)}
            styles={styles}
          />
        ) : null}

        {paso === 3 ? (
          <Paso3
            recintoNombre={asignacion.recinto.nombre}
            cantidadKits={asignacion.kits.length}
            registrando={registrando}
            onConfirmar={registrarLlegada}
            styles={styles}
          />
        ) : null}

        {paso > 1 ? (
          <Pressable style={styles.linkBack} onPress={() => setPaso((p) => (p - 1) as Paso)}>
            <Text style={styles.linkBackText}>← Paso anterior</Text>
          </Pressable>
        ) : null}

        <Pressable style={styles.logoutLink} onPress={() => logout()}>
          <Text style={styles.logoutLinkText}>Cerrar sesión</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={mostrarCamaraFoto} animationType="slide" presentationStyle="fullScreen">
        <CameraFoto onCapture={onFotoCapturada} onCancel={() => setMostrarCamaraFoto(false)} />
      </Modal>

      <Modal visible={mostrarCamaraQr} animationType="slide" presentationStyle="fullScreen">
        <CameraQr onScan={onQrEscaneado} onCancel={() => setMostrarCamaraQr(false)} />
      </Modal>

      <Modal visible={mostrarIngresoManual} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Ingresar código del kit</Text>
            <Text style={styles.modalSubtitle}>
              Escribe el código alfanumérico que aparece debajo del QR.
            </Text>
            <TextInput
              style={styles.input}
              value={codigoManual}
              onChangeText={(t) => setCodigoManual(t.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={40}
              placeholder="Ej. ABCD1234"
            />
            <View style={styles.modalActions}>
              <Pressable
                style={styles.btnSecondary}
                onPress={() => {
                  setMostrarIngresoManual(false);
                  setCodigoManual('');
                }}
              >
                <Text style={styles.btnSecondaryText}>Cancelar</Text>
              </Pressable>
              <Pressable style={styles.btnPrimary} onPress={onIngresoManualOk}>
                <Text style={styles.btnPrimaryText}>Validar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={kitPreview != null} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Kit verificado</Text>
            {kitPreview ? (
              <>
                <Text style={styles.kitPreviewCode}>{kitPreview.codigoUnico}</Text>
                <Text style={styles.kitPreviewName}>{kitPreview.nombre}</Text>
                {kitPreview.contenidos ? (
                  <Text style={styles.kitPreviewContenidos}>{kitPreview.contenidos}</Text>
                ) : null}
              </>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable
                style={styles.btnSecondary}
                onPress={() => setKitPreview(null)}
                disabled={confirmandoKit}
              >
                <Text style={styles.btnSecondaryText}>Cancelar</Text>
              </Pressable>
              <Pressable
                style={[styles.btnPrimary, confirmandoKit && { opacity: 0.6 }]}
                onPress={confirmarRecepcion}
                disabled={confirmandoKit}
              >
                <Text style={styles.btnPrimaryText}>
                  {confirmandoKit ? 'Confirmando…' : 'Confirmar Recepción de Kit Electoral'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function StepBadge({
  n,
  label,
  active,
  done,
  styles,
}: {
  n: number;
  label: string;
  active: boolean;
  done: boolean;
  styles: Styles;
}) {
  return (
    <View style={styles.stepBadgeWrap}>
      <View
        style={[
          styles.stepCircle,
          done ? styles.stepCircleDone : active ? styles.stepCircleActive : styles.stepCircleIdle,
        ]}
      >
        <Text style={styles.stepCircleText}>{done ? '✓' : n}</Text>
      </View>
      <Text style={[styles.stepLabel, active && styles.stepLabelActive]}>{label}</Text>
    </View>
  );
}

function Paso1({
  militar,
  fotoUri,
  fotoUrl,
  subiendoFoto,
  onTomarFoto,
  styles,
  colors,
}: {
  militar: MiAsignacionResponse['militar'];
  fotoUri: string | null;
  fotoUrl: string | null;
  subiendoFoto: boolean;
  onTomarFoto: () => void;
  styles: Styles;
  colors: Colors;
}) {
  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Militar referencial</Text>
        {militar ? (
          <>
            <Text style={styles.militarNombre}>
              {militar.nombres} {militar.apellidos}
            </Text>
            <Text style={styles.recintoMeta}>Cédula: {militar.cedula}</Text>
            <Text style={styles.note}>
              Valida visualmente que esta persona es quien te entrega los kits.
            </Text>
          </>
        ) : (
          <Text style={styles.note}>No hay un militar referencial registrado para tu recinto.</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Evidencia: foto del militar</Text>
        {fotoUri ? (
          <Image source={{ uri: fotoUri }} style={styles.preview} />
        ) : fotoUrl ? (
          <View style={styles.fotoConfirm}>
            <View style={styles.fotoConfirmIcon}>
              <Text style={styles.fotoConfirmCheck}>✓</Text>
            </View>
            <Text style={styles.fotoConfirmText}>Foto guardada de forma segura</Text>
          </View>
        ) : (
          <View style={styles.previewPlaceholder}>
            <Text style={styles.previewPlaceholderText}>Aún no has tomado la foto</Text>
          </View>
        )}
        <Pressable
          style={[styles.btnPrimary, subiendoFoto && { opacity: 0.6 }]}
          onPress={onTomarFoto}
          disabled={subiendoFoto}
        >
          <Text style={styles.btnPrimaryText}>
            {subiendoFoto ? 'Subiendo…' : fotoUrl ? 'Reemplazar foto' : 'Tomar foto del militar'}
          </Text>
        </Pressable>
      </View>
    </>
  );
}

function Paso2({
  kits,
  kitsRecibidos,
  kitsPendientes,
  onEscanear,
  onIngresoManual,
  styles,
}: {
  kits: MiAsignacionKit[];
  kitsRecibidos: Set<string>;
  kitsPendientes: MiAsignacionKit[];
  onEscanear: () => void;
  onIngresoManual: () => void;
  styles: Styles;
}) {
  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Kits que debes recibir</Text>
        {kits.map((kit, idx) => {
          const recibido = kitsRecibidos.has(kit.id);
          return (
            <View
              key={kit.id}
              style={[styles.kitRow, idx === kits.length - 1 && styles.kitRowLast]}
            >
              <View style={styles.kitRowMain}>
                <Text style={styles.kitCode}>{kit.codigoUnico}</Text>
                <Text style={styles.kitNombre}>{kit.nombre}</Text>
              </View>
              <Text style={[styles.kitEstado, recibido ? styles.kitEstadoOk : styles.kitEstadoPend]}>
                {recibido ? '✓ Recibido' : 'Pendiente'}
              </Text>
            </View>
          );
        })}
      </View>
      <Pressable style={styles.btnPrimary} onPress={onEscanear} disabled={kitsPendientes.length === 0}>
        <Text style={styles.btnPrimaryText}>Escanear Kit Electoral</Text>
      </Pressable>
      <Pressable
        style={styles.btnSecondary}
        onPress={onIngresoManual}
        disabled={kitsPendientes.length === 0}
      >
        <Text style={styles.btnSecondaryText}>Ingresar código manualmente</Text>
      </Pressable>
    </>
  );
}

function Paso3({
  recintoNombre,
  cantidadKits,
  registrando,
  onConfirmar,
  styles,
}: {
  recintoNombre: string;
  cantidadKits: number;
  registrando: boolean;
  onConfirmar: () => void;
  styles: Styles;
}) {
  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Resumen</Text>
        <Text style={styles.recintoMeta}>Recinto: {recintoNombre}</Text>
        <Text style={styles.recintoMeta}>Kits confirmados: {cantidadKits}/{cantidadKits}</Text>
        <Text style={styles.recintoMeta}>Foto del militar: ✓</Text>
        <Text style={styles.note}>
          Al confirmar registraremos tu llegada con ubicación GPS y notificaremos a tu
          supervisor y a los administradores.
        </Text>
      </View>
      <Pressable
        style={[styles.btnPrimary, registrando && { opacity: 0.6 }]}
        onPress={onConfirmar}
        disabled={registrando}
      >
        <Text style={styles.btnPrimaryText}>
          {registrando ? 'Registrando…' : 'Confirmar Llegada al Recinto'}
        </Text>
      </Pressable>
    </>
  );
}

const makeStyles = (c: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bgPage },
  scroll: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingText: { marginTop: 12, fontFamily: fontFamily.regular, color: c.textSecondary },
  greeting: { fontSize: 20, fontFamily: fontFamily.bold, color: c.textPrimary, marginBottom: 12 },

  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  stepBadgeWrap: { alignItems: 'center', minWidth: 80 },
  stepCircle: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  stepCircleIdle: { backgroundColor: c.border },
  stepCircleActive: { backgroundColor: c.primary },
  stepCircleDone: { backgroundColor: c.success },
  stepCircleText: { color: '#fff', fontFamily: fontFamily.bold, fontSize: 13 },
  stepLabel: { fontSize: 11, fontFamily: fontFamily.medium, color: c.textSecondary, marginTop: 4, textAlign: 'center' },
  stepLabelActive: { color: c.textPrimary, fontFamily: fontFamily.semiBold },
  stepLine: { flex: 1, height: 2, backgroundColor: c.border, marginHorizontal: -4 },

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
  cardTitle: { fontSize: 13, fontFamily: fontFamily.semiBold, color: c.textSecondary, textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.5 },
  militarNombre: { fontSize: 16, fontFamily: fontFamily.semiBold, color: c.textPrimary },
  recintoMeta: { fontSize: 13, fontFamily: fontFamily.regular, color: c.textMeta, marginTop: 2 },
  note: { fontSize: 12, fontFamily: fontFamily.italic, color: c.textSecondary, marginTop: 8, lineHeight: 18 },

  preview: { width: '100%', height: 220, borderRadius: 8, marginBottom: 10, backgroundColor: c.border },
  previewPlaceholder: {
    width: '100%',
    height: 140,
    borderRadius: 8,
    backgroundColor: c.placeholder,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: c.border,
    borderStyle: 'dashed',
  },
  previewPlaceholderText: { color: c.textPlaceholder, fontFamily: fontFamily.medium, fontSize: 13 },
  fotoConfirm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: c.successBg,
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
  },
  fotoConfirmIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: c.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fotoConfirmCheck: { color: '#fff', fontSize: 18, fontFamily: fontFamily.bold },
  fotoConfirmText: { color: c.successText, fontFamily: fontFamily.semiBold, fontSize: 13, flex: 1 },

  kitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  kitRowLast: { borderBottomWidth: 0 },
  kitRowMain: { flex: 1 },
  kitCode: { fontSize: 12, fontFamily: fontFamily.bold, color: c.primary, letterSpacing: 0.5 },
  kitNombre: { fontSize: 14, fontFamily: fontFamily.medium, color: c.textPrimary, marginTop: 2 },
  kitEstado: { fontSize: 12, fontFamily: fontFamily.semiBold, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  kitEstadoOk: { color: c.successText, backgroundColor: c.successBg },
  kitEstadoPend: { color: c.warningText, backgroundColor: c.warningBg },

  btnPrimary: { backgroundColor: c.primary, paddingVertical: 14, borderRadius: 8, marginBottom: 10 },
  btnPrimaryText: { color: '#fff', textAlign: 'center', fontSize: 14, fontFamily: fontFamily.semiBold },
  btnSecondary: {
    backgroundColor: c.btnSecondaryBg,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: c.btnSecondaryBorder,
  },
  btnSecondaryText: { color: c.btnSecondaryText, textAlign: 'center', fontSize: 14, fontFamily: fontFamily.semiBold },

  linkBack: { alignItems: 'center', marginTop: 6, marginBottom: 4 },
  linkBackText: { color: c.primary, fontFamily: fontFamily.medium, fontSize: 13 },
  logoutLink: { marginTop: 14, alignItems: 'center' },
  logoutLinkText: { color: c.textSecondary, fontFamily: fontFamily.medium, fontSize: 13 },

  errorTitle: { fontSize: 16, fontFamily: fontFamily.semiBold, color: c.textPrimary, textAlign: 'center' },
  errorMsg: { fontSize: 14, fontFamily: fontFamily.regular, color: c.textSecondary, textAlign: 'center', marginTop: 8, marginBottom: 16 },

  modalBackdrop: { flex: 1, backgroundColor: c.modalOverlay, alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: c.bgCard, borderRadius: 12, padding: 22, width: '100%', maxWidth: 380 },
  modalTitle: { fontSize: 18, fontFamily: fontFamily.bold, color: c.textPrimary, marginBottom: 4 },
  modalSubtitle: { fontSize: 13, fontFamily: fontFamily.regular, color: c.textSecondary, marginBottom: 14 },
  input: {
    borderWidth: 1,
    borderColor: c.borderInput,
    backgroundColor: c.bgPage,
    color: c.textPrimary,
    padding: 12,
    borderRadius: 6,
    marginBottom: 14,
    fontSize: 15,
    fontFamily: fontFamily.medium,
    letterSpacing: 1,
  },
  modalActions: { flexDirection: 'row', gap: 8 },
  kitPreviewCode: { fontSize: 18, fontFamily: fontFamily.bold, color: c.primary, letterSpacing: 1, marginTop: 6 },
  kitPreviewName: { fontSize: 16, fontFamily: fontFamily.semiBold, color: c.textPrimary, marginTop: 6 },
  kitPreviewContenidos: { fontSize: 13, fontFamily: fontFamily.regular, color: c.textMeta, marginTop: 4, marginBottom: 8 },
});
