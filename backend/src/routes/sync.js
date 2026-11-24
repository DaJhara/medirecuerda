// Sincronización en dos sentidos. La base de datos del servidor es la fuente principal; SQLite del teléfono
// es la copia de trabajo/respaldo cuando no hay conexión.
//   POST /sync/push  teléfono → servidor (cambios hechos con o sin conexión)
//   GET  /sync/pull  servidor → teléfono (lo que cambió desde la última descarga)
// Conflictos: gana el cambio con "updated_at" más reciente (último en escribir); en empate gana el servidor.
// Los IDs de medicamentos, tomas y eventos se conservan. El usuario se obtiene SOLO del JWT.
import { Router } from 'express';
import { getPool, query } from '../db.js';
import { requireUser } from '../middleware/security.js';

const router = Router();
router.use(requireUser);

const bad = (res, status, error) => res.status(status).json({ error });
const arr = (v) => Array.isArray(v) ? v : [];
const validId = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const dateOrNull = (v) => v == null ? null : new Date(v).toISOString();

// Estado remoto para comprobar la sincronización sin exponer datos médicos.
router.get('/status', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT
         (SELECT count(*)::int FROM medications WHERE user_id = $1) AS medications,
         (SELECT count(*)::int FROM dose_logs d JOIN medications m ON m.id = d.medication_id WHERE m.user_id = $1) AS dose_logs,
         (SELECT count(*)::int FROM dose_events e JOIN medications m ON m.id = e.medication_id WHERE m.user_id = $1) AS dose_events`,
      [req.user.id]
    );
    res.json({ ok: true, counts: rows[0] });
  } catch (e) { next(e); }
});

const invalid = (message) => Object.assign(new Error(message), { status: 400 });
const DOSE_STATUS = ['pending', 'taken', 'skipped'];
const EVENT_TYPES = ['snoozed', 'taken', 'skipped', 'auto_skipped', 'undone'];

// ---- Validaciones de cada fila del lote ----
function checkMedication(m) {
  const hours = Number(m.frequency_hours);
  const ok = m.name && m.dose && m.start_at && Number.isInteger(hours) && hours >= 1 && hours <= 24;
  if (!ok) throw invalid('Hay un medicamento con datos obligatorios no válidos.');
}
function checkDose(d) {
  const ok = validId(d.medication_id) && d.scheduled_at && d.due_at && DOSE_STATUS.includes(d.status);
  if (!ok) throw invalid('Hay un registro de toma con datos no válidos.');
}
function checkEvent(e) {
  const ok = validId(e.dose_log_id) && validId(e.medication_id) && EVENT_TYPES.includes(e.event_type) && e.event_at && e.scheduled_at;
  if (!ok) throw invalid('Hay un evento de historial con datos no válidos.');
}

// ---- Escrituras (todas dentro de la misma transacción) ----
async function saveProfile(client, userId, profile) {
  await client.query(
    `UPDATE app_users SET display_name=$2, photo_url=$3, age=$4, height_cm=$5,
       weight_kg=$6, observations=$7, updated_at=$8 WHERE id=$1 AND updated_at <= $8`,
    [userId, profile.display_name || '', profile.photo_url || null,
      profile.age ?? null, profile.height_cm ?? null, profile.weight_kg ?? null,
      profile.observations || '', dateOrNull(profile.updated_at) || new Date().toISOString()]
  );
}

const UPSERT_MEDICATION = `INSERT INTO medications
    (id, user_id, name, active_ingredient, dose, frequency_hours, start_at, duration_days,
     notes, reference_image_url, reference_image_source, schedule_shift_ms, active,
     created_at, updated_at, deleted_at)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
   ON CONFLICT (id) DO UPDATE SET
     name=EXCLUDED.name, active_ingredient=EXCLUDED.active_ingredient, dose=EXCLUDED.dose,
     frequency_hours=EXCLUDED.frequency_hours, start_at=EXCLUDED.start_at,
     duration_days=EXCLUDED.duration_days, notes=EXCLUDED.notes,
     reference_image_url=EXCLUDED.reference_image_url, reference_image_source=EXCLUDED.reference_image_source,
     schedule_shift_ms=EXCLUDED.schedule_shift_ms, active=EXCLUDED.active,
     updated_at=EXCLUDED.updated_at, deleted_at=EXCLUDED.deleted_at, server_updated_at=now()
   WHERE medications.user_id=EXCLUDED.user_id AND medications.updated_at < EXCLUDED.updated_at`;

// ¿Cambió el horario (inicio o frecuencia) respecto a lo guardado antes?
function scheduleChanged(prev, m) {
  if (!prev) return false;
  const sameStart = new Date(prev.start_at).getTime() === new Date(m.start_at).getTime();
  return prev.frequency_hours !== Number(m.frequency_hours) || !sameStart;
}

// Guarda un medicamento. Devuelve cuántas filas cambió (0 o 1).
async function saveMedication(client, userId, m, doseLogs) {
  const prev = (await client.query('SELECT start_at, frequency_hours FROM medications WHERE id=$1 AND user_id=$2', [m.id, userId])).rows[0];
  checkMedication(m);
  const r = await client.query(UPSERT_MEDICATION, [
    m.id, userId, m.name, m.active_ingredient || null, m.dose, Number(m.frequency_hours),
    dateOrNull(m.start_at), m.duration_days ?? null, m.notes || null,
    m.reference_image_url || null, m.reference_image_source || null,
    String(m.schedule_shift_ms ?? 0), !!m.active, dateOrNull(m.created_at),
    dateOrNull(m.updated_at), dateOrNull(m.deleted_at),
  ]);
  // Si este cambio de HORARIO fue aceptado, las tomas PENDIENTES más viejas que él y que el teléfono ya no
  // tiene (porque cambió el horario) se descartan también aquí, para que no regresen en la próxima descarga.
  if (r.rowCount === 1 && scheduleChanged(prev, m)) {
    const keep = doseLogs.filter((d) => d.medication_id === m.id).map((d) => d.id);
    await client.query(
      `DELETE FROM dose_logs WHERE medication_id=$1 AND status='pending' AND created_at < $2 AND NOT (id = ANY($3::uuid[]))`,
      [m.id, dateOrNull(m.updated_at), keep]);
  }
  return r.rowCount;
}

const UPSERT_DOSE = `INSERT INTO dose_logs
    (id, medication_id, scheduled_at, due_at, status, dose_taken, action_at, on_time,
     snooze_count, postponed_to, auto_skipped, created_at, updated_at)
   SELECT $1, m.id, $3, $4, $5::dose_status, $6, $7, $8, $9, $10, $11, $12, $13
   FROM medications m WHERE m.id=$2 AND m.user_id=$14
     -- una toma pendiente de un horario anterior al último cambio del medicamento no se acepta
     AND ($5::text <> 'pending' OR $12::timestamptz >= m.updated_at
          OR EXISTS (SELECT 1 FROM dose_logs x WHERE x.id=$1))
   ON CONFLICT (id) DO UPDATE SET
     scheduled_at=EXCLUDED.scheduled_at, due_at=EXCLUDED.due_at, status=EXCLUDED.status,
     dose_taken=EXCLUDED.dose_taken, action_at=EXCLUDED.action_at, on_time=EXCLUDED.on_time,
     snooze_count=EXCLUDED.snooze_count, postponed_to=EXCLUDED.postponed_to,
     auto_skipped=EXCLUDED.auto_skipped, updated_at=EXCLUDED.updated_at, server_updated_at=now()
   WHERE dose_logs.medication_id=EXCLUDED.medication_id AND dose_logs.updated_at < EXCLUDED.updated_at`;

// Choque por horario: otro dispositivo ya generó la toma de ese mismo medicamento y hora con otro id.
// Gana la fila con updated_at más reciente (en empate, la del servidor). Devuelve true si la fila nueva
// puede seguir (la vieja se borró o no había choque), false si hay que descartarla.
async function resolveSlotClash(client, userId, d) {
  const clash = (await client.query(
    `SELECT x.id, x.updated_at FROM dose_logs x JOIN medications m ON m.id = x.medication_id
     WHERE x.medication_id=$1 AND x.scheduled_at=$2 AND x.id<>$3 AND m.user_id=$4`,
    [d.medication_id, dateOrNull(d.scheduled_at), d.id, userId])).rows[0];
  if (!clash) return true;
  if (new Date(clash.updated_at) >= new Date(d.updated_at)) return false;
  await client.query('DELETE FROM dose_logs WHERE id=$1', [clash.id]);
  return true;
}

// Guarda una toma. Devuelve cuántas filas cambió (0 o 1).
async function saveDose(client, userId, d) {
  checkDose(d);
  if (!(await resolveSlotClash(client, userId, d))) return 0;
  const onTime = d.on_time == null ? null : !!d.on_time;
  const r = await client.query(UPSERT_DOSE, [
    d.id, d.medication_id, dateOrNull(d.scheduled_at), dateOrNull(d.due_at), d.status,
    d.dose_taken || null, dateOrNull(d.action_at), onTime,
    Number(d.snooze_count || 0), dateOrNull(d.postponed_to), !!d.auto_skipped,
    dateOrNull(d.created_at), dateOrNull(d.updated_at), userId,
  ]);
  return r.rowCount;
}

// La bitácora es inmutable y se inserta después de las tomas.
async function saveEvent(client, userId, e) {
  checkEvent(e);
  const r = await client.query(
    `INSERT INTO dose_events
      (id, dose_log_id, medication_id, event_type, event_at, scheduled_at, postponed_from, postponed_to, created_at)
     SELECT $1, d.id, m.id, $4::dose_event_type, $5, $6, $7, $8, $9
     FROM medications m JOIN dose_logs d ON d.id=$2 AND d.medication_id=m.id
     WHERE m.id=$3 AND m.user_id=$10
     ON CONFLICT (id) DO NOTHING`,
    [e.id, e.dose_log_id, e.medication_id, e.event_type, dateOrNull(e.event_at),
      dateOrNull(e.scheduled_at), dateOrNull(e.postponed_from), dateOrNull(e.postponed_to),
      dateOrNull(e.created_at), userId]
  );
  return r.rowCount;
}

// Aplica una lista en orden (las filas dependen unas de otras y comparten la misma conexión/transacción,
// por eso no se ejecutan en paralelo). Devuelve el total de filas cambiadas.
async function saveAll(list, saveOne) {
  let total = 0;
  for (const item of list) total += await saveOne(item); // eslint-disable-line no-await-in-loop
  return total;
}

// Recibe el lote local completo o incremental. Es idempotente: repetir el mismo lote
// actualiza las mismas filas en lugar de duplicarlas.
router.post('/push', async (req, res, next) => {
  const medications = arr(req.body?.medications);
  const doseLogs = arr(req.body?.doseLogs);
  const doseEvents = arr(req.body?.doseEvents);
  if (medications.length > 500 || doseLogs.length > 20000 || doseEvents.length > 40000) {
    return bad(res, 413, 'El lote es demasiado grande. Sincroniza en grupos más pequeños.');
  }
  for (const [label, list] of [['medications', medications], ['doseLogs', doseLogs], ['doseEvents', doseEvents]]) {
    if (list.some((x) => !x || !validId(x.id))) return bad(res, 400, `Hay un identificador no válido en ${label}.`);
  }

  const userId = req.user.id;
  const profile = req.body?.profile;
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    if (profile && typeof profile === 'object') await saveProfile(client, userId, profile);
    // Primero medicamentos (las tomas y los eventos dependen de ellos), luego tomas y al final los eventos.
    const saved = {
      profile: !!profile,
      medications: await saveAll(medications, (m) => saveMedication(client, userId, m, doseLogs)),
      doseLogs: await saveAll(doseLogs, (d) => saveDose(client, userId, d)),
      doseEvents: await saveAll(doseEvents, (e) => saveEvent(client, userId, e)),
    };
    await client.query('COMMIT');
    res.json({ ok: true, saved });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    next(e);
  } finally {
    client.release();
  }
});

// Descarga: devuelve lo que el servidor guardó o cambió después de "since" (fecha del servidor devuelta en la
// descarga anterior). Sin "since" devuelve todo (primer inicio de sesión o instalación nueva).
// Se incluyen los medicamentos eliminados (deleted_at) para que la eliminación llegue a los demás dispositivos.
router.get('/pull', async (req, res, next) => {
  try {
    let since = null;
    if (req.query.since) {
      const t = new Date(String(req.query.since));
      if (Number.isNaN(t.getTime())) return bad(res, 400, 'La fecha "since" no es válida.');
      since = t.toISOString();
    }
    const uid = req.user.id;
    // Se toma la hora del servidor ANTES de leer: lo que cambie durante la lectura se vuelve a enviar la próxima vez.
    const serverTime = (await query('SELECT now() AS t')).rows[0].t.toISOString();

    // Las cuatro consultas son independientes: se lanzan a la vez para tardar lo que tarde la más lenta.
    const [pr, mr, dr, er] = await Promise.all([
      query(`SELECT display_name, photo_url, age, height_cm, weight_kg, observations, updated_at FROM app_users WHERE id=$1`, [uid]),
      query(
        `SELECT id, name, active_ingredient, dose, frequency_hours, start_at, duration_days, notes,
                reference_image_url, reference_image_source, schedule_shift_ms, active, created_at, updated_at, deleted_at
         FROM medications WHERE user_id=$1 AND ($2::timestamptz IS NULL OR server_updated_at > $2) ORDER BY created_at`, [uid, since]),
      query(
        `SELECT d.id, d.medication_id, d.scheduled_at, d.due_at, d.status, d.dose_taken, d.action_at, d.on_time,
                d.snooze_count, d.postponed_to, d.auto_skipped, d.created_at, d.updated_at
         FROM dose_logs d JOIN medications m ON m.id = d.medication_id
         WHERE m.user_id=$1 AND ($2::timestamptz IS NULL OR d.server_updated_at > $2) ORDER BY d.scheduled_at`, [uid, since]),
      query(
        `SELECT e.id, e.dose_log_id, e.medication_id, e.event_type, e.event_at, e.scheduled_at,
                e.postponed_from, e.postponed_to, e.created_at
         FROM dose_events e JOIN medications m ON m.id = e.medication_id
         WHERE m.user_id=$1 AND ($2::timestamptz IS NULL OR e.server_updated_at > $2) ORDER BY e.event_at`, [uid, since]),
    ]);
    const profile = pr.rows[0] || null;
    const medications = mr.rows;
    const doseLogs = dr.rows;
    const doseEvents = er.rows;

    res.json({ ok: true, serverTime, profile, medications, doseLogs, doseEvents });
  } catch (e) { next(e); }
});

export default router;
