import * as ImagePicker from 'expo-image-picker';

/**
 * Abre la galería para elegir una foto ya tomada (p. ej. el reporte que un
 * compañero envió por WhatsApp cuando el operador ya salió del recinto).
 * Devuelve el uri local o null si el operador cancela. En Android se usa el
 * selector de fotos del sistema, que no requiere permiso de almacenamiento.
 */
export async function elegirFotoDeGaleria(): Promise<string | null> {
  const resultado = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: false,
    quality: 1,
  });
  if (resultado.canceled || !resultado.assets?.length) return null;
  return resultado.assets[0].uri;
}
