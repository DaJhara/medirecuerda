// Servicio de autenticación (cuentas en ESTE teléfono).
//
// - Registro / inicio de sesión con correo y contraseña: la contraseña se guarda con sal + SHA-256
//   en la tabla local_credentials. Protege contra curiosos, pero NO equivale a un servidor de
//   autenticación: para cuentas entre dispositivos hace falta un backend (ver docs/DESPLIEGUE.md).
// - Inicio de sesión con Google: ver googleAuth.js (cuenta real de Google).
import * as Crypto from 'expo-crypto';
import * as repo from '../db/repository';
import { signInWithGoogle, signOutGoogle } from './googleAuth';

const ROUNDS = 200;          // repeticiones del hash (cada una es una llamada nativa)
const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const fail = (code, message) => Object.assign(new Error(message), { code });

// Hash con sal: SHA-256 repetido ROUNDS veces.
async function hashPassword(password, salt) {
  let h = `${salt}:${password}`;
  for (let i = 0; i < ROUNDS; i++) {
    h = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${h}`);
  }
  return h;
}

const newSalt = () =>
  Array.from(Crypto.getRandomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');

// Comparación sin cortar al primer carácter distinto.
function safeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Validaciones de formulario (devuelven un texto de error o null).
export function validateEmail(email) {
  return EMAIL_RE.test((email || '').trim()) ? null : 'Escribe un correo válido (ejemplo: nombre@correo.com).';
}
export function validatePassword(password) {
  return (password || '').length >= MIN_PASSWORD ? null : `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`;
}

// Sesión guardada (si el usuario no cerró sesión).
export const getSession = () => repo.getSessionUser();

export async function register({ name, email, password }) {
  if (!name?.trim()) throw fail('NAME', 'Escribe tu nombre completo.');
  const e = validateEmail(email) || validatePassword(password);
  if (e) throw fail('INVALID', e);
  const salt = newSalt();
  const hash = await hashPassword(password, salt);
  return repo.createPasswordAccount({ email, name, hash, salt });
}

export async function login({ email, password }) {
  const e = validateEmail(email);
  if (e) throw fail('INVALID', e);
  if (!password) throw fail('INVALID', 'Escribe tu contraseña.');
  const acc = await repo.findAccount(email);
  // Mensaje genérico: no revela si el correo existe.
  const bad = fail('BAD_CREDENTIALS', 'Correo o contraseña incorrectos.');
  if (!acc) throw bad;
  if (!acc.hash) throw fail('USE_GOOGLE', 'Esta cuenta se creó con Google. Usa el botón "Continuar con Google".');
  const ok = safeEqual(await hashPassword(password, acc.salt), acc.hash);
  if (!ok) throw bad;
  return repo.startSession(acc.id);
}

// Devuelve el usuario, o null si la persona canceló el selector de Google.
export async function loginWithGoogle() {
  const g = await signInWithGoogle();
  if (!g) return null;
  return repo.signInGoogleUser(g);
}

// "Olvidé mi contraseña" (modo local): define una contraseña nueva para la cuenta de este teléfono.
// OJO: sin servidor no hay forma de verificar el correo por e-mail; con el backend (ver backend/README.md)
// este paso pasa a ser un código enviado al correo.
export async function resetPassword({ email, newPassword }) {
  const e = validateEmail(email) || validatePassword(newPassword);
  if (e) throw fail('INVALID', e);
  const acc = await repo.findAccount(email);
  if (!acc) throw fail('NOT_FOUND', 'No hay una cuenta con ese correo en este teléfono.');
  if (acc.provider === 'google' && !acc.hash) throw fail('USE_GOOGLE', 'Esta cuenta usa Google: entra con el botón "Continuar con Google".');
  const salt = newSalt();
  await repo.setPassword(acc.id, await hashPassword(newPassword, salt), salt);
}

// Cambiar contraseña con la sesión iniciada (menú): exige la contraseña actual.
export async function changePassword({ current, newPassword }) {
  const user = await repo.getSessionUser();
  if (!user) throw fail('NO_SESSION', 'Inicia sesión de nuevo.');
  const e = validatePassword(newPassword);
  if (e) throw fail('INVALID', e);
  const acc = await repo.findAccount(user.email);
  if (!acc?.hash) throw fail('USE_GOOGLE', 'Tu cuenta usa Google: no tiene contraseña en MediRecuerda.');
  if (!safeEqual(await hashPassword(current || '', acc.salt), acc.hash)) throw fail('BAD_CREDENTIALS', 'La contraseña actual no es correcta.');
  if (current === newPassword) throw fail('INVALID', 'La contraseña nueva debe ser distinta de la actual.');
  const salt = newSalt();
  await repo.setPassword(acc.id, await hashPassword(newPassword, salt), salt);
}

export async function logout() {
  await repo.signOutUser();
  await signOutGoogle();
}
