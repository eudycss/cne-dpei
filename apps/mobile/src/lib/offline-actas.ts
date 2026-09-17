import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { subirFotoActa } from './queries/retorno';

/**
 * Persistencia local de las 2 actas obligatorias (instalación/escrutinio) que
 * el operador debe subir antes de registrar la salida del recinto.
 *
 * A diferencia de subirFotoMilitar (que confía en que el uri de caché de la
 * cámara siga vivo mientras la app está abierta), esta cola copia cada foto a
 * un archivo persistente en el almacenamiento interno de la app apenas se
 * toma, para que sobreviva si el operador cierra y reabre la app antes de
 * terminar de subirla (por ejemplo, por falta de señal en el recinto).
 *
 * Todo se namespacea por `contextoId` (eventoId+recintoId de la asignación
 * activa): sin esto, si un operador toma las fotos y nunca confirma la salida
 * (cierra sesión, le reasignan el equipo, u otro evento reutiliza el mismo
 * teléfono), la restauración al montar la pantalla podría reusar por error
 * las actas de OTRO recinto/evento — contaminación de evidencia legal.
 */

export type TipoActa = 'instalacion' | 'escrutinio';

export interface EstadoActaPersistido {
  /** Ruta local persistente del archivo (sirve también como uri para <Image>). */
  uri: string;
  /** URL devuelta por el backend una vez subida; null mientras está pendiente. */
  url: string | null;
}

type Registro = Partial<Record<TipoActa, EstadoActaPersistido>>;

const STORAGE_PREFIX = 'cne:actas_salida_recinto';

function claveAlmacenamiento(contextoId: string): string {
  return `${STORAGE_PREFIX}:${contextoId}`;
}

function directorioActas(contextoId: string): string {
  return `${FileSystem.documentDirectory}actas-salida-recinto/${contextoId}/`;
}

// Serializa todas las lecturas-modificaciones-escrituras del registro: sin
// esto, dos reintentos concurrentes (instalación y escrutinio resolviendo casi
// al mismo tiempo tras volver de background) pueden pisarse entre sí, porque
// cada uno lee el registro completo antes de que el otro haya terminado de
// escribir su actualización.
let colaEscritura: Promise<unknown> = Promise.resolve();

function conLockDeEscritura<T>(fn: () => Promise<T>): Promise<T> {
  const resultado = colaEscritura.then(fn, fn);
  colaEscritura = resultado.catch(() => undefined);
  return resultado;
}

async function leerRegistro(contextoId: string): Promise<Registro> {
  const raw = await AsyncStorage.getItem(claveAlmacenamiento(contextoId));
  return raw ? (JSON.parse(raw) as Registro) : {};
}

async function actualizarRegistro(
  contextoId: string,
  tipo: TipoActa,
  entry: EstadoActaPersistido,
): Promise<void> {
  await conLockDeEscritura(async () => {
    const registro = await leerRegistro(contextoId);
    registro[tipo] = entry;
    await AsyncStorage.setItem(claveAlmacenamiento(contextoId), JSON.stringify(registro));
  });
}

/**
 * Lee el estado persistido de ambas actas de este recinto/evento (llamar al
 * montar la pantalla, para restaurar el progreso si la app se cerró a mitad
 * del paso 1).
 */
export async function restaurarActas(contextoId: string): Promise<Registro> {
  return leerRegistro(contextoId);
}

/**
 * Copia la foto recién tomada (uri volátil de la caché de la cámara) a un
 * archivo persistente y la sube. Nunca rechaza: cualquier falla (copiar el
 * archivo, persistir el registro, subir) se traduce en `{ url: null, error }`
 * para que la pantalla pueda mostrar el error y ofrecer reintentar, en vez de
 * dejar el estado "subiendo" colgado para siempre.
 */
export async function capturarYSubirActa(
  contextoId: string,
  tipo: TipoActa,
  uriCamara: string,
): Promise<{ uri: string; url: string | null; error: string | null }> {
  let uriPersistente = uriCamara;
  try {
    const directorio = directorioActas(contextoId);
    const info = await FileSystem.getInfoAsync(directorio);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(directorio, { intermediates: true });
    }
    const destino = `${directorio}${tipo}.jpg`;
    await FileSystem.copyAsync({ from: uriCamara, to: destino });
    uriPersistente = destino;
  } catch {
    // Si falla la copia a almacenamiento persistente, seguimos con el uri
    // original de la cámara: mismo riesgo que subirFotoMilitar (puede
    // perderse si el OS limpia la caché), pero no bloquea el flujo actual.
  }

  try {
    await actualizarRegistro(contextoId, tipo, { uri: uriPersistente, url: null });
  } catch {
    // Best-effort: si falla persistir, la subida de esta sesión puede
    // completarse igual, solo no sobrevivirá a un reinicio de la app.
  }

  return subirYActualizar(contextoId, tipo, uriPersistente);
}

/** Reintenta subir una acta ya guardada localmente, sin necesidad de retomarla. */
export async function reintentarSubidaActa(
  contextoId: string,
  tipo: TipoActa,
): Promise<{ uri: string; url: string | null; error: string | null } | null> {
  const registro = await leerRegistro(contextoId);
  const entry = registro[tipo];
  if (!entry) return null;
  return subirYActualizar(contextoId, tipo, entry.uri);
}

async function subirYActualizar(
  contextoId: string,
  tipo: TipoActa,
  localUri: string,
): Promise<{ uri: string; url: string | null; error: string | null }> {
  try {
    const { url } = await subirFotoActa(localUri);
    try {
      await actualizarRegistro(contextoId, tipo, { uri: localUri, url });
    } catch {
      // Best-effort: la subida ya se completó del lado del backend aunque no
      // quede constancia local para una futura restauración.
    }
    return { uri: localUri, url, error: null };
  } catch (e: any) {
    return {
      uri: localUri,
      url: null,
      error: e?.response?.data?.message ?? 'No se pudo subir la foto. Verifica tu conexión e intenta de nuevo.',
    };
  }
}

/** Borra los archivos locales y el registro tras confirmar la salida del recinto. */
export async function limpiarActas(contextoId: string): Promise<void> {
  const registro = await leerRegistro(contextoId);
  await Promise.all(
    Object.values(registro).map((entry) =>
      FileSystem.deleteAsync((entry as EstadoActaPersistido).uri, { idempotent: true }),
    ),
  );
  await AsyncStorage.removeItem(claveAlmacenamiento(contextoId));
}
