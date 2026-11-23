// Foto de perfil: el usuario elige una imagen de la galería y se reduce a una miniatura cuadrada
// (unos 15-30 KB) guardada como texto "data:image/jpeg;base64,...". Así cabe en SQLite y en Postgres
// sin necesidad de subir archivos.
import * as ImagePicker from 'expo-image-picker';

const MAX_FALLBACK_CHARS = 600000; // tope si no se pudo reducir la imagen (~450 KB)

// Reduce la imagen a 256 px con expo-image-manipulator (soporta su API nueva y la clásica).
async function shrink(uri) {
  const M = require('expo-image-manipulator');
  if (M.ImageManipulator?.manipulate) {
    const ref = await M.ImageManipulator.manipulate(uri).resize({ width: 256 }).renderAsync();
    const out = await ref.saveAsync({ format: M.SaveFormat.JPEG, compress: 0.7, base64: true });
    return out.base64;
  }
  const out = await M.manipulateAsync(uri, [{ resize: { width: 256 } }], { compress: 0.7, format: M.SaveFormat.JPEG, base64: true });
  return out.base64;
}

// Devuelve el texto "data:image/jpeg;base64,..." o null si el usuario cancela. Lanza Error si no se puede usar.
export async function pickProfilePhoto() {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Concede el permiso a tus fotos para elegir una imagen.');

  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true, // recorte cuadrado
    aspect: [1, 1],
    quality: 0.4,
    base64: true,
  });
  if (res.canceled || !res.assets?.[0]) return null;
  const asset = res.assets[0];

  let b64;
  try {
    b64 = await shrink(asset.uri);
  } catch {
    b64 = asset.base64; // sin manipulador de imágenes: se usa la que entrega el selector
  }
  if (!b64 || b64.length > MAX_FALLBACK_CHARS) {
    throw new Error('La imagen es demasiado grande. Elige otra o instala expo-image-manipulator.');
  }
  return `data:image/jpeg;base64,${b64}`;
}
