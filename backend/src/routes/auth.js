// Rutas de cuentas: /auth/register, /auth/login, /auth/google, /auth/forgot-password,
// /auth/reset-password, /auth/change-password, /auth/me y DELETE /auth/account.
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

// Valida el correo sin expresiones regulares costosas: una sola "@", texto a ambos lados, un punto en el
// dominio, terminación de 2 o más letras y sin espacios.
function isValidEmail(email) {
  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@') || email.length > 254 || /\s/.test(email)) return false;
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  return dot > 0 && domain.length - dot - 1 >= 2;
}
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
  createdAt: u.created_at, // fecha en que se creó la cuenta (columna created_at de app_users)
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
    if (!isValidEmail(email)) return bad(res, 400, 'Escribe un correo válido.');
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
    if (!u?.password_hash || !ok) {
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
    if (!isValidEmail(email)) return bad(res, 400, 'Escribe un correo válido.');
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

// ---- Eliminar la cuenta ----
// 1) Se envía al correo registrado el historial completo (resumen en el cuerpo y el detalle en un CSV adjunto).
// 2) Solo si el correo salió bien, se borra el usuario; sus medicamentos, tomas y eventos se borran en cascada.
// Si el correo falla, NO se borra nada: así el usuario no pierde su historial.
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const fmtLocal = (d) => (d ? new Date(d).toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: false }) : '');
const STATUS_ES = { taken: 'Tomada', skipped: 'Omitida', pending: 'Sin respuesta' };
const escHtml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function buildHistoryExport(userId) {
  const meds = (await query(
    `SELECT id, name, dose, presentation, frequency_hours, start_at, duration_days, stock_units
     FROM medications WHERE user_id = $1 AND deleted_at IS NULL ORDER BY name`, [userId])).rows;
  const doses = (await query(
    `SELECT m.name, m.dose, d.scheduled_at, d.status, d.action_at, d.on_time, d.snooze_count, d.auto_skipped
     FROM dose_logs d JOIN medications m ON m.id = d.medication_id
     WHERE m.user_id = $1 AND (d.status <> 'pending' OR d.due_at < now())
     ORDER BY d.scheduled_at`, [userId])).rows;

  const header = ['Medicamento', 'Dosis', 'Fecha y hora prevista', 'Estado', 'Hora de registro', 'A tiempo', 'Aplazos', 'Omitida automáticamente'];
  const lines = doses.map((d) => [
    d.name, d.dose, fmtLocal(d.scheduled_at), STATUS_ES[d.status] || d.status, fmtLocal(d.action_at),
    d.on_time == null ? '' : (d.on_time ? 'Sí' : 'No'), d.snooze_count || 0, d.auto_skipped ? 'Sí' : 'No',
  ].map(csvCell).join(','));
  // BOM para que Excel abra bien los acentos.
  const csv = `\uFEFF${header.map(csvCell).join(',')}\n${lines.join('\n')}\n`;

  const taken = doses.filter((d) => d.status === 'taken').length;
  const medRows = meds.map((m) => {
    const mine = doses.filter((d) => d.name === m.name);
    const t = mine.filter((d) => d.status === 'taken').length;
    return `<tr><td>${escHtml(m.name)}</td><td>${escHtml(m.dose)}</td><td>${escHtml(m.presentation || '—')}</td><td>cada ${m.frequency_hours} h</td><td>${t} de ${mine.length}</td></tr>`;
  }).join('');
  return { csv, total: doses.length, taken, medRows, medCount: meds.length };
}

router.delete('/account', requireUser, async (req, res, next) => {
  try {
    const u = (await query('SELECT * FROM app_users WHERE id = $1', [req.user.id])).rows[0];
    if (!u) return bad(res, 404, 'La cuenta ya no existe.');
    if (!u.email) return bad(res, 400, 'La cuenta no tiene un correo al que enviar el historial.');

    const h = await buildHistoryExport(u.id);
    const pct = h.total ? Math.round((h.taken / h.total) * 100) : 0;
    const text = `Hola ${u.display_name || ''},\n\nEliminaste tu cuenta de MediRecuerda. Adjuntamos tu historial de tomas (${h.total} registros, ${pct}% de cumplimiento) en un archivo CSV que puedes abrir con Excel.\n\nTus datos fueron borrados de nuestra base de datos.\n\nMediRecuerda`;
    const html = `<div style="font-family:Arial,sans-serif;color:#1B2B1E"><h2 style="color:#2E7D32">MediRecuerda · Tu historial</h2>
<p>Hola ${escHtml(u.display_name || '')}, eliminaste tu cuenta. Aquí tienes un resumen de tu historial; el detalle completo va en el archivo CSV adjunto.</p>
<p><b>${h.total}</b> registros · <b>${pct}%</b> de cumplimiento (${h.taken} tomas realizadas).</p>
<table cellpadding="6" style="border-collapse:collapse;border:1px solid #D5E3D7"><tr style="background:#2E7D32;color:#fff"><th>Medicamento</th><th>Dosis</th><th>Presentación</th><th>Frecuencia</th><th>Tomadas</th></tr>${h.medRows}</table>
<p style="color:#5F6F63">Tus datos fueron borrados de nuestra base de datos.</p></div>`;

    const sent = await sendMail({
      to: u.email,
      subject: 'MediRecuerda: tu historial y la eliminación de tu cuenta',
      text, html,
      attachments: [{ filename: 'historial-medirecuerda.csv', content: Buffer.from(h.csv, 'utf8').toString('base64') }],
    });
    // En producción el correo es obligatorio; en pruebas (sin proveedor de correo) se permite continuar.
    if (!sent && config.isProd) {
      return bad(res, 502, 'No se pudo enviar tu historial al correo, por eso no se eliminó la cuenta. Intenta de nuevo en un momento.');
    }
    await query('DELETE FROM app_users WHERE id = $1', [u.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
