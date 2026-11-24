// Servicio de autenticación. Las cuentas se validan en Render y la sesión local
// conserva su propio ID para mantener intactas las relaciones de SQLite.
import * as Crypto from 'expo-crypto';
import * as repo from '../db/repository';
import { api, hasBackend } from './api';
import { signInWithGoogle, signOutGoogle } from './googleAuth';

const ROUNDS = 200;
const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const fail = (code, message) => Object.assign(new Error(message), { code });

async function hashPassword(password, salt) {
  let h = `${salt}:${password}`;
  for (let i = 0; i < ROUNDS; i++) {
    h = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${h}`);
  }
  return h;
}
const newSalt = () => Array.from(Crypto.getRandomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
function safeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function validateEmail(email) {
  return EMAIL_RE.test((email || '').trim()) ? null : 'Escribe un correo válido (ejemplo: nombre@correo.com).';
}
export function validatePassword(password) {
  return (password || '').length >= MIN_PASSWORD ? null : `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`;
}

// La identidad visible y los datos médicos siguen residiendo en SQLite.
export const getSession = () => repo.getSessionUser();

async function saveServerSession(data) {
  if (!data?.token || !data?.user) throw fail('SERVER_RESPONSE', 'El servidor no devolvió una sesión válida.');
  return repo.linkRemoteAccount({ user: data.user, token: data.token });
}

export async function register({ name, email, password }) {
  if (!name?.trim()) throw fail('NAME', 'Escribe tu nombre completo.');
  const e = validateEmail(email) || validatePassword(password);
  if (e) throw fail('INVALID', e);
  if (hasBackend()) {
    const data = await api('/auth/register', { method: 'POST', body: { name: name.trim(), email: email.trim().toLowerCase(), password } });
    return saveServerSession(data);
  }
  const salt = newSalt();
  const hash = await hashPassword(password, salt);
  return repo.createPasswordAccount({ email, name, hash, salt });
}

export async function login({ email, password }) {
  const e = validateEmail(email);
  if (e) throw fail('INVALID', e);
  if (!password) throw fail('INVALID', 'Escribe tu contraseña.');

  if (hasBackend()) {
    try {
      const data = await api('/auth/login', { method: 'POST', body: { email: email.trim().toLowerCase(), password } });
      return await saveServerSession(data);
    } catch (serverError) {
      // Migración transparente de cuentas antiguas: si la contraseña coincide con
      // la credencial local, intenta crear la cuenta remota con la misma contraseña.
      const acc = await repo.findAccount(email);
      if (!acc?.hash || !safeEqual(await hashPassword(password, acc.salt), acc.hash)) throw serverError;
      try {
        const created = await api('/auth/register', {
          method: 'POST', body: { name: acc.name || 'Usuario', email: email.trim().toLowerCase(), password },
        });
        return await saveServerSession(created);
      } catch (migrationError) {
        // Si el servidor dice que el correo ya existe, no sobrescribimos su contraseña.
        if (/ya existe|already exists/i.test(migrationError.message || '')) throw serverError;
        // Si no hay conexión con Render, se permite entrar localmente sin token remoto.
        if (/no se pudo conectar|tardó demasiado/i.test(migrationError.message || '')) return repo.startSession(acc.id);
        throw migrationError;
      }
    }
  }

  const acc = await repo.findAccount(email);
  const bad = fail('BAD_CREDENTIALS', 'Correo o contraseña incorrectos.');
  if (!acc) throw bad;
  if (!acc.hash) throw fail('USE_GOOGLE', 'Esta cuenta se creó con Google. Usa el botón "Continuar con Google".');
  if (!safeEqual(await hashPassword(password, acc.salt), acc.hash)) throw bad;
  return repo.startSession(acc.id);
}

// Google permanece como estaba: requiere un development build y que Google esté
// configurado también en Render. No se activa automáticamente en Expo Go.
export async function loginWithGoogle() {
  const g = await signInWithGoogle();
  if (!g) return null;
  // Google en Render sigue pendiente de configuración; mantenemos el flujo local
  // existente para no romperlo hasta completar esa configuración.
  return repo.signInGoogleUser(g);
}

// La recuperación por correo usa el código de 6 dígitos del backend; la pantalla
// se actualizará en el siguiente paso para solicitarlo y enviarlo.
export async function requestPasswordReset({ email }) {
  const e = validateEmail(email);
  if (e) throw fail('INVALID', e);
  return api('/auth/forgot-password', { method: 'POST', body: { email: email.trim().toLowerCase() } });
}

export async function resetPassword({ email, code, newPassword }) {
  const e = validateEmail(email) || validatePassword(newPassword);
  if (e) throw fail('INVALID', e);
  if (hasBackend()) {
    if (!code) throw fail('INVALID', 'Escribe el código de 6 dígitos que recibiste por correo.');
    const result = await api('/auth/reset-password', { method: 'POST', body: { email: email.trim().toLowerCase(), code: String(code).trim(), newPassword } });
    const acc = await repo.findAccount(email);
    if (acc) {
      const salt = newSalt();
      await repo.setPassword(acc.id, await hashPassword(newPassword, salt), salt);
    }
    return result;
  }
  const acc = await repo.findAccount(email);
  if (!acc) throw fail('NOT_FOUND', 'No hay una cuenta con ese correo en este teléfono.');
  if (acc.provider === 'google' && !acc.hash) throw fail('USE_GOOGLE', 'Esta cuenta usa Google: entra con el botón "Continuar con Google".');
  const salt = newSalt();
  await repo.setPassword(acc.id, await hashPassword(newPassword, salt), salt);
}

export async function changePassword({ current, newPassword }) {
  const user = await repo.getSessionUser();
  if (!user) throw fail('NO_SESSION', 'Inicia sesión de nuevo.');
  const e = validatePassword(newPassword);
  if (e) throw fail('INVALID', e);
  if (current === newPassword) throw fail('INVALID', 'La contraseña nueva debe ser distinta de la actual.');
  if (hasBackend()) {
    const token = await repo.getRemoteAuthToken();
    if (!token) throw fail('NO_REMOTE_SESSION', 'Esta sesión todavía no está vinculada al servidor. Cierra sesión e inicia de nuevo con Internet.');
    await api('/auth/change-password', { method: 'POST', body: { current: current || '', newPassword }, token });
  }
  const acc = await repo.findAccount(user.email);
  if (acc) {
    const salt = newSalt();
    await repo.setPassword(acc.id, await hashPassword(newPassword, salt), salt);
  }
}

export async function logout() {
  await repo.signOutUser();
  await repo.clearRemoteAuth();
  await signOutGoogle();
}
