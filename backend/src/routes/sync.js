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

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const profile = req.body?.profile;
    if (profile && typeof profile === 'object') {
      await client.query(
        `UPDATE app_users SET display_name=$2, photo_url=$3, age=$4, height_cm=$5,
           weight_kg=$6, observations=$7, updated_at=$8 WHERE id=$1 AND updated_at <= $8`,
        [req.user.id, profile.display_name || '', profile.photo_url || null,
          profile.age ?? null, profile.height_cm ?? null, profile.weight_kg ?? null,
          profile.observations || '', dateOrNull(profile.updated_at) || new Date().toISOString()]
      );
    }
    let medsSaved = 0;
    let logsSaved = 0;
    let eventsSaved = 0;

    // Primero medicamentos: las tomas y los eventos dependen de ellos.
    for (const m of medications) {
      const prev = (await client.query('SELECT start_at, frequency_hours FROM medications WHERE id=$1 AND user_id=$2', [m.id, req.user.id])).rows[0];
      if (!m.name || !m.dose || !m.start_at || !Number.isInteger(Number(m.frequency_hours)) || Number(m.frequency_hours) < 1 || Number(m.frequency_hours) > 24) {
        throw Object.assign(new Error('Hay un medicamento con datos obligatorios no válidos.'), { status: 400 });
      }
      const r = await client.query(
        `INSERT INTO medications
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
         WHERE medications.user_id=EXCLUDED.user_id AND medications.updated_at < EXCLUDED.updated_at`,
        [m.id, req.user.id, m.name, m.active_ingredient || null, m.dose, Number(m.frequency_hours),
          dateOrNull(m.start_at), m.duration_days ?? null, m.notes || null,
          m.reference_image_url || null, m.reference_image_source || null,
          String(m.schedule_shift_ms ?? 0), !!m.active, dateOrNull(m.created_at),
          dateOrNull(m.updated_at), dateOrNull(m.deleted_at)]
      );
      medsSaved += r.rowCount;
      // Si este cambio de HORARIO fue aceptado, las tomas PENDIENTES más viejas que él y que el teléfono ya no
      // tiene (porque cambió el horario) se descartan también aquí, para que no regresen en la próxima descarga.
      const scheduleChanged = prev && (prev.frequency_hours !== Number(m.frequency_hours) || new Date(prev.start_at).getTime() !== new Date(m.start_at).getTime());
      if (r.rowCount === 1 && scheduleChanged) {
        const keep = doseLogs.filter((d) => d.medication_id === m.id).map((d) => d.id);
        await client.query(
          `DELETE FROM dose_logs WHERE medication_id=$1 AND status='pending' AND created_at < $2 AND NOT (id = ANY($3::uuid[]))`,
          [m.id, dateOrNull(m.updated_at), keep]);
      }
    }

    // Después las tomas. Solo se aceptan si el medicamento pertenece a este usuario.
    for (const d of doseLogs) {
      if (!validId(d.medication_id) || !d.scheduled_at || !d.due_at || !['pending','taken','skipped'].includes(d.status)) {
        throw Object.assign(new Error('Hay un registro de toma con datos no válidos.'), { status: 400 });
      }
      // Choque por horario: otro dispositivo ya generó la toma de ese mismo medicamento y hora con otro id.
      // Gana la fila con updated_at más reciente (en empate, la del servidor).
      const clash = await client.query(
        `SELECT x.id, x.updated_at FROM dose_logs x JOIN medications m ON m.id = x.medication_id
         WHERE x.medication_id=$1 AND x.scheduled_at=$2 AND x.id<>$3 AND m.user_id=$4`,
        [d.medication_id, dateOrNull(d.scheduled_at), d.id, req.user.id]);
      if (clash.rows[0]) {
        if (new Date(clash.rows[0].updated_at) < new Date(d.updated_at)) {
          await client.query('DELETE FROM dose_logs WHERE id=$1', [clash.rows[0].id]);
        } else continue;
      }
      const r = await client.query(
        `INSERT INTO dose_logs
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
         WHERE dose_logs.medication_id=EXCLUDED.medication_id AND dose_logs.updated_at < EXCLUDED.updated_at`,
        [d.id, d.medication_id, dateOrNull(d.scheduled_at), dateOrNull(d.due_at), d.status,
          d.dose_taken || null, dateOrNull(d.action_at), d.on_time == null ? null : !!d.on_time,
          Number(d.snooze_count || 0), dateOrNull(d.postponed_to), !!d.auto_skipped,
          dateOrNull(d.created_at), dateOrNull(d.updated_at), req.user.id]
      );
      logsSaved += r.rowCount;
    }

    // La bitácora es inmutable y se inserta después de las tomas.
    for (const e of doseEvents) {
      if (!validId(e.dose_log_id) || !validId(e.medication_id) || !['snoozed','taken','skipped','auto_skipped','undone'].includes(e.event_type) || !e.event_at || !e.scheduled_at) {
        throw Object.assign(new Error('Hay un evento de historial con datos no válidos.'), { status: 400 });
      }
      const r = await client.query(
        `INSERT INTO dose_events
          (id, dose_log_id, medication_id, event_type, event_at, scheduled_at, postponed_from, postponed_to, created_at)
         SELECT $1, d.id, m.id, $4::dose_event_type, $5, $6, $7, $8, $9
         FROM medications m JOIN dose_logs d ON d.id=$2 AND d.medication_id=m.id
         WHERE m.id=$3 AND m.user_id=$10
         ON CONFLICT (id) DO NOTHING`,
        [e.id, e.dose_log_id, e.medication_id, e.event_type, dateOrNull(e.event_at),
          dateOrNull(e.scheduled_at), dateOrNull(e.postponed_from), dateOrNull(e.postponed_to),
          dateOrNull(e.created_at), req.user.id]
      );
      eventsSaved += r.rowCount;
    }

    await client.query('COMMIT');
    res.json({ ok: true, saved: { profile: !!profile, medications: medsSaved, doseLogs: logsSaved, doseEvents: eventsSaved } });
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
