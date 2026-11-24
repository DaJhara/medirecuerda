// Rutas de cuentas: /auth/register, /auth/login, /auth/google, /auth/forgot-password,
// /auth/reset-password, /auth/change-password y /auth/me.
import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { query } from '../db.js';
import { config } from '../config.js';
import { sendMail } from '../services.js';
import { signToken, requireUser, authLimit } from '../middleware/security.js';

const router = Router();
router.use(authLimit);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = 8;
const RESET_MINUTES = 15;
const RESET_MAX_ATTEMPTS = 5;

const bad = (res, status, error) => res.status(status).json({ error });
const clean = (v) => String(v ?? '').trim();
const normEmail = (v) => clean(v).toLowerCase();
const hashCode = (code) => crypto.createHash('sha256').update(`${config.jwtSecret}:${code}`).digest('hex');

// Datos del usuario que se devuelven a la app (nunca el hash).
const publicUser = (u) => ({
  id: u.id, email: u.email, provider: u.auth_provider, name: u.display_name || '', photoUrl: u.photo_url || null,
});
const session = (u) => ({ token: signToken(u), user: publicUser(u) });

// Evita que un servidor lento delate si el correo existe: siempre se hace un bcrypt.
const DUMMY_HASH = bcrypt.hashSync('no-existe', 10);

