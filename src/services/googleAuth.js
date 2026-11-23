// Inicio de sesión con Google (cuenta REAL de Google).
//
// Usa @react-native-google-signin/google-signin, que es un módulo NATIVO:
//   - NO funciona en Expo Go ni en la web; sí en el "development build" (expo-dev-client) y en producción.
//   - Necesita IDs de cliente de OAuth creados en Google Cloud (ver docs/LOGIN_GOOGLE.md).
//
// El módulo se carga con require() dentro de la función para que la app no se caiga
// al abrir si todavía no está instalado o compilado en el dev build.
import { Platform } from 'react-native';

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

// ¿Está configurado el ID de cliente web? (sin él Google no puede devolver el token de identidad)
export const isGoogleConfigured = () => !!WEB_CLIENT_ID;

// Error con código para que la pantalla muestre un mensaje claro.
const fail = (code, message) => Object.assign(new Error(message), { code });

function loadModule() {
  try {
    return require('@react-native-google-signin/google-signin');
  } catch {
    throw fail('NO_MODULE', 'El módulo de Google no está instalado en esta compilación de la app.');
  }
}

// Abre el selector de cuentas de Google. Devuelve { sub, email, name, photoUrl, idToken } o null si el usuario cancela.
export async function signInWithGoogle() {
  if (Platform.OS === 'web') throw fail('WEB', 'El acceso con Google solo está disponible en la app instalada (Android / iPhone).');
  if (!isGoogleConfigured()) throw fail('NOT_CONFIGURED', 'Falta EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID en el archivo .env.');

  const { GoogleSignin, statusCodes } = loadModule();
  GoogleSignin.configure({
    webClientId: WEB_CLIENT_ID,          // genera el idToken (y es el "audience" que valida un servidor)
    iosClientId: IOS_CLIENT_ID || undefined,
    scopes: ['profile', 'email'],
  });

  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const res = await GoogleSignin.signIn();
    // Versiones nuevas devuelven { type, data }; las antiguas devuelven los datos directamente.
    if (res?.type === 'cancelled') return null;
    const data = res?.data ?? res;
    const user = data?.user;
    if (!user?.id || !user?.email) throw fail('NO_USER', 'Google no devolvió los datos de la cuenta.');
    return {
      sub: user.id,
      email: user.email,
      name: user.name || [user.givenName, user.familyName].filter(Boolean).join(' '),
      photoUrl: user.photo || null,
      idToken: data.idToken || null,
    };
  } catch (e) {
    if (e?.code === statusCodes?.SIGN_IN_CANCELLED) return null;
    if (e?.code === statusCodes?.IN_PROGRESS) return null;
    if (e?.code === statusCodes?.PLAY_SERVICES_NOT_AVAILABLE) throw fail('PLAY', 'Los Servicios de Google Play no están disponibles en este dispositivo.');
    if (String(e?.code) === '10' || /DEVELOPER_ERROR/i.test(e?.message || '')) {
      throw fail('DEV_ERROR', 'Google rechazó la configuración (error 10). Revisa el SHA-1 y el nombre de paquete en Google Cloud.');
    }
    throw e.code ? e : fail('GOOGLE', e?.message || 'No se pudo iniciar sesión con Google.');
  }
}

// Cierra la sesión también en Google (para que la próxima vez deje elegir otra cuenta).
export async function signOutGoogle() {
  try {
    const { GoogleSignin } = loadModule();
    await GoogleSignin.signOut();
  } catch {
    /* si el módulo no está disponible no pasa nada */
  }
}
