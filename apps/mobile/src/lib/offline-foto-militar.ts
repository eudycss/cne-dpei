import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FotoMilitarResponse } from '@cne/shared-types';
import { api } from './api';
import { comprimirFoto } from './comprimir-foto';
import { isTransientError } from './errores-red';

/**
 * Foto del militar sin señal (mismo patrón que offline-actas).
 *
 * La foto se copia a un archivo persistente apenas se toma. Si no hay señal,
 * el operador sigue al escaneo de kits con un marcador en lugar de la URL; las
 * recepciones de kit se encolan con ese marcador y, al sincronizar, la cola
 * sube primero la foto y lo reemplaza por la URL real. Así se respeta el
 * orden que exige el servidor: foto → recepción del kit → llegada al recinto.
 *
 * Todo se namespacea por `contextoId` (eventoId_recintoId) para no mezclar la
 * evidencia de otro recinto o evento en el mismo teléfono, y se borra al
 * cambiar de operador o cerrar sesión (limpiarFotosMilitar).
 */

interface RegistroFoto {
  /** Archivo local persistente (único por captura); null una vez subida. */
  uri: string | null;
  /** URL devuelta por el servidor; null mientras está pendiente. */
  url: string | null;
}

const STORAGE_PREFIX = 'cne:foto_militar';
const PREFIJO_MARCADOR = 'pendiente:foto-militar:';
// El contexto termina en la ruta del archivo: solo se aceptan ids simples.
const CONTEXTO_VALIDO = /^[\w-]+$/;

export class FotoMilitarPerdidaError extends Error {
  constructor() {
    super('La foto del militar guardada en el celular ya no existe. Vuelve a tomarla.');
    this.name = 'FotoMilitarPerdidaError';
  }
}

export function marcadorFotoPendiente(contextoId: string): string {
  return `${PREFIJO_MARCADOR}${contextoId}`;
}

export function contextoDeMarcador(marcador: string): string {
  return marcador.slice(PREFIJO_MARCADOR.length);
}

export function esMarcadorFotoPendiente(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.startsWith(PREFIJO_MARCADOR);
}

function clave(contextoId: string): string {
  return `${STORAGE_PREFIX}:${contextoId}`;
}

function directorioFotos(): string {
  return `${FileSystem.documentDirectory}foto-militar/`;
}

let colaEscritura: Promise<unknown> = Promise.resolve();
function conCandado<T>(fn: () => Promise<T>): Promise<T> {
  const resultado = colaEscritura.then(fn, fn);
  colaEscritura = resultado.catch(() => undefined);
  return resultado;
}

async function leer(contextoId: string): Promise<RegistroFoto | null> {
  const raw = await AsyncStorage.getItem(clave(contextoId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RegistroFoto;
  } catch {
    return null;
  }
}

async function guardar(contextoId: string, registro: RegistroFoto): Promise<void> {
  await AsyncStorage.setItem(clave(contextoId), JSON.stringify(registro));
}

/** Sube la foto al almacenamiento cifrado del servidor y devuelve su identificador. */
export async function subirFotoMilitar(uri: string): Promise<FotoMilitarResponse> {
  const form = new FormData();
  // En RN, FormData acepta el objeto { uri, name, type } como blob; los tipos
  // estándar de TS no lo reflejan, por eso el cast a any.
  const filename = uri.split('/').pop() ?? `militar-${Date.now()}.jpg`;
  const match = /\.(\w+)$/.exec(filename);
  const ext = match?.[1]?.toLowerCase() ?? 'jpg';
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  form.append('file', { uri, name: filename, type: mime } as any);

  const { data } = await api.post<FotoMilitarResponse>('/tracking/foto-militar', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    transformRequest: (d) => d,
  });
  return data;
}

/**
 * Estado de la foto de este recinto/evento al reabrir la pantalla: la URL si
 * ya se subió, el marcador si sigue solo en el celular (y el archivo existe),
 * o null si hay que tomarla.
 */
export async function restaurarFotoMilitar(contextoId: string): Promise<string | null> {
  const registro = await leer(contextoId);
  if (registro?.url) return registro.url;
  if (!registro?.uri) return null;
  const info = await FileSystem.getInfoAsync(registro.uri);
  return info.exists ? marcadorFotoPendiente(contextoId) : null;
}

// Una sola subida por archivo: la cola y la confirmación de un kit pueden
// pedir la misma foto a la vez al volver la señal.
const subidasEnCurso = new Map<string, Promise<string>>();

/**
 * Sube la foto pendiente de este contexto (si hace falta) y devuelve su URL.
 * Es lo que usa la cola al sincronizar. Lanza el error de red tal cual (para
 * que la cola reintente después) o FotoMilitarPerdidaError si no hay archivo.
 */
