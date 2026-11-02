import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useCerrarSesion } from '../auth/useCerrarSesion';
import { useTheme } from '../theme/ThemeContext';
import { Colors } from '../theme/colors';
import { AppBar } from '../components/AppBar';
import { CameraFoto } from '../components/CameraFoto';
import { getMiAsignacion } from '../lib/queries/tracking';
import { postSalidaRecinto } from '../lib/queries/retorno';
import {
  capturarYSubirActa,
  limpiarActas,
  reintentarSubidaActa,
  restaurarActas,
  type TipoActa,
} from '../lib/offline-actas';
import { elegirFotoDeGaleria } from '../lib/galeria';
import {
  adjuntarFotoPruebaConexion,
  HORA_INICIO_PRUEBA_CONEXION,
  leerPruebaConexionLocal,
  limpiarPruebaConexion,
  pruebaConexionHabilitada,
  reconciliarPruebaConexion,
  registrarPruebaConexion,
} from '../lib/prueba-conexion';
import {
  activarRastreoSegundoPlano,
  asegurarServiciosUbicacion,
  LocationPermissionDeniedError,
  LocationServicesDisabledError,
  obtenerUbicacionPuntual,
} from '../lib/location';
import { fontFamily } from '../theme/typography';

type Paso = 1 | 2 | 3;
type Styles = ReturnType<typeof makeStyles>;

interface ActaState {
  uri: string | null;
  url: string | null;
  subiendo: boolean;
  error: string | null;
}

const ACTA_INICIAL: ActaState = { uri: null, url: null, subiendo: false, error: null };
const TIPOS_FOTO: TipoActa[] = ['conexion', 'instalacion', 'escrutinio'];
const TITULO_FOTO: Record<TipoActa, string> = {
  conexion: 'Foto de la prueba de conexión',
  instalacion: 'Reporte de instalación',
  escrutinio: 'Reporte de escrutinio',
};
const RELOJ_HORA_PRUEBA_MS = 30_000;

type Props = {
  onSalidaRegistrada: () => void;
};

