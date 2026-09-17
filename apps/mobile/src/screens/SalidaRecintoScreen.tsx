import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { MiAsignacionResponse } from '@cne/shared-types';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';
import { AppBar } from '../components/AppBar';
import { CameraFoto } from '../components/CameraFoto';
import { getMiAsignacion } from '../lib/queries/tracking';
import { postSalidaRecinto } from '../lib/queries/retorno';
import { capturarYSubirActa, limpiarActas, reintentarSubidaActa, restaurarActas } from '../lib/offline-actas';
import {
  asegurarServiciosUbicacion,
  iniciarRastreo,
  LocationPermissionDeniedError,
  LocationServicesDisabledError,
  obtenerUbicacionPuntual,
  solicitarPermisoBackground,
} from '../lib/location';
import { fontFamily } from '../theme/typography';

type Paso = 1 | 2;
type TipoActa = 'instalacion' | 'escrutinio';
type Styles = ReturnType<typeof makeStyles>;

interface ActaState {
  uri: string | null;
  url: string | null;
  subiendo: boolean;
  error: string | null;
}

const ACTA_INICIAL: ActaState = { uri: null, url: null, subiendo: false, error: null };

type Props = {
  onSalidaRegistrada: () => void;
};

export function SalidaRecintoScreen({ onSalidaRegistrada }: Props) {
  const { user, logout } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [asignacion, setAsignacion] = useState<MiAsignacionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paso, setPaso] = useState<Paso>(1);

  // Paso 1: actas obligatorias (instalación + escrutinio). A diferencia de
  // fotoMilitarUrl (que se puede resumir desde el servidor), las URLs de las
  // actas solo se graban de forma permanente cuando se confirma la salida del
  // recinto — por eso se persisten localmente (offline-actas.ts) apenas se
  // toman, para sobrevivir si el operador cierra la app antes de subirlas.
  const [instalacion, setInstalacion] = useState<ActaState>(ACTA_INICIAL);
  const [escrutinio, setEscrutinio] = useState<ActaState>(ACTA_INICIAL);
  const [mostrarCamara, setMostrarCamara] = useState<TipoActa | null>(null);

  // Paso 2: checklist de kits + confirmar (ya existente)
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [registrando, setRegistrando] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getMiAsignacion();
      setAsignacion(data);
      if (data.yaRegistroSalidaRecinto) {
        onSalidaRegistrada();
      }
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'No se pudo cargar tu asignación');
    } finally {
      setLoading(false);
    }
  }, [onSalidaRegistrada]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Namespacea la persistencia local de actas por recinto+evento: sin esto,
  // si el operador nunca confirma la salida (cierra sesión, cambia de
  // asignación) y el mismo teléfono se reutiliza, se podrían reusar por error
  // las actas de OTRO recinto/evento sin volver a tomar fotos.
  const contextoId = asignacion ? `${asignacion.eventoId}_${asignacion.recinto.id}` : null;

  const aplicarResultadoActa = useCallback(
    (tipo: TipoActa, resultado: { uri: string; url: string | null; error: string | null }) => {
      const setState = tipo === 'instalacion' ? setInstalacion : setEscrutinio;
      setState({ uri: resultado.uri, url: resultado.url, subiendo: false, error: resultado.error });
    },
    [],
  );

  const marcarSubiendo = useCallback((tipo: TipoActa, uri: string) => {
    const setState = tipo === 'instalacion' ? setInstalacion : setEscrutinio;
    setState({ uri, url: null, subiendo: true, error: null });
  }, []);

  // Al montar (y en cuanto se conoce el recinto/evento activo), restaura
  // cualquier acta que haya quedado pendiente de una sesión anterior para
  // ESTA MISMA asignación (la app se cerró antes de terminar de subirla) y
  // reintenta automáticamente las que aún no tengan url confirmada.
  useEffect(() => {
    if (!contextoId) return;
    (async () => {
      const registro = await restaurarActas(contextoId);
      for (const tipo of ['instalacion', 'escrutinio'] as TipoActa[]) {
        const entry = registro[tipo];
        if (!entry) continue;
        if (entry.url) {
          aplicarResultadoActa(tipo, { uri: entry.uri, url: entry.url, error: null });
          continue;
        }
        marcarSubiendo(tipo, entry.uri);
        try {
          const resultado = await reintentarSubidaActa(contextoId, tipo);
          if (resultado) aplicarResultadoActa(tipo, resultado);
          else aplicarResultadoActa(tipo, { uri: entry.uri, url: null, error: null });
        } catch {
          aplicarResultadoActa(tipo, {
            uri: entry.uri,
            url: null,
            error: 'No se pudo reanudar la subida. Intenta de nuevo.',
          });
        }
      }
    })();
  }, [contextoId, aplicarResultadoActa, marcarSubiendo]);

  const capturar = useCallback(
    async (tipo: TipoActa, uriCamara: string) => {
      if (!contextoId) return;
      marcarSubiendo(tipo, uriCamara);
      try {
        const resultado = await capturarYSubirActa(contextoId, tipo, uriCamara);
        aplicarResultadoActa(tipo, resultado);
      } catch {
        // capturarYSubirActa está diseñada para no rechazar nunca, pero esta
        // red de seguridad evita que el acta quede "subiendo" para siempre
        // si algo inesperado igual se escapa.
        aplicarResultadoActa(tipo, {
          uri: uriCamara,
          url: null,
          error: 'No se pudo procesar la foto. Intenta de nuevo.',
        });
      }
    },
    [contextoId, marcarSubiendo, aplicarResultadoActa],
  );

  const reintentar = useCallback(
    async (tipo: TipoActa) => {
      if (!contextoId) return;
      const actual = tipo === 'instalacion' ? instalacion : escrutinio;
      if (!actual.uri) return;
      marcarSubiendo(tipo, actual.uri);
      try {
        const resultado = await reintentarSubidaActa(contextoId, tipo);
        if (resultado) aplicarResultadoActa(tipo, resultado);
        else aplicarResultadoActa(tipo, { uri: actual.uri, url: null, error: null });
      } catch {
        aplicarResultadoActa(tipo, {
          uri: actual.uri,
          url: null,
          error: 'No se pudo subir la foto. Verifica tu conexión e intenta de nuevo.',
        });
      }
    },
    [contextoId, instalacion, escrutinio, marcarSubiendo, aplicarResultadoActa],
  );

  function onFotoCapturada(uri: string) {
    const tipo = mostrarCamara;
    setMostrarCamara(null);
    if (tipo) capturar(tipo, uri);
  }

  // Reintento automático mientras la app sigue abierta: si el operador se
  // quedó sin señal, apenas la recupere (o vuelva de segundo plano) se
  // reintentan las actas que quedaron pendientes, sin que tenga que volver a
  // tomarlas ni tocar nada manualmente.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (instalacion.uri && !instalacion.url && !instalacion.subiendo) reintentar('instalacion');
      if (escrutinio.uri && !escrutinio.url && !escrutinio.subiendo) reintentar('escrutinio');
    });
    return () => sub.remove();
  }, [instalacion, escrutinio, reintentar]);

  const ambasActasListas = !!instalacion.url && !!escrutinio.url;

  const kits = asignacion?.kits ?? [];
  const todosMarcados = kits.length > 0 && marcados.size === kits.length;

  function toggleKit(id: string) {
    setMarcados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirmar() {
    Alert.alert(
      'Registrar salida del recinto',
      'Se registrará la salida del recinto y se iniciará el rastreo de tu retorno al DPI. ¿Deseas continuar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Registrar Salida', style: 'default', onPress: ejecutarSalida },
      ],
    );
  }

  async function ejecutarSalida() {
    if (!instalacion.url || !escrutinio.url || !contextoId) return;
    setRegistrando(true);
    try {
      // HU4-CA2: no se permite la acción si los servicios de ubicación están apagados.
      await asegurarServiciosUbicacion();
      const ubicacion = await obtenerUbicacionPuntual();
      const result = await postSalidaRecinto({
        latitud: ubicacion.latitud,
        longitud: ubicacion.longitud,
        ocurridoEn: new Date().toISOString(),
        actaInstalacionUrl: instalacion.url,
        actaEscrutinioUrl: escrutinio.url,
      });

      if (result === null) {
        Alert.alert('Sin señal', 'Salida del recinto guardada localmente. Se sincronizará automáticamente.');
      }

      // Las actas ya quedaron referenciadas en el registro de salida (guardado
      // o encolado); la copia local de las fotos ya no hace falta.
      await limpiarActas(contextoId);

      // HU4-CA3: iniciar rastreo continuo en segundo plano. Es "best-effort":
      // la salida ya quedó registrada (o encolada), así que si esto falla el operador
      // igual debe poder continuar.
      try {
        await solicitarPermisoBackground();
        await iniciarRastreo();
      } catch {
        Alert.alert(
          'Rastreo en segundo plano no disponible',
          'Tu salida quedó registrada, pero no se pudo activar el rastreo de ubicación en segundo plano en este dispositivo.',
        );
      }

      onSalidaRegistrada();
    } catch (e: any) {
      if (e instanceof LocationServicesDisabledError) {
        Alert.alert(
          'Activa la ubicación',
          'Debes activar los servicios de ubicación del dispositivo para registrar la salida del recinto.',
        );
      } else if (e instanceof LocationPermissionDeniedError) {
        Alert.alert(
          'Permiso de ubicación requerido',
          'Concede el permiso de ubicación para registrar la salida del recinto.',
        );
      } else if (e?.response?.status === 409) {
        Alert.alert('Salida ya registrada', 'Ya habías registrado tu salida del recinto.');
        await limpiarActas(contextoId);
        onSalidaRegistrada();
      } else {
        Alert.alert(
          'Error',
          e?.response?.data?.message ?? 'No se pudo registrar la salida. Intenta de nuevo.',
        );
      }
    } finally {
      setRegistrando(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <AppBar subtitle="Salida del recinto" />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <AppBar subtitle="Salida del recinto" onRefresh={cargar} />
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.btnSecondary} onPress={cargar}>
            <Text style={styles.btnSecondaryText}>Reintentar</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AppBar subtitle="Salida del recinto" onRefresh={cargar} refreshing={loading} />
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={cargar} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        <Text style={styles.title}>Salida del recinto electoral</Text>

        <View style={styles.stepper}>
          <StepBadge n={1} label="Actas obligatorias" active={paso === 1} done={paso > 1} styles={styles} />
          <View style={styles.stepLine} />
          <StepBadge n={2} label="Confirmar salida" active={paso === 2} done={false} styles={styles} />
        </View>

        {paso === 1 ? (
          <PasoActas
            instalacion={instalacion}
            escrutinio={escrutinio}
            onTomarFoto={(tipo) => setMostrarCamara(tipo)}
            onReintentar={reintentar}
            styles={styles}
          />
        ) : (
          <>
            <Text style={styles.subtitle}>
              Hola {user?.nombres}, marca todos tus kits electorales para confirmar que salen
              contigo del recinto.
            </Text>

            <View style={styles.card}>
              {kits.map((k) => {
                const checked = marcados.has(k.id);
                return (
                  <Pressable key={k.id} style={styles.kitRow} onPress={() => toggleKit(k.id)}>
                    <View style={[styles.checkbox, checked && styles.checkboxOn]}>
                      {checked ? <Text style={styles.checkboxMark}>✓</Text> : null}
                    </View>
                    <View style={styles.kitInfo}>
                      <Text style={styles.kitNombre}>{k.nombre}</Text>
                      <Text style={styles.kitCodigo}>{k.codigoUnico}</Text>
                      {k.contenidos ? (
                        <Text style={styles.kitContenidos}>{k.contenidos}</Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.contador}>
              {marcados.size} de {kits.length} kit{kits.length === 1 ? '' : 's'} marcado
              {marcados.size === 1 ? '' : 's'}
            </Text>
          </>
        )}

        {paso === 1 ? (
          <Pressable
            style={[styles.btnPrimary, !ambasActasListas && styles.btnDisabled]}
            disabled={!ambasActasListas}
            onPress={() => setPaso(2)}
          >
            <Text style={styles.btnPrimaryText}>Continuar</Text>
          </Pressable>
        ) : (
          <>
            <Pressable
              style={[styles.btnPrimary, (!todosMarcados || registrando) && styles.btnDisabled]}
              disabled={!todosMarcados || registrando}
              onPress={confirmar}
            >
              {registrando ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnPrimaryText}>Registrar Salida de Recinto Electoral</Text>
              )}
            </Pressable>
            <Pressable style={styles.linkBack} onPress={() => setPaso(1)}>
              <Text style={styles.linkBackText}>← Paso anterior</Text>
            </Pressable>
          </>
        )}

        <Pressable style={styles.btnSecondary} onPress={() => logout()}>
          <Text style={styles.btnSecondaryText}>Cerrar sesión</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={mostrarCamara !== null} animationType="slide" presentationStyle="fullScreen">
        <CameraFoto onCapture={onFotoCapturada} onCancel={() => setMostrarCamara(null)} />
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

function PasoActas({
  instalacion,
  escrutinio,
  onTomarFoto,
  onReintentar,
  styles,
}: {
  instalacion: ActaState;
  escrutinio: ActaState;
  onTomarFoto: (tipo: TipoActa) => void;
  onReintentar: (tipo: TipoActa) => void;
  styles: Styles;
}) {
  return (
    <>
      <Text style={styles.subtitle}>
        Antes de salir del recinto debes subir la foto del acta de instalación y del acta de
        escrutinio. Sin ambas no podrás continuar.
      </Text>
      <ActaCard
        titulo="Acta de instalación"
        estado={instalacion}
        onTomarFoto={() => onTomarFoto('instalacion')}
        onReintentar={() => onReintentar('instalacion')}
        styles={styles}
      />
      <ActaCard
        titulo="Acta de escrutinio"
        estado={escrutinio}
        onTomarFoto={() => onTomarFoto('escrutinio')}
        onReintentar={() => onReintentar('escrutinio')}
        styles={styles}
      />
    </>
  );
}

function ActaCard({
  titulo,
  estado,
  onTomarFoto,
  onReintentar,
  styles,
}: {
  titulo: string;
  estado: ActaState;
  onTomarFoto: () => void;
  onReintentar: () => void;
  styles: Styles;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{titulo}</Text>

      {estado.url ? (
        <View style={styles.fotoConfirm}>
          <View style={styles.fotoConfirmIcon}>
            <Text style={styles.fotoConfirmCheck}>✓</Text>
          </View>
          <Text style={styles.fotoConfirmText}>Foto guardada de forma segura</Text>
        </View>
      ) : estado.uri ? (
        <Image source={{ uri: estado.uri }} style={styles.preview} />
      ) : (
        <View style={styles.previewPlaceholder}>
          <Text style={styles.previewPlaceholderText}>Aún no has tomado la foto</Text>
        </View>
      )}

      {estado.error ? <Text style={styles.actaError}>{estado.error}</Text> : null}

      {estado.url ? (
        <Pressable style={styles.btnSecondary} onPress={onTomarFoto}>
          <Text style={styles.btnSecondaryText}>Reemplazar foto</Text>
        </Pressable>
      ) : estado.error ? (
        <Pressable
          style={[styles.btnPrimary, estado.subiendo && { opacity: 0.6 }]}
          onPress={onReintentar}
          disabled={estado.subiendo}
        >
          <Text style={styles.btnPrimaryText}>
            {estado.subiendo ? 'Reintentando…' : 'Reintentar subida'}
          </Text>
        </Pressable>
      ) : (
        <Pressable
          style={[styles.btnPrimary, estado.subiendo && { opacity: 0.6 }]}
          onPress={onTomarFoto}
          disabled={estado.subiendo}
        >
          <Text style={styles.btnPrimaryText}>{estado.subiendo ? 'Subiendo…' : 'Tomar foto'}</Text>
        </Pressable>
      )}
    </View>
  );
}

const makeStyles = (c: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bgPage },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
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
    borderRadius: 12,
    padding: 8,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardTitle: {
    fontSize: 13,
    fontFamily: fontFamily.semiBold,
    color: c.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    padding: 8,
    paddingBottom: 0,
  },
  kitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: c.textPlaceholder,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxOn: { backgroundColor: c.success, borderColor: c.success },
  checkboxMark: { color: '#fff', fontFamily: fontFamily.bold, fontSize: 14 },
  kitInfo: { flex: 1 },
  kitNombre: { fontSize: 15, fontFamily: fontFamily.semiBold, color: c.textPrimary },
  kitCodigo: { fontSize: 13, fontFamily: fontFamily.regular, color: c.textSecondary, marginTop: 2 },
  kitContenidos: { fontSize: 12, fontFamily: fontFamily.regular, color: c.textPlaceholder, marginTop: 2 },
  contador: {
    fontSize: 13,
    fontFamily: fontFamily.medium,
    color: c.textSecondary,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 16,
  },

  preview: { width: '100%', height: 180, borderRadius: 8, margin: 8, marginTop: 8, backgroundColor: c.border },
  previewPlaceholder: {
    width: 'auto',
    height: 120,
    borderRadius: 8,
    backgroundColor: c.placeholder,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 8,
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
    margin: 8,
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
  actaError: {
    color: c.error,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    marginHorizontal: 8,
    marginBottom: 8,
  },

  btnPrimary: {
    backgroundColor: c.primary,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 8,
    alignItems: 'center',
    margin: 8,
    marginTop: 0,
  },
  btnDisabled: { backgroundColor: c.primaryDisabled },
  btnPrimaryText: { color: '#fff', textAlign: 'center', fontFamily: fontFamily.semiBold, fontSize: 15 },
  btnSecondary: { paddingVertical: 10, paddingHorizontal: 24, alignItems: 'center', marginTop: 12 },
  btnSecondaryText: { color: c.textSecondary, fontFamily: fontFamily.medium },
  linkBack: { alignItems: 'center', marginTop: 6, marginBottom: 4 },
  linkBackText: { color: c.primary, fontFamily: fontFamily.medium, fontSize: 13 },
  errorText: { color: c.error, fontFamily: fontFamily.medium, textAlign: 'center', marginBottom: 16 },
});