export async function asegurarFotoMilitarSubida(contextoId: string): Promise<string> {
  if (!CONTEXTO_VALIDO.test(contextoId)) throw new FotoMilitarPerdidaError();
  const registro = await leer(contextoId);
  if (registro?.url) return registro.url;
  const uri = registro?.uri;
  if (!uri) throw new FotoMilitarPerdidaError();

  const enCurso = subidasEnCurso.get(uri);
  if (enCurso) return enCurso;
  const subida = subirArchivo(contextoId, uri).finally(() => subidasEnCurso.delete(uri));
  subidasEnCurso.set(uri, subida);
  return subida;
}

async function subirArchivo(contextoId: string, uri: string): Promise<string> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) throw new FotoMilitarPerdidaError();
  const { fotoUrl } = await subirFotoMilitar(uri);
  const vigente = await conCandado(async () => {
    // Si mientras se subía el operador repitió la foto, el registro apunta a
    // otro archivo: no se pisa la foto nueva con la URL de la vieja.
    const actual = await leer(contextoId);
    if (actual?.uri !== uri) return false;
    await guardar(contextoId, { uri: null, url: fotoUrl });
    return true;
  });
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
  // Foto reemplazada a mitad de la subida: se sube (o espera) la vigente.
  return vigente ? fotoUrl : asegurarFotoMilitarSubida(contextoId);
}

/**
 * Guarda la foto recién tomada en el celular e intenta subirla.
 * - Con señal: devuelve la URL real.
 * - Sin señal: devuelve el marcador; el operador puede seguir con los kits.
 * - Error del servidor que no es de red (4xx): lo propaga para mostrarlo.
 */
export async function guardarYSubirFotoMilitar(
  contextoId: string,
  uriCamara: string,
): Promise<{ fotoUrl: string; pendiente: boolean }> {
  if (!CONTEXTO_VALIDO.test(contextoId)) throw new Error('Contexto de foto inválido');
  const directorio = directorioFotos();
  const info = await FileSystem.getInfoAsync(directorio);
  if (!info.exists) await FileSystem.makeDirectoryAsync(directorio, { intermediates: true });
  // Nombre único por captura: repetir la foto nunca sobrescribe un archivo que
  // otra subida todavía está leyendo.
  const destino = `${directorio}${contextoId}_${Date.now()}.jpg`;
  // Reducida (~300 KB): sube más rápido con mala señal. Si no se pudo
  // comprimir, se guarda la original.
  const comprimida = await comprimirFoto(uriCamara);
  if (comprimida) {
    await FileSystem.writeAsStringAsync(destino, comprimida, { encoding: FileSystem.EncodingType.Base64 });
  } else {
    await FileSystem.copyAsync({ from: uriCamara, to: destino });
  }
  const anterior = await conCandado(async () => {
    const previo = await leer(contextoId);
    await guardar(contextoId, { uri: destino, url: null });
    return previo?.uri ?? null;
  });
  // La foto reemplazada ya no se usará; si una subida la está leyendo, esa
  // subida la borra al terminar.
  if (anterior && !subidasEnCurso.has(anterior)) {
    await FileSystem.deleteAsync(anterior, { idempotent: true }).catch(() => undefined);
  }

  try {
    return { fotoUrl: await asegurarFotoMilitarSubida(contextoId), pendiente: false };
  } catch (e) {
    if (isTransientError(e)) return { fotoUrl: marcadorFotoPendiente(contextoId), pendiente: true };
    throw e;
  }
}

/**
 * Reemplaza el marcador de foto pendiente en un payload de la cola por la URL
 * real, subiendo la foto si todavía no se subió. Sin marcador, no hace nada.
 */
export async function resolverFotoMilitarEnPayload<T extends object>(payload: T): Promise<T> {
  const valor = (payload as { fotoMilitarUrl?: unknown }).fotoMilitarUrl;
  if (!esMarcadorFotoPendiente(valor)) return payload;
  const fotoMilitarUrl = await asegurarFotoMilitarSubida(contextoDeMarcador(valor));
  return { ...payload, fotoMilitarUrl };
}

/**
 * Al cerrar sesión o cambiar de operador: borra las fotos del militar
 * guardadas en el celular (datos personales sin cifrar) y sus registros.
 */
export async function limpiarFotosMilitar(): Promise<void> {
  const claves = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(`${STORAGE_PREFIX}:`));
  await Promise.all(claves.map((k) => AsyncStorage.removeItem(k)));
  await FileSystem.deleteAsync(directorioFotos(), { idempotent: true }).catch(() => undefined);
}
