// Cliente HTTP del backend (Railway). Si EXPO_PUBLIC_API_URL está vacío, la app trabaja SIN backend
// (llama directo a OpenRouter / Serper con las claves EXPO_PUBLIC_*, solo para pruebas).
// Con el backend configurado, las claves de IA quedan en el servidor y la app no las necesita.
const API_URL = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/+$/, '');
const APP_KEY = process.env.EXPO_PUBLIC_API_KEY || ''; // clave "de la app" (ayuda a filtrar tráfico; no es un secreto real)

export const hasBackend = () => !!API_URL;

// Llama al backend. Lanza Error con mensaje en español listo para mostrar.
export async function api(path, { method = 'GET', body, timeout = 90000, token } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(APP_KEY ? { 'x-app-key': APP_KEY } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('El servicio tardó demasiado. Intenta de nuevo.');
    throw new Error('No se pudo conectar con el servidor. Revisa tu conexión a Internet.');
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await res.json(); } catch { /* respuesta sin cuerpo */ }
  if (!res.ok) {
    if (res.status === 429) throw new Error(data?.error || 'Demasiadas solicitudes. Espera un momento e intenta de nuevo.');
    throw new Error(data?.error || `El servidor respondió con error (${res.status}).`);
  }
  return data;
}
