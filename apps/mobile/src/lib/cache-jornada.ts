import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MiAsignacionResponse } from '@cne/shared-types';
import type { OperadorEtapa } from './etapa-operador';
import { limpiarFotosMilitar } from './offline-foto-militar';
import { vaciarCola } from './offline-queue';

/**
 * Copia local de la jornada del operador para trabajar sin señal (recintos
 * rurales como Apuela): la última asignación descargada y la etapa alcanzada.
 *
 * No guarda tokens ni contraseñas (eso vive en SecureStore). Sí guarda datos
 * personales del militar asignado (nombre y cédula) en el almacenamiento
 * privado de la app: es el mismo dato que la pantalla muestra y hace falta
 * offline; SecureStore no sirve por su límite de tamaño en Android.
 *
 * La copia pertenece a un operador: al iniciar sesión con otro usuario se
 * descarta (ver prepararCacheParaUsuario), y un cierre de sesión explícito la
 * borra, igual que el verificador de login offline.
 */
const ASIGNACION_KEY = 'cne:jornada:asignacion';
const ETAPA_KEY = 'cne:jornada:etapa';
const USUARIO_KEY = 'cne:jornada:usuario';
/** Sube si cambia la forma guardada: una copia de otra versión se ignora. */
const VERSION = 1;

export type EtapaGuardada = { eventoId: string; etapa: OperadorEtapa };

type Guardado<T> = { v: number; valor: T };

async function leer<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const guardado = JSON.parse(raw) as Guardado<T>;
    return guardado?.v === VERSION ? guardado.valor : null;
  } catch {
    // Copia corrupta o almacenamiento no disponible: se trata como si no hubiera copia.
    return null;
  }
}

async function escribir<T>(key: string, valor: T): Promise<void> {
  const guardado: Guardado<T> = { v: VERSION, valor };
  await AsyncStorage.setItem(key, JSON.stringify(guardado));
}

// Serializa leer-modificar-guardar de la asignación: dos registros seguidos
// (p. ej. dos kits escaneados) no deben pisarse el parche.
let candado: Promise<unknown> = Promise.resolve();
function conCandado<T>(fn: () => Promise<T>): Promise<T> {
  const resultado = candado.then(fn);
  candado = resultado.catch(() => undefined);
  return resultado;
}

export function guardarAsignacion(data: MiAsignacionResponse): Promise<void> {
  return conCandado(() => escribir(ASIGNACION_KEY, data));
}

export function leerAsignacion(): Promise<MiAsignacionResponse | null> {
  return leer<MiAsignacionResponse>(ASIGNACION_KEY);
}

/**
 * Refleja en la copia un registro hecho en el celular (enviado o en la cola
 * offline), para que al reabrir sin señal la pantalla no ofrezca repetirlo.
 * Best-effort: si no hay copia o falla el almacenamiento, no hace nada.
 */
export function actualizarCopia(cambio: (a: MiAsignacionResponse) => MiAsignacionResponse): Promise<void> {
  return conCandado(async () => {
    const actual = await leer<MiAsignacionResponse>(ASIGNACION_KEY);
    if (actual) await escribir(ASIGNACION_KEY, cambio(actual));
  }).catch(() => {});
}

export function guardarEtapa(eventoId: string, etapa: OperadorEtapa): Promise<void> {
  return escribir<EtapaGuardada>(ETAPA_KEY, { eventoId, etapa });
}

export function leerEtapa(): Promise<EtapaGuardada | null> {
  return leer<EtapaGuardada>(ETAPA_KEY);
}

/** Al iniciar sesión: conserva la copia si es del mismo operador; si no, la descarta. */
export async function prepararCacheParaUsuario(usuarioId: string): Promise<void> {
  const dueno = await AsyncStorage.getItem(USUARIO_KEY).catch(() => null);
  if (dueno !== usuarioId) await limpiarCacheJornada();
  await AsyncStorage.setItem(USUARIO_KEY, usuarioId);
}

export function limpiarCacheJornada(): Promise<void> {
  return conCandado(async () => {
    await Promise.all([
      AsyncStorage.removeItem(ASIGNACION_KEY),
      AsyncStorage.removeItem(ETAPA_KEY),
      AsyncStorage.removeItem(USUARIO_KEY),
      // La cola y la foto del militar guardadas sin señal son del operador
      // anterior: no deben enviarse con la sesión de otro.
      vaciarCola().catch(() => undefined),
      limpiarFotosMilitar().catch(() => undefined),
    ]);
  });
}