// ---- Registro con correo y contraseña ----
router.post('/register', async (req, res, next) => {
  try {
    const email = normEmail(req.body?.email);
    const name = clean(req.body?.name);
    const password = String(req.body?.password ?? '');
    if (!name) return bad(res, 400, 'Escribe tu nombre completo.');
    if (!EMAIL_RE.test(email)) return bad(res, 400, 'Escribe un correo válido.');
    if (password.length < MIN_PASSWORD) return bad(res, 400, `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
    if (password.length > 200) return bad(res, 400, 'La contraseña es demasiado larga.');

    if ((await query('SELECT 1 FROM app_users WHERE lower(email) = $1', [email])).rowCount) {
      return bad(res, 409, 'Ya existe una cuenta con ese correo.');
    }
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      `INSERT INTO app_users (email, auth_provider, display_name, password_hash)
       VALUES ($1, 'password', $2, $3) RETURNING *`, [email, name, hash]);
    res.status(201).json(session(rows[0]));
  } catch (e) {
    if (e.code === '23505') return bad(res, 409, 'Ya existe una cuenta con ese correo.'); // carrera entre dos registros
    next(e);
  }
});

// ---- Inicio de sesión ----
router.post('/login', async (req, res, next) => {
  try {
    const email = normEmail(req.body?.email);
    const password = String(req.body?.password ?? '');
    const { rows } = await query('SELECT * FROM app_users WHERE lower(email) = $1', [email]);
    const u = rows[0];
    const ok = await bcrypt.compare(password, u?.password_hash || DUMMY_HASH);
    if (!u || !u.password_hash || !ok) {
      if (u && !u.password_hash && u.auth_provider === 'google') return bad(res, 400, 'Esta cuenta se creó con Google. Usa "Continuar con Google".');
      return bad(res, 401, 'Correo o contraseña incorrectos.');
    }
    res.json(session(u));
  } catch (e) { next(e); }
});

// ---- Google: la app envía el idToken y aquí se VERIFICA con Google ----
let googleClient;
router.post('/google', async (req, res, next) => {
  try {
    if (!config.googleWebClientId) return bad(res, 503, 'El acceso con Google no está configurado en el servidor.');
    const idToken = clean(req.body?.idToken);
    if (!idToken) return bad(res, 400, 'Falta el token de Google.');
    googleClient ||= new OAuth2Client(config.googleWebClientId);
    let p;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken, audience: config.googleWebClientId });
      p = ticket.getPayload();
    } catch {
      return bad(res, 401, 'El token de Google no es válido.');
    }
    if (!p?.sub || !p.email || p.email_verified === false) return bad(res, 401, 'La cuenta de Google no tiene un correo verificado.');
    const email = normEmail(p.email);

    // Busca por Google; si no, por correo (vincula una cuenta existente); si no, crea una.
    let u = (await query('SELECT * FROM app_users WHERE google_sub = $1', [p.sub])).rows[0]
         || (await query('SELECT * FROM app_users WHERE lower(email) = $1', [email])).rows[0];
    if (u) {
      // Nombre y foto de Google solo se copian si el campo está vacío (no pisan lo que editó la persona).
      u = (await query(
        `UPDATE app_users SET google_sub = $2,
           display_name = COALESCE(NULLIF(display_name, ''), $3),
           photo_url = COALESCE(photo_url, $4),
           updated_at = now() WHERE id = $1 RETURNING *`, [u.id, p.sub, p.name || null, p.picture || null])).rows[0];
    } else {
      u = (await query(
        `INSERT INTO app_users (email, auth_provider, google_sub, display_name, photo_url)
         VALUES ($1, 'google', $2, $3, $4) RETURNING *`, [email, p.sub, p.name || null, p.picture || null])).rows[0];
    }
    res.json(session(u));
  } catch (e) { next(e); }
});

// ---- Olvidé mi contraseña, paso 1: envía un código de 6 dígitos al correo ----
// Responde siempre igual para no revelar si el correo existe.
router.post('/forgot-password', async (req, res, next) => {
  try {
    const email = normEmail(req.body?.email);
    if (!EMAIL_RE.test(email)) return bad(res, 400, 'Escribe un correo válido.');
    const u = (await query('SELECT id, email FROM app_users WHERE lower(email) = $1', [email])).rows[0];
    if (u) {
      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      await query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [u.id]); // invalida los anteriores
      await query(
        `INSERT INTO password_resets (user_id, code_hash, expires_at)
         VALUES ($1, $2, now() + make_interval(mins => $3))`, [u.id, hashCode(code), RESET_MINUTES]);
      await sendMail({
        to: u.email,
        subject: 'Tu código para recuperar la contraseña de MediRecuerda',
        text: `Tu código es ${code}. Vence en ${RESET_MINUTES} minutos. Si no lo pediste, ignora este mensaje.`,
      }).catch((e) => console.error('No se pudo enviar el correo:', e.message));
    }
    res.json({ ok: true, message: 'Si el correo está registrado, te enviamos un código.' });
  } catch (e) { next(e); }
});

// ---- Olvidé mi contraseña, paso 2: código + contraseña nueva ----
router.post('/reset-password', async (req, res, next) => {
  try {
    const email = normEmail(req.body?.email);
    const code = clean(req.body?.code);
    const password = String(req.body?.newPassword ?? '');
    if (password.length < MIN_PASSWORD) return bad(res, 400, `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
    const invalid = () => bad(res, 400, 'El código no es válido o ya venció.');

    const u = (await query('SELECT id FROM app_users WHERE lower(email) = $1', [email])).rows[0];
    if (!u) return invalid();
    const r = (await query(
      `SELECT * FROM password_resets WHERE user_id = $1 AND used_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`, [u.id])).rows[0];
    if (!r || r.attempts >= RESET_MAX_ATTEMPTS) return invalid();

    const a = Buffer.from(hashCode(code));
    const b = Buffer.from(r.code_hash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      await query('UPDATE password_resets SET attempts = attempts + 1 WHERE id = $1', [r.id]);
      return invalid();
    }
    await query('UPDATE app_users SET password_hash = $2, auth_provider = CASE WHEN auth_provider = \'local\' THEN \'password\' ELSE auth_provider END, updated_at = now() WHERE id = $1',
      [u.id, await bcrypt.hash(password, 10)]);
    await query('UPDATE password_resets SET used_at = now() WHERE id = $1', [r.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Cambiar contraseña con la sesión iniciada ----
router.post('/change-password', requireUser, async (req, res, next) => {
  try {
    const current = String(req.body?.current ?? '');
    const password = String(req.body?.newPassword ?? '');
    if (password.length < MIN_PASSWORD) return bad(res, 400, `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
    const u = (await query('SELECT * FROM app_users WHERE id = $1', [req.user.id])).rows[0];
    if (!u?.password_hash) return bad(res, 400, 'Tu cuenta usa Google: no tiene contraseña en MediRecuerda.');
    if (!(await bcrypt.compare(current, u.password_hash))) return bad(res, 401, 'La contraseña actual no es correcta.');
    await query('UPDATE app_users SET password_hash = $2, updated_at = now() WHERE id = $1', [u.id, await bcrypt.hash(password, 10)]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Usuario de la sesión ----
router.get('/me', requireUser, async (req, res, next) => {
  try {
    const u = (await query('SELECT * FROM app_users WHERE id = $1', [req.user.id])).rows[0];
    if (!u) return bad(res, 401, 'La sesión ya no es válida.');
    res.json({ user: publicUser(u) });
  } catch (e) { next(e); }
});

export default router;
