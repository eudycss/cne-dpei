import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import type { RoleName } from '@cne/shared-types';

const OFFLINE_KEY = 'cne.offline_auth';
const VALIDEZ_DIAS = 7;

// Sin backend argon2 disponible en el cliente (y el README ya documenta lo
// frágil que es agregar un módulo nativo de hash a este proyecto), se usa un
// hash SHA-256 encadenado con sal como "estiramiento" ligero: mucho más caro
// de romper que un hash simple, aunque no al nivel de argon2/bcrypt. La
// defensa principal sigue siendo que SecureStore ya cifra esto a nivel de SO
// (Keystore en Android) — esto es una segunda capa, no la única.
const ITERACIONES = 10_000;

interface SessionUserSnapshot {
  id: string;
  email: string;
  nombres: string;
  apellidos: string;
  debeCambiarPwd: boolean;
  roles: RoleName[];
}

interface VerificadorOffline {
  email: string;
  salt: string;
  hash: string;
  guardadoEn: string;
  usuario: SessionUserSnapshot;
}

async function hashConSal(password: string, salt: string): Promise<string> {
  let valor = `${salt}:${password}`;
  for (let i = 0; i < ITERACIONES; i++) {
    valor = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, valor);
  }
  return valor;
}

/**
 * Guarda un verificador local tras un login online exitoso, para permitir
 * reingresar sin conexión hasta VALIDEZ_DIAS después. Solo debe llamarse
 * cuando el usuario NO tiene pendiente un cambio de contraseña obligatorio
 * (si no, el gate de "cambiar contraseña" quedaría sin efecto offline).
 */
export async function guardarVerificadorOffline(
  password: string,
  usuario: SessionUserSnapshot,
): Promise<void> {
  const saltBytes = await Crypto.getRandomBytesAsync(16);
  const salt = Array.from(saltBytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const hash = await hashConSal(password, salt);
  const verificador: VerificadorOffline = {
    email: usuario.email.toLowerCase(),
    salt,
    hash,
    guardadoEn: new Date().toISOString(),
    usuario,
  };
  await SecureStore.setItemAsync(OFFLINE_KEY, JSON.stringify(verificador));
}

export async function limpiarVerificadorOffline(): Promise<void> {
  await SecureStore.deleteItemAsync(OFFLINE_KEY);
}

export type ResultadoLoginOffline =
  | { ok: true; usuario: SessionUserSnapshot }
  | { ok: false; razon: 'sin-verificador' | 'vencido' | 'invalido' };

export async function verificarLoginOffline(
  email: string,
  password: string,
): Promise<ResultadoLoginOffline> {
  const raw = await SecureStore.getItemAsync(OFFLINE_KEY);
  if (!raw) return { ok: false, razon: 'sin-verificador' };

  const verificador = JSON.parse(raw) as VerificadorOffline;
  if (verificador.email !== email.trim().toLowerCase()) {
    return { ok: false, razon: 'invalido' };
  }

  const venceEn = new Date(verificador.guardadoEn).getTime() + VALIDEZ_DIAS * 24 * 60 * 60 * 1000;
  if (Date.now() > venceEn) {
    return { ok: false, razon: 'vencido' };
  }

  const hash = await hashConSal(password, verificador.salt);
  if (hash !== verificador.hash) {
    return { ok: false, razon: 'invalido' };
  }

  return { ok: true, usuario: verificador.usuario };
}