export function SalidaRecintoScreen({ onSalidaRegistrada }: Props) {
  const { user } = useAuth();
  const cerrarSesion = useCerrarSesion();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [asignacion, setAsignacion] = useState<MiAsignacionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paso, setPaso] = useState<Paso>(1);

  // Paso 1: prueba de conexión (obligatoria en la app). 'registrada' cuando el
  // servidor la tiene pero este teléfono no guardó la hora.
  const [pruebaConexion, setPruebaConexion] = useState<string | null>(null);
  const [registrandoPrueba, setRegistrandoPrueba] = useState(false);
  // Foto de la computadora donde se hizo el test (obligatoria en la app). Se
  // guarda en el teléfono como las actas: si no hay señal se confirma igual y
  // la foto se envía al servidor cuando sube.
  const [fotoConexion, setFotoConexion] = useState<ActaState>(ACTA_INICIAL);
  // Última foto ya enviada con la prueba, para no reenviarla.
  const fotoConexionEnviada = useRef<string | null>(null);
  // Se tomó (o reemplazó) en esta sesión: hay que enviarla aunque el servidor ya tenga una.
  const [fotoConexionNueva, setFotoConexionNueva] = useState(false);
  const pruebaConexionRef = useRef(pruebaConexion);
  pruebaConexionRef.current = pruebaConexion;

  // Paso 2: actas obligatorias (instalación + escrutinio). A diferencia de
  // fotoMilitarUrl (que se puede resumir desde el servidor), las URLs de las
  // actas solo se graban de forma permanente cuando se confirma la salida del
  // recinto — por eso se persisten localmente (offline-actas.ts) apenas se
  // toman, para sobrevivir si el operador cierra la app antes de subirlas.
  const [instalacion, setInstalacion] = useState<ActaState>(ACTA_INICIAL);
  const [escrutinio, setEscrutinio] = useState<ActaState>(ACTA_INICIAL);
  const [mostrarCamara, setMostrarCamara] = useState<TipoActa | null>(null);

  // Paso 3: checklist de kits + confirmar (ya existente)
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
  const pruebaEnServidor = !!asignacion?.yaRegistroPruebaConexion;
  const fotoPruebaEnServidor = !!asignacion?.pruebaConexionConFoto;

  // Si la prueba ya está hecha (en el servidor o guardada en este teléfono sin
  // sincronizar), no se repite: al abrir la pantalla se arranca en el paso de
  // los reportes. Ese salto es solo la primera vez; si luego un refresco trae la
  // prueba del servidor, solo se habilita "Continuar" (no se mueve al operador).
  const saltoInicialHecho = useRef(false);
  useEffect(() => {
    if (!contextoId) return;
    let cancelado = false;
    (async () => {
      let local = await leerPruebaConexionLocal(contextoId);
      if (cancelado) return;
      const primeraVez = !saltoInicialHecho.current;
      saltoInicialHecho.current = true;
      if (primeraVez) {
        // Si el servidor rechazó la prueba que este teléfono dio por hecha, se repite.
        const { rechazada } = await reconciliarPruebaConexion(contextoId, pruebaEnServidor);
        if (cancelado) return;
        if (rechazada) {
          local = null;
          Alert.alert('Repita la prueba de conexión', `El servidor no la aceptó: ${rechazada}`);
        }
      }
      if (!local && !pruebaEnServidor) return;
      setPruebaConexion((actual) => actual ?? local ?? 'registrada');
      if (primeraVez) setPaso((p) => (p === 1 ? 2 : p));
    })();
    return () => {
      cancelado = true;
    };
  }, [contextoId, pruebaEnServidor]);

  // La foto es la prueba: se registra al tomarla (o con "Reintentar registro"
  // si el servidor la rechazó), con la url si ya subió.
  const registrarPrueba = useCallback(
    async (fotoUrl: string | null) => {
      if (!contextoId) return;
      setRegistrandoPrueba(true);
      try {
        setPruebaConexion(await registrarPruebaConexion(contextoId, fotoUrl));
        if (fotoUrl) fotoConexionEnviada.current = fotoUrl;
      } catch (e: any) {
        Alert.alert(
          'No se pudo registrar',
          e?.response?.data?.message ?? 'No se pudo registrar la prueba de conexión. Intenta de nuevo.',
        );
      } finally {
        setRegistrandoPrueba(false);
      }
    },
    [contextoId],
  );

  const setterDe = useCallback(
    (tipo: TipoActa) => (tipo === 'conexion' ? setFotoConexion : tipo === 'instalacion' ? setInstalacion : setEscrutinio),
    [],
  );

  const aplicarResultadoActa = useCallback(
    (tipo: TipoActa, resultado: { uri: string; url: string | null; error: string | null }) => {
      setterDe(tipo)({ uri: resultado.uri, url: resultado.url, subiendo: false, error: resultado.error });
    },
    [setterDe],
  );

  const marcarSubiendo = useCallback(
    (tipo: TipoActa, uri: string) => {
      setterDe(tipo)({ uri, url: null, subiendo: true, error: null });
    },
    [setterDe],
  );

  // La prueba ya está registrada (en el servidor sin foto, o en este teléfono)
  // y la foto ya subió: se envía para que el servidor se la agregue.
  useEffect(() => {
    const url = fotoConexion.url;
    if (!contextoId || !url || !pruebaConexion || (fotoPruebaEnServidor && !fotoConexionNueva)) return;
    if (fotoConexionEnviada.current === url) return;
    fotoConexionEnviada.current = url;
    adjuntarFotoPruebaConexion(contextoId, url).then((ok) => {
      // Si no se envió, se reintenta al registrar la salida.
      if (!ok && fotoConexionEnviada.current === url) fotoConexionEnviada.current = null;
    });
  }, [contextoId, fotoConexion.url, pruebaConexion, fotoPruebaEnServidor, fotoConexionNueva]);

  // Al montar (y en cuanto se conoce el recinto/evento activo), restaura
  // cualquier acta que haya quedado pendiente de una sesión anterior para
  // ESTA MISMA asignación (la app se cerró antes de terminar de subirla) y
  // reintenta automáticamente las que aún no tengan url confirmada.
  useEffect(() => {
    if (!contextoId) return;
    (async () => {
      const registro = await restaurarActas(contextoId);
      for (const tipo of TIPOS_FOTO) {
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
        if (tipo === 'conexion') {
          setFotoConexionNueva(true);
          // La primera foto registra la prueba; un reemplazo (foto equivocada) solo
          // cambia la foto, que el efecto de arriba envía cuando sube.
          if (!pruebaConexionRef.current) await registrarPrueba(resultado.url);
        }
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
    [contextoId, marcarSubiendo, aplicarResultadoActa, registrarPrueba],
  );

  const reintentar = useCallback(
    async (tipo: TipoActa) => {
      if (!contextoId) return;
      const actual = tipo === 'conexion' ? fotoConexion : tipo === 'instalacion' ? instalacion : escrutinio;
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
    [contextoId, fotoConexion, instalacion, escrutinio, marcarSubiendo, aplicarResultadoActa],
  );

  // Para cuando el operador ya no tiene el reporte delante (p. ej. ya salió del
  // recinto y un compañero le envió la foto): misma compresión y subida offline
  // que la foto de la cámara.
  const elegirDeGaleria = useCallback(
    async (tipo: TipoActa) => {
      try {
        const uri = await elegirFotoDeGaleria();
        if (uri) await capturar(tipo, uri);
      } catch {
        Alert.alert('Galería no disponible', 'No se pudo abrir la galería. Intenta tomar la foto con la cámara.');
      }
    },
    [capturar],
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
      if (fotoConexion.uri && !fotoConexion.url && !fotoConexion.subiendo) reintentar('conexion');
      if (instalacion.uri && !instalacion.url && !instalacion.subiendo) reintentar('instalacion');
      if (escrutinio.uri && !escrutinio.url && !escrutinio.subiendo) reintentar('escrutinio');
    });
    return () => sub.remove();
  }, [fotoConexion, instalacion, escrutinio, reintentar]);

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

      // Última oportunidad para la foto de la prueba de conexión que no subió
      // por falta de señal: luego se borra la copia local. Best-effort.
      if (fotoConexion.uri && (!fotoPruebaEnServidor || fotoConexionNueva)) {
        const url =
          fotoConexion.url ?? (await reintentarSubidaActa(contextoId, 'conexion').catch(() => null))?.url ?? null;
        if (url && fotoConexionEnviada.current !== url) await adjuntarFotoPruebaConexion(contextoId, url);
      }

      // Las actas ya quedaron referenciadas en el registro de salida (guardado
      // o encolado); la copia local de las fotos ya no hace falta.
      await limpiarActas(contextoId);
      await limpiarPruebaConexion(contextoId);

      // HU4-CA3: iniciar rastreo continuo en segundo plano. Es "best-effort":
      // la salida ya quedó registrada (o encolada), así que si esto falla o tarda
      // demasiado el operador igual debe poder continuar.
      if ((await activarRastreoSegundoPlano()) === 'fallo') {
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
        await limpiarPruebaConexion(contextoId);
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
          <StepBadge n={1} label="Prueba de conexión" active={paso === 1} done={paso > 1} styles={styles} />
          <View style={styles.stepLine} />
          <StepBadge n={2} label="Reportes obligatorios" active={paso === 2} done={paso > 2} styles={styles} />
          <View style={styles.stepLine} />
          <StepBadge n={3} label="Confirmar salida" active={paso === 3} done={false} styles={styles} />
        </View>

        {paso === 1 ? (
          <PasoConexion
            pruebaConexion={pruebaConexion}
            registrando={registrandoPrueba}
            onReintentarRegistro={() => registrarPrueba(fotoConexion.url)}
            foto={fotoConexion}
            onTomarFoto={() => setMostrarCamara('conexion')}
            onElegirGaleria={() => elegirDeGaleria('conexion')}
            onReintentar={() => reintentar('conexion')}
            styles={styles}
          />
        ) : paso === 2 ? (
          <PasoActas
            instalacion={instalacion}
            escrutinio={escrutinio}
            onTomarFoto={(tipo) => setMostrarCamara(tipo)}
            onElegirGaleria={elegirDeGaleria}
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
                  <Pressable
                    key={k.id}
                    style={styles.kitRow}
                    onPress={() => toggleKit(k.id)}
                    accessibilityRole="checkbox"
                    accessibilityLabel={`${k.nombre}, ${k.codigoUnico}`}
                    accessibilityState={{ checked }}
                  >
                    <View style={[styles.checkbox, checked && styles.checkboxOn]}>
                      {checked ? <Text style={styles.checkboxMark}>✓</Text> : null}
                    </View>
                    <View style={styles.kitInfo}>
                      <Text style={styles.kitNombre}>{k.nombre}</Text>
                      <Text style={styles.kitCodigo}>{k.codigoUnico}</Text>
                      {k.items.length > 0 || k.contenidos ? (
                        <Text style={styles.kitContenidos}>
                          {k.items.length > 0 ? k.items.join(', ') : k.contenidos}
                        </Text>
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
            style={[styles.btnPrimary, !pruebaConexion && styles.btnDisabled]}
            disabled={!pruebaConexion}
            onPress={() => setPaso(2)}
            accessibilityRole="button"
            accessibilityState={{ disabled: !pruebaConexion }}
          >
            <Text style={styles.btnPrimaryText}>Continuar</Text>
          </Pressable>
        ) : paso === 2 ? (
          <>
            <Pressable
              style={[styles.btnPrimary, !ambasActasListas && styles.btnDisabled]}
              disabled={!ambasActasListas}
              onPress={() => setPaso(3)}
            >
              <Text style={styles.btnPrimaryText}>Continuar</Text>
            </Pressable>
            <Pressable style={styles.linkBack} onPress={() => setPaso(1)}>
              <Text style={styles.linkBackText}>← Paso anterior</Text>
            </Pressable>
          </>
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
            <Pressable style={styles.linkBack} onPress={() => setPaso(2)}>
              <Text style={styles.linkBackText}>← Paso anterior</Text>
            </Pressable>
          </>
        )}

        <Pressable style={styles.btnSecondary} onPress={cerrarSesion}>
          <Text style={styles.btnSecondaryText}>Cerrar sesión</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={mostrarCamara !== null} animationType="slide" presentationStyle="fullScreen">
        <CameraFoto
          onCapture={onFotoCapturada}
          onCancel={() => setMostrarCamara(null)}
          titulo={TITULO_FOTO[mostrarCamara ?? 'instalacion']}
        />
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

function horaCorta(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function PasoConexion({
  pruebaConexion,
  registrando,
  onReintentarRegistro,
  foto,
  onTomarFoto,
  onElegirGaleria,
  onReintentar,
  styles,
}: {
  pruebaConexion: string | null;
  registrando: boolean;
  onReintentarRegistro: () => void;
  foto: ActaState;
  onTomarFoto: () => void;
  onElegirGaleria: () => void;
  onReintentar: () => void;
  styles: Styles;
}) {
  // Reloj propio: la cámara se habilita sola al llegar la hora, sin recargar.
  const [habilitada, setHabilitada] = useState(() => pruebaConexionHabilitada());
  useEffect(() => {
    if (habilitada) return;
    const id = setInterval(() => setHabilitada(pruebaConexionHabilitada()), RELOJ_HORA_PRUEBA_MS);
    return () => clearInterval(id);
  }, [habilitada]);

  // Se tomó la foto pero el registro falló (p. ej. el servidor lo rechazó).
  const registroPendiente = !pruebaConexion && !!foto.uri && !foto.subiendo && !registrando;

  return (
    <>
      <Text style={styles.subtitle}>
        Haga el test de conexión en la computadora del recinto y tómele una foto a la pantalla (o
        súbala desde la galería): la foto registra la prueba. Si se equivoca de foto, reemplácela.
      </Text>
      {!pruebaConexion && !habilitada ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{TITULO_FOTO.conexion}</Text>
          <Text style={styles.motivoBloqueo} accessibilityLiveRegion="polite">
            {`Se habilita desde las ${HORA_INICIO_PRUEBA_CONEXION}:00 (hora de Ecuador).`}
          </Text>
        </View>
      ) : (
        <ActaCard
          titulo={TITULO_FOTO.conexion}
          estado={foto}
          onTomarFoto={onTomarFoto}
          onElegirGaleria={onElegirGaleria}
          onReintentar={onReintentar}
          styles={styles}
        />
      )}
      {pruebaConexion ? (
        <View style={styles.card}>
          <View style={styles.fotoConfirm} accessible accessibilityRole="text" accessibilityLiveRegion="polite">
            <View style={styles.fotoConfirmIcon}>
              <Text style={styles.fotoConfirmCheck}>✓</Text>
            </View>
            <Text style={styles.fotoConfirmText}>
              {pruebaConexion === 'registrada'
                ? 'Prueba de conexión registrada'
                : `Prueba de conexión registrada a las ${horaCorta(pruebaConexion)}`}
            </Text>
          </View>
          {foto.uri && !foto.url ? (
            <Text style={styles.motivoBloqueo} accessibilityLiveRegion="polite">
              La foto se enviará cuando haya señal.
            </Text>
          ) : null}
        </View>
      ) : null}
      {registrando ? (
        <Text style={styles.motivoBloqueo} accessibilityLiveRegion="polite">
          Registrando la prueba de conexión…
        </Text>
      ) : registroPendiente ? (
        <Pressable
          style={[styles.btnPrimary, styles.btnConexion]}
          onPress={onReintentarRegistro}
          accessibilityRole="button"
          accessibilityLabel="Reintentar registro de la prueba de conexión"
        >
          <Text style={styles.btnPrimaryText}>Reintentar registro</Text>
        </Pressable>
      ) : null}
    </>
  );
}

function PasoActas({
  instalacion,
  escrutinio,
  onTomarFoto,
  onElegirGaleria,
  onReintentar,
  styles,
}: {
  instalacion: ActaState;
  escrutinio: ActaState;
  onTomarFoto: (tipo: TipoActa) => void;
  onElegirGaleria: (tipo: TipoActa) => void;
  onReintentar: (tipo: TipoActa) => void;
  styles: Styles;
}) {
  return (
    <>
      <Text style={styles.subtitle}>
        Antes de salir del recinto debes subir la foto del reporte de instalación y del reporte de
        escrutinio. Sin ambas no podrás continuar.
      </Text>
      <ActaCard
        titulo="Reporte de instalación"
        estado={instalacion}
        onTomarFoto={() => onTomarFoto('instalacion')}
        onElegirGaleria={() => onElegirGaleria('instalacion')}
        onReintentar={() => onReintentar('instalacion')}
        styles={styles}
      />
      <ActaCard
        titulo="Reporte de escrutinio"
        estado={escrutinio}
        onTomarFoto={() => onTomarFoto('escrutinio')}
        onElegirGaleria={() => onElegirGaleria('escrutinio')}
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
  onElegirGaleria,
  onReintentar,
  styles,
}: {
  titulo: string;
  estado: ActaState;
  onTomarFoto: () => void;
  onElegirGaleria: () => void;
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
        <>
          <Pressable style={styles.btnSecondary} onPress={onTomarFoto}>
            <Text style={styles.btnSecondaryText}>Reemplazar foto</Text>
          </Pressable>
          <BotonGaleria
            titulo={titulo}
            texto="Reemplazar desde la galería"
            onPress={onElegirGaleria}
            styles={styles}
          />
        </>
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

      {!estado.url && !estado.error && !estado.subiendo ? (
        <BotonGaleria titulo={titulo} texto="Elegir de la galería" onPress={onElegirGaleria} styles={styles} />
      ) : null}
    </View>
  );
}

function BotonGaleria({
  titulo,
  texto,
  onPress,
  styles,
}: {
  titulo: string;
  texto: string;
  onPress: () => void;
  styles: Styles;
}) {
  return (
    <Pressable
      style={styles.btnSecondary}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${texto}: ${titulo}`}
    >
      <Text style={styles.btnSecondaryText}>{texto}</Text>
    </Pressable>
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
  stepCircleActive: { backgroundColor: c.primaryBg },
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
    backgroundColor: c.primaryBg,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 8,
    alignItems: 'center',
    margin: 8,
    marginTop: 0,
  },
  btnDisabled: { backgroundColor: c.primaryDisabled },
  // Botón grande (objetivo táctil ≥ 44 px, WCAG 2.5.8) para usar de pie en el recinto.
  btnConexion: { minHeight: 56, justifyContent: 'center', marginTop: 8 },
  motivoBloqueo: {
    color: c.textSecondary,
    fontFamily: fontFamily.medium,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
  },
  btnPrimaryText: { color: '#fff', textAlign: 'center', fontFamily: fontFamily.semiBold, fontSize: 15 },
  btnSecondary: { paddingVertical: 10, paddingHorizontal: 24, alignItems: 'center', marginTop: 12 },
  btnSecondaryText: { color: c.textSecondary, fontFamily: fontFamily.medium },
  linkBack: { alignItems: 'center', marginTop: 6, marginBottom: 4 },
  linkBackText: { color: c.primary, fontFamily: fontFamily.medium, fontSize: 13 },
  errorText: { color: c.error, fontFamily: fontFamily.medium, textAlign: 'center', marginBottom: 16 },
});
