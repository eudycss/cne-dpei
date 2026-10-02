import { Image } from 'react-native';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

/** Lado más largo de la foto enviada: suficiente para leer un documento o ver un daño. */
export const LADO_MAXIMO_PX = 1600;
/** Calidad JPEG (0-1). Con 1600 px deja la foto en ~200-500 KB. */
export const CALIDAD_JPEG = 0.7;

export interface FotoComprimida {
  uri: string;
  base64: string;
}

function medir(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) =>
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject),
  );
}

/**
 * Redimensiona solo si hace falta para que el lado más largo sea como máximo
 * `ladoMaximo` (sin agrandar fotos pequeñas). Devuelve `null` si no hay que tocarla.
 */
export function redimension(
  width: number,
  height: number,
  ladoMaximo = LADO_MAXIMO_PX,
): { width: number } | { height: number } | null {
  if (Math.max(width, height) <= ladoMaximo) return null;
  return width >= height ? { width: ladoMaximo } : { height: ladoMaximo };
}

/**
 * Prepara una foto de la cámara para enviarla como base64: una foto de un
 * celular actual (4000×3000) pesa varios MB, y por datos móviles con mala
 * señal tarda o falla. Si algo sale mal devuelve `null` y quien llama puede
 * enviar la original (el servidor acepta hasta ~8 MB).
 */
export async function comprimirFoto(uri: string): Promise<FotoComprimida | null> {
  try {
    const { width, height } = await medir(uri);
    const resize = redimension(width, height);
    const resultado = await manipulateAsync(uri, resize ? [{ resize }] : [], {
      compress: CALIDAD_JPEG,
      format: SaveFormat.JPEG,
      base64: true,
    });
    if (!resultado.base64) return null;
    return { uri: resultado.uri, base64: resultado.base64 };
  } catch {
    return null;
  }
}
