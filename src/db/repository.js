// Repositorio: todas las lecturas y escrituras de la base de datos local.
// Aquí vive la lógica de negocio de las tomas:
//   - Tomé:    guarda dosis, hora y si fue a tiempo.
//   - Aplazar: máximo 2 veces; mueve la toma y las FUTURAS tomas del mismo medicamento.
//   - Omitir:  guarda la hora; NO mueve las tomas siguientes.
//   - Tercer momento (tras 2 aplazamientos): si en 10 min no se marca, se omite sola.
import { getDb, getCurrentUserId, setCurrentUserId } from './database';
import { iso, startOfDay, parseDayKey, dayKey, uuid, MIN, HOUR, DAY } from '../utils/time';

export const SNOOZE_MINUTES = 10;       // cuánto se aplaza cada vez
export const MAX_SNOOZES = 2;           // máximo de aplazamientos por toma
export const AUTO_SKIP_MINUTES = 10;    // espera en el tercer momento antes de omitir sola
export const ON_TIME_TOLERANCE_MIN = 15; // margen para considerar una toma "a tiempo"
const HORIZON_DAYS = 14;                // días de tomas que se generan por adelantado

// ---------------------------------------------------------------------------
// Cola: ejecuta las operaciones de una en una para que nunca se mezclen transacciones.
// ---------------------------------------------------------------------------
let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(() => fn());
  chain = run.catch(() => {});
  return run;
}

// ---------------------------------------------------------------------------
// Conversión de filas SQL a objetos de la app (camelCase, fechas en milisegundos)
// ---------------------------------------------------------------------------
const toMs = (s) => (s ? Date.parse(s) : null);

function mapMed(r) {
  return {
    id: r.id,
    name: r.name,
    activeIngredient: r.active_ingredient || '',
    dose: r.dose,
    intervalHours: r.frequency_hours,
    startAt: r.start_at, // ISO (el formulario lo usa tal cual)
    durationDays: r.duration_days,
    notes: r.notes || '',
    active: !!r.active,
    imageUrl: r.reference_image_url || null,
    imageSource: r.reference_image_source || null,
  };
}

function mapDose(r) {
  return {
    id: r.id,
    medId: r.medication_id,
    name: r.name,
    dose: r.med_dose,
    intervalHours: r.frequency_hours,
    notes: r.notes || '',
    imageUrl: r.reference_image_url || null,
    imageSource: r.reference_image_source || null,
    activeIngredient: r.active_ingredient || '',
    scheduledAt: toMs(r.scheduled_at), // hora inicial planeada
    dueAt: toMs(r.due_at),             // hora vigente
    status: r.status,                  // pending | taken | skipped
    snoozeCount: r.snooze_count,
    postponedTo: toMs(r.postponed_to),
    actionAt: toMs(r.action_at),
    onTime: r.on_time === null || r.on_time === undefined ? null : !!r.on_time,
    autoSkipped: !!r.auto_skipped,
    doseTaken: r.dose_taken,
  };
}

const DOSE_SELECT = `
  SELECT d.*, m.name, m.dose AS med_dose, m.frequency_hours, m.notes,
         m.reference_image_url, m.reference_image_source, m.active_ingredient
  FROM dose_logs d JOIN medications m ON m.id = d.medication_id`;

// Guarda una acción en la bitácora.
async function addEvent(db, { doseId, medId, type, at, scheduledAt, from = null, to = null }) {
  await db.runAsync(
    `INSERT INTO dose_events (id, dose_log_id, medication_id, event_type, event_at, scheduled_at,
                              postponed_from, postponed_to, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uuid(), doseId, medId, type, iso(at), scheduledAt, from, to, iso(Date.now())]
  );
}

// ---------------------------------------------------------------------------
// Generación de tomas: crea por adelantado las filas "pending" de los próximos días.
// scheduled_at = hora planeada; due_at = planeada + desplazamiento acumulado por aplazos.
// ---------------------------------------------------------------------------
async function generateForMed(db, med, fromMs) {
  if (!med.active || med.deleted_at) return;
  const step = med.frequency_hours * HOUR;
  const start = Date.parse(med.start_at);
  const end = med.duration_days ? start + med.duration_days * DAY : Infinity;
  const horizon = Date.now() + HORIZON_DAYS * DAY;
  const shift = med.schedule_shift_ms || 0;
  const k0 = Math.max(0, Math.ceil((fromMs - start) / step));
  const stamp = iso(Date.now());
  for (let t = start + k0 * step; t <= horizon && t < end; t += step) {
    // OR IGNORE: si la toma ya existe (misma hora planeada) no se duplica.
    await db.runAsync(
      `INSERT OR IGNORE INTO dose_logs
         (id, medication_id, scheduled_at, due_at, status, snooze_count, auto_skipped, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', 0, 0, ?, ?)`,
      [uuid(), med.id, iso(t), iso(t + shift), stamp, stamp]
    );
  }
}

async function ensureDosesImpl() {
  const db = await getDb();
  const uid = await getCurrentUserId(db);
  if (!uid) return;
  const meds = await db.getAllAsync('SELECT * FROM medications WHERE active = 1 AND deleted_at IS NULL AND user_id = ?', [uid]);
  await db.withTransactionAsync(async () => {
    for (const m of meds) await generateForMed(db, m, startOfDay(Date.now()));
  });
}

// ---------------------------------------------------------------------------
// Medicamentos
// ---------------------------------------------------------------------------
async function listMedsImpl() {
  const db = await getDb();
  const uid = await getCurrentUserId(db);
  const rows = await db.getAllAsync('SELECT * FROM medications WHERE deleted_at IS NULL AND user_id = ? ORDER BY created_at', [uid]);
  return rows.map(mapMed);
}

// Crea o actualiza un medicamento. Si cambia el horario, vuelve a generar las tomas futuras.
async function saveMedicationImpl(d) {
  const db = await getDb();
  const now = iso(Date.now());
  let medId = d.id;

  await db.withTransactionAsync(async () => {
    if (medId) {
      const old = await db.getFirstAsync('SELECT * FROM medications WHERE id = ?', [medId]);
      const anchorChanged = old.start_at !== d.startAt || old.frequency_hours !== d.intervalHours;
      const durationChanged = (old.duration_days ?? null) !== (d.durationDays ?? null);
      await db.runAsync(
        `UPDATE medications SET name=?, active_ingredient=?, dose=?, frequency_hours=?, start_at=?,
           duration_days=?, notes=?, schedule_shift_ms=?, updated_at=? WHERE id=?`,
        [d.name, d.activeIngredient ?? old.active_ingredient, d.dose, d.intervalHours, d.startAt,
         d.durationDays ?? null, d.notes || '', anchorChanged ? 0 : old.schedule_shift_ms, now, medId]
      );
      if (anchorChanged) {
        // Horario nuevo: se descartan las tomas pendientes de hoy en adelante y se regeneran.
        await db.runAsync(
          `DELETE FROM dose_logs WHERE medication_id=? AND status='pending' AND scheduled_at >= ?`,
          [medId, iso(startOfDay(Date.now()))]
        );
      } else if (durationChanged && d.durationDays) {
        // Solo cambió la duración: se descartan las pendientes que quedan fuera del nuevo fin.
        const endIso = iso(Date.parse(d.startAt) + d.durationDays * DAY);
        await db.runAsync(
          `DELETE FROM dose_logs WHERE medication_id=? AND status='pending' AND scheduled_at >= ?`,
          [medId, endIso]
        );
      }
    } else {
      medId = uuid();
      const userId = await getCurrentUserId(db);
      await db.runAsync(
        `INSERT INTO medications
           (id, user_id, name, active_ingredient, dose, frequency_hours, start_at, duration_days, notes,
            reference_image_url, reference_image_source, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [medId, userId, d.name, d.activeIngredient || null, d.dose, d.intervalHours, d.startAt,
         d.durationDays ?? null, d.notes || '', d.imageUrl || null, d.imageSource || null, now, now]
      );
    }
    const med = await db.getFirstAsync('SELECT * FROM medications WHERE id = ?', [medId]);
    await generateForMed(db, med, startOfDay(Date.now()));
  });
  return medId;
}

// Borrado lógico: el medicamento desaparece de la app pero su historial se conserva.
async function deleteMedicationImpl(id) {
  const db = await getDb();
  const now = iso(Date.now());
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM dose_logs WHERE medication_id=? AND status='pending'`, [id]);
    await db.runAsync('UPDATE medications SET deleted_at=?, active=0, updated_at=? WHERE id=?', [now, now, id]);
  });
}

// Activa o suspende los recordatorios de un medicamento.
async function setActiveImpl(id, active) {
  const db = await getDb();
  const now = iso(Date.now());
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE medications SET active=?, updated_at=? WHERE id=?', [active ? 1 : 0, now, id]);
    if (!active) {
      await db.runAsync(
        `DELETE FROM dose_logs WHERE medication_id=? AND status='pending' AND scheduled_at >= ?`,
        [id, iso(startOfDay(Date.now()))]
      );
    } else {
      const med = await db.getFirstAsync('SELECT * FROM medications WHERE id=?', [id]);
      await generateForMed(db, med, Date.now()); // al reactivar, solo tomas desde ahora
    }
  });
}

async function updateImageImpl(id, { imageUrl, imageSource, activeIngredient }) {
  const db = await getDb();
  await db.runAsync(
    `UPDATE medications SET reference_image_url=?, reference_image_source=?,
       active_ingredient=COALESCE(?, active_ingredient), updated_at=? WHERE id=?`,
    [imageUrl, imageSource, activeIngredient || null, iso(Date.now()), id]
  );
}

// ---------------------------------------------------------------------------
// Tomas de hoy
// ---------------------------------------------------------------------------
async function getTodayDosesImpl() {
  const db = await getDb();
  const from = startOfDay(Date.now());
  const rows = await db.getAllAsync(
    `${DOSE_SELECT}
     WHERE m.deleted_at IS NULL AND m.active = 1 AND m.user_id = ? AND d.scheduled_at >= ? AND d.scheduled_at < ?
     ORDER BY d.due_at`,
    [await getCurrentUserId(db), iso(from), iso(from + DAY)]
  );
  return rows.map(mapDose);
}

// Próximas tomas pendientes (para programar las notificaciones).
async function getUpcomingImpl(limit = 60) {
  const db = await getDb();
  const rows = await db.getAllAsync(
    `${DOSE_SELECT}
     WHERE m.deleted_at IS NULL AND m.active = 1 AND m.user_id = ? AND d.status = 'pending' AND d.due_at > ?
     ORDER BY d.due_at LIMIT ?`,
    [await getCurrentUserId(db), iso(Date.now()), limit]
  );
  return rows.map(mapDose);
}

// Carga una toma y valida que se pueda actuar sobre ella.
async function loadActionable(db, id) {
  const row = await db.getFirstAsync(
    `SELECT d.*, m.dose AS med_dose FROM dose_logs d JOIN medications m ON m.id = d.medication_id WHERE d.id = ?`,
    [id]
  );
  if (!row || row.status !== 'pending') return { error: 'estado' };
  if (Date.parse(row.due_at) > Date.now()) return { error: 'aun-no' }; // botones bloqueados hasta la hora
  return { row };
}

// "Tomé": guarda dosis tomada, hora y si fue a tiempo.
async function takeDoseImpl(id) {
  const db = await getDb();
  const { row, error } = await loadActionable(db, id);
  if (error) return { ok: false, reason: error };
  const now = Date.now();
  const due = Date.parse(row.due_at);
  const onTime = now <= due + ON_TIME_TOLERANCE_MIN * MIN ? 1 : 0;
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE dose_logs SET status='taken', dose_taken=?, action_at=?, on_time=?, updated_at=? WHERE id=?`,
      [row.med_dose, iso(now), onTime, iso(now), id]
    );
    await addEvent(db, { doseId: id, medId: row.medication_id, type: 'taken', at: now, scheduledAt: row.scheduled_at });
  });
  return { ok: true };
}

// "Omitir": guarda la hora de la omisión. NO cambia el horario de las tomas siguientes.
async function skipDoseImpl(id) {
  const db = await getDb();
  const { row, error } = await loadActionable(db, id);
  if (error) return { ok: false, reason: error };
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE dose_logs SET status='skipped', action_at=?, on_time=NULL, updated_at=? WHERE id=?`,
      [iso(now), iso(now), id]
    );
    await addEvent(db, { doseId: id, medId: row.medication_id, type: 'skipped', at: now, scheduledAt: row.scheduled_at });
  });
  return { ok: true };
}

// "Aplazar": mueve esta toma y TODAS las futuras del mismo medicamento. Máximo 2 veces.
async function snoozeDoseImpl(id) {
  const db = await getDb();
  const { row, error } = await loadActionable(db, id);
  if (error) return { ok: false, reason: error };
  if (row.snooze_count >= MAX_SNOOZES) return { ok: false, reason: 'limite' };

  const now = Date.now();
  const oldDue = Date.parse(row.due_at);
  const newDue = now + SNOOZE_MINUTES * MIN;
  const delta = newDue - oldDue; // cuánto se corre esta toma (y las siguientes)

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE dose_logs SET due_at=?, postponed_to=?, snooze_count=snooze_count+1, updated_at=? WHERE id=?`,
      [iso(newDue), iso(newDue), iso(now), id]
    );
    // Tomas futuras pendientes del MISMO medicamento: se corren la misma cantidad.
    const future = await db.getAllAsync(
      `SELECT id, due_at FROM dose_logs WHERE medication_id=? AND status='pending' AND scheduled_at > ? AND id <> ?`,
      [row.medication_id, row.scheduled_at, id]
    );
    for (const f of future) {
      await db.runAsync('UPDATE dose_logs SET due_at=?, updated_at=? WHERE id=?',
        [iso(Date.parse(f.due_at) + delta), iso(now), f.id]);
    }
    // El desplazamiento se acumula para las tomas que se generen después.
    await db.runAsync(
      'UPDATE medications SET schedule_shift_ms = schedule_shift_ms + ?, updated_at=? WHERE id=?',
      [delta, iso(now), row.medication_id]
    );
    await addEvent(db, {
      doseId: id, medId: row.medication_id, type: 'snoozed', at: now,
      scheduledAt: row.scheduled_at, from: row.due_at, to: iso(newDue),
    });
  });
  return { ok: true, remaining: MAX_SNOOZES - (row.snooze_count + 1), until: newDue };
}

// Deshacer una acción manual (Tomé u Omitir) por si se marcó por error.
async function undoDoseImpl(id) {
  const db = await getDb();
  const row = await db.getFirstAsync('SELECT * FROM dose_logs WHERE id = ?', [id]);
  if (!row || row.status === 'pending' || row.auto_skipped) return { ok: false, reason: 'estado' };
  const now = Date.now();
  // Si ya agotó los aplazamientos, la ventana de 10 min del tercer momento vuelve a empezar.
  const due = row.snooze_count >= MAX_SNOOZES ? iso(now) : row.due_at;
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE dose_logs SET status='pending', dose_taken=NULL, action_at=NULL, on_time=NULL,
         due_at=?, updated_at=? WHERE id=?`,
      [due, iso(now), id]
    );
    await addEvent(db, { doseId: id, medId: row.medication_id, type: 'undone', at: now, scheduledAt: row.scheduled_at });
  });
  return { ok: true };
}

// Tercer momento: la toma ya se aplazó 2 veces y pasaron 10 min sin marcarla -> Omitida automática.
async function autoSkipExpiredImpl() {
  const db = await getDb();
  const limit = iso(Date.now() - AUTO_SKIP_MINUTES * MIN);
  const rows = await db.getAllAsync(
    `SELECT * FROM dose_logs WHERE status='pending' AND snooze_count >= ? AND due_at <= ?`,
    [MAX_SNOOZES, limit]
  );
  if (rows.length === 0) return 0;
  await db.withTransactionAsync(async () => {
    for (const r of rows) {
      // La hora registrada es la del vencimiento (due + 10 min), aunque la app se haya enterado tarde.
      const at = Date.parse(r.due_at) + AUTO_SKIP_MINUTES * MIN;
      await db.runAsync(
        `UPDATE dose_logs SET status='skipped', auto_skipped=1, action_at=?, on_time=NULL, updated_at=? WHERE id=?`,
        [iso(at), iso(Date.now()), r.id]
      );
      await addEvent(db, { doseId: r.id, medId: r.medication_id, type: 'auto_skipped', at, scheduledAt: r.scheduled_at });
    }
  });
  return rows.length;
}

// ---------------------------------------------------------------------------
// Historial
// ---------------------------------------------------------------------------
// Una toma "tiene datos" si hubo alguna acción, o si ya venció (sin respuesta).
const HAS_DATA = `(d.status <> 'pending' OR d.snooze_count > 0 OR d.due_at <= ?)`;

// Días del mes (AAAA-MM-DD) que tienen registros, para marcarlos en el calendario.
async function getMonthMarksImpl(year, month) {
  const db = await getDb();
  const from = new Date(year, month, 1).getTime();
  const to = new Date(year, month + 1, 1).getTime();
  const rows = await db.getAllAsync(
    `SELECT d.scheduled_at FROM dose_logs d JOIN medications m ON m.id = d.medication_id
     WHERE m.user_id = ? AND d.scheduled_at >= ? AND d.scheduled_at < ? AND ${HAS_DATA}`,
    [await getCurrentUserId(db), iso(from), iso(to), iso(Date.now())]
  );
  return [...new Set(rows.map((r) => dayKey(Date.parse(r.scheduled_at))))];
}

// Datos de un día agrupados por medicamento.
async function getHistoryDayImpl(key) {
  const db = await getDb();
  const from = parseDayKey(key);
  const rows = await db.getAllAsync(
    `${DOSE_SELECT}
     WHERE m.user_id = ? AND d.scheduled_at >= ? AND d.scheduled_at < ? AND ${HAS_DATA}
     ORDER BY d.scheduled_at`,
    [await getCurrentUserId(db), iso(from), iso(from + DAY), iso(Date.now())]
  );
  const groups = new Map();
  for (const r of rows.map(mapDose)) {
    if (!groups.has(r.medId)) {
      groups.set(r.medId, { medId: r.medId, name: r.name, dose: r.dose, intervalHours: r.intervalHours, notes: r.notes, doses: [] });
    }
    groups.get(r.medId).doses.push(r);
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// Perfil, ajustes y cuenta
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = { sound: true, vibrate: true };

// Las versiones anteriores guardaban "Usuario local" como nombre; se trata como vacío.
const cleanName = (n) => (!n || n === 'Usuario local' ? '' : n);

function mapProfile(u) {
  return {
    email: u?.email || '',
    provider: u?.auth_provider || 'local',
    photoUrl: u?.photo_url || null,
    fullName: cleanName(u?.display_name),
    age: u?.age ?? null,
    heightCm: u?.height_cm ?? null,
    weightKg: u?.weight_kg ?? null,
    observations: u?.observations || '',
  };
}

async function getProfileImpl() {
  const db = await getDb();
  const u = await db.getFirstAsync('SELECT * FROM app_users WHERE id = ?', [await getCurrentUserId(db)]);
  return mapProfile(u);
}

// Guarda el perfil y lo deja pendiente de sincronizar (synced_at = NULL).
async function saveProfileImpl(p) {
  const db = await getDb();
  const uid = await getCurrentUserId(db);
  const current = await db.getFirstAsync('SELECT photo_url FROM app_users WHERE id = ?', [uid]);
  // photoUrl: undefined = no tocar; null o '' = quitar la foto; texto = nueva foto.
  const photo = p.photoUrl === undefined ? current?.photo_url ?? null : p.photoUrl || null;
  await db.runAsync(
    `UPDATE app_users SET display_name=?, photo_url=?, age=?, height_cm=?, weight_kg=?, observations=?, updated_at=?, synced_at=NULL
     WHERE id=?`,
    [p.fullName.trim(), photo, p.age ?? null, p.heightCm ?? null, p.weightKg ?? null, (p.observations || '').trim(),
     iso(Date.now()), uid]
  );
}

// Preferencias del dispositivo (sonido y vibración). Se guardan en app_meta, no se sincronizan.
async function getSettingsImpl() {
  const db = await getDb();
  const row = await db.getFirstAsync("SELECT value FROM app_meta WHERE key = 'settings'");
  try {
    return { ...DEFAULT_SETTINGS, ...(row ? JSON.parse(row.value) : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSettingsImpl(settings) {
  const db = await getDb();
  await db.runAsync("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('settings', ?)", [JSON.stringify(settings)]);
}

// Datos de solo lectura de la cuenta local.
async function getAccountInfoImpl() {
  const db = await getDb();
  const uid = await getCurrentUserId(db);
  const u = await db.getFirstAsync('SELECT id, email, auth_provider, created_at FROM app_users WHERE id = ?', [uid]);
  const meds = await db.getFirstAsync('SELECT COUNT(*) AS c FROM medications WHERE deleted_at IS NULL AND user_id = ?', [uid]);
  const logs = await db.getFirstAsync(
    `SELECT COUNT(*) AS c FROM dose_logs d JOIN medications m ON m.id = d.medication_id
     WHERE m.user_id = ? AND d.status <> 'pending'`, [uid]);
  const pending = await db.getFirstAsync(
    `SELECT COUNT(*) AS c FROM dose_logs d JOIN medications m ON m.id = d.medication_id
     WHERE m.user_id = ? AND d.synced_at IS NULL AND d.status <> 'pending'`, [uid]);
  return { id: u.id, email: u.email || '', provider: u.auth_provider, createdAt: toMs(u.created_at),
           meds: meds.c, records: logs.c, unsynced: pending.c };
}

// ---------------------------------------------------------------------------
// Cuentas y sesión
// ---------------------------------------------------------------------------
const mapUser = (u) =>
  u && { id: u.id, email: u.email || '', provider: u.auth_provider, name: cleanName(u.display_name), photoUrl: u.photo_url || null };

const accountError = (code, message) => Object.assign(new Error(message), { code });

// Reutiliza el usuario anónimo (con los datos anteriores al login) si aún no tiene cuenta; si no, crea uno.
async function adoptOrCreateUser(db, { email, provider, googleSub = null, name = '', photoUrl = null }) {
  const now = iso(Date.now());
  const anon = await db.getFirstAsync(
    `SELECT id FROM app_users WHERE email IS NULL AND google_sub IS NULL AND auth_provider = 'local' ORDER BY created_at LIMIT 1`
  );
  if (anon) {
    await db.runAsync(
      `UPDATE app_users SET email=?, auth_provider=?, google_sub=?, display_name=?, photo_url=?, updated_at=?, synced_at=NULL WHERE id=?`,
      [email, provider, googleSub, name, photoUrl, now, anon.id]
    );
    return anon.id;
  }
  const id = uuid();
  await db.runAsync(
    `INSERT INTO app_users (id, email, auth_provider, google_sub, display_name, photo_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, email, provider, googleSub, name, photoUrl, now, now]
  );
  return id;
}

async function getSessionUserImpl() {
  const db = await getDb();
  const id = await getCurrentUserId(db);
  if (!id) return null;
  const u = await db.getFirstAsync('SELECT * FROM app_users WHERE id = ?', [id]);
  if (!u) { await setCurrentUserId(db, null); return null; }
  return mapUser(u);
}

// Crea una cuenta con correo y contraseña (ya procesada: hash + sal) y abre la sesión.
async function createPasswordAccountImpl({ email, name, hash, salt }) {
  const db = await getDb();
  const mail = email.trim().toLowerCase();
  if (await db.getFirstAsync('SELECT id FROM app_users WHERE lower(email) = ?', [mail])) {
    throw accountError('EMAIL_EXISTS', 'Ya existe una cuenta con ese correo.');
  }
  let id;
  await db.withTransactionAsync(async () => {
    id = await adoptOrCreateUser(db, { email: mail, provider: 'password', name: name.trim() });
    await db.runAsync(
      'INSERT INTO local_credentials (user_id, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?)',
      [id, hash, salt, iso(Date.now())]
    );
    await setCurrentUserId(db, id);
  });
  return mapUser(await db.getFirstAsync('SELECT * FROM app_users WHERE id = ?', [id]));
}

// Datos para validar un inicio de sesión con correo (la comparación del hash la hace auth.js).
async function findAccountImpl(email) {
  const db = await getDb();
  const r = await db.getFirstAsync(
    `SELECT u.id, u.auth_provider, c.password_hash, c.password_salt
     FROM app_users u LEFT JOIN local_credentials c ON c.user_id = u.id
     WHERE lower(u.email) = ?`,
    [email.trim().toLowerCase()]
  );
  return r ? { id: r.id, provider: r.auth_provider, hash: r.password_hash, salt: r.password_salt } : null;
}

// Cambia la contraseña local de un usuario (nuevo hash y sal). Si no tenía credencial local, la crea.
async function setPasswordImpl(userId, hash, salt) {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO local_credentials (user_id, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET password_hash = excluded.password_hash, password_salt = excluded.password_salt`,
    [userId, hash, salt, iso(Date.now())]
  );
  await db.runAsync('UPDATE app_users SET updated_at = ? WHERE id = ?', [iso(Date.now()), userId]);
}

// Tratamientos con duración que ya terminaron: se eliminan de la lista (borrado lógico, el historial se conserva).
// Condición: pasó la fecha final Y no queda ninguna toma futura o aplazada pendiente.
// Devuelve los nombres eliminados.
async function purgeFinishedImpl() {
  const db = await getDb();
  const uid = await getCurrentUserId(db);
  if (!uid) return [];
  const nowMs = Date.now();
  const rows = await db.getAllAsync(
    'SELECT id, name, start_at, duration_days FROM medications WHERE deleted_at IS NULL AND duration_days IS NOT NULL AND user_id = ?', [uid]);
  const done = [];
  for (const m of rows) {
    if (Date.parse(m.start_at) + m.duration_days * DAY > nowMs) continue; // aún dentro del tratamiento
    const open = await db.getFirstAsync(
      `SELECT COUNT(*) AS c FROM dose_logs WHERE medication_id = ? AND status = 'pending' AND due_at > ?`, [m.id, iso(nowMs)]);
    if (open.c > 0) continue; // queda una toma por responder o aplazada
    const stamp = iso(nowMs);
    await db.runAsync('UPDATE medications SET deleted_at = ?, active = 0, updated_at = ? WHERE id = ?', [stamp, stamp, m.id]);
    done.push(m.name);
  }
  return done;
}

async function startSessionImpl(userId) {
  const db = await getDb();
  await setCurrentUserId(db, userId);
  return mapUser(await db.getFirstAsync('SELECT * FROM app_users WHERE id = ?', [userId]));
}

// Entra con una cuenta de Google. Nombre y foto de Google se copian SOLO si el campo está vacío,
// para no pisar lo que el usuario edite luego en su perfil.
async function signInGoogleUserImpl({ sub, email, name, photoUrl }) {
  const db = await getDb();
  const mail = (email || '').trim().toLowerCase();
  let id;
  await db.withTransactionAsync(async () => {
    let u = await db.getFirstAsync('SELECT * FROM app_users WHERE google_sub = ?', [sub]);
    if (!u && mail) u = await db.getFirstAsync('SELECT * FROM app_users WHERE lower(email) = ?', [mail]); // vincula cuenta existente
    if (u) {
      id = u.id;
      await db.runAsync(
        `UPDATE app_users SET google_sub = ?,
           display_name = CASE WHEN display_name IS NULL OR display_name = '' THEN ? ELSE display_name END,
           photo_url    = CASE WHEN photo_url IS NULL OR photo_url = '' THEN ? ELSE photo_url END,
           updated_at = ? WHERE id = ?`,
        [sub, name || '', photoUrl || null, iso(Date.now()), id]
      );
    } else {
      id = await adoptOrCreateUser(db, { email: mail, provider: 'google', googleSub: sub, name: name || '', photoUrl: photoUrl || null });
    }
    await setCurrentUserId(db, id);
  });
  return mapUser(await db.getFirstAsync('SELECT * FROM app_users WHERE id = ?', [id]));
}

async function signOutImpl() {
  const db = await getDb();
  await setCurrentUserId(db, null);
}

// ---------------------------------------------------------------------------
// Resumen de los últimos días (para la gráfica del historial)
// ---------------------------------------------------------------------------
async function getWeekSummaryImpl(days = 7) {
  const db = await getDb();
  const now = Date.now();
  const todayStart = startOfDay(now);
  const from = todayStart - (days - 1) * DAY;
  const rows = await db.getAllAsync(
    `SELECT d.scheduled_at, d.due_at, d.status FROM dose_logs d JOIN medications m ON m.id = d.medication_id
     WHERE m.user_id = ? AND d.scheduled_at >= ? AND d.scheduled_at < ? AND ${HAS_DATA}`,
    [await getCurrentUserId(db), iso(from), iso(todayStart + DAY), iso(now)]
  );
  const list = Array.from({ length: days }, (_, i) => {
    const time = from + i * DAY;
    return { key: dayKey(time), time, taken: 0, skipped: 0, missed: 0, total: 0 };
  });
  const byKey = Object.fromEntries(list.map((d) => [d.key, d]));
  for (const r of rows) {
    const day = byKey[dayKey(Date.parse(r.scheduled_at))];
    if (!day) continue;
    if (r.status === 'taken') day.taken++;
    else if (r.status === 'skipped') day.skipped++;
    else if (Date.parse(r.due_at) <= now) day.missed++; // venció sin respuesta
    else continue;                                       // aplazada que aún no vence: no cuenta todavía
    day.total++;
  }
  return list;
}

// ---------------------------------------------------------------------------
// API pública (todas las funciones pasan por la cola)
// ---------------------------------------------------------------------------
export const listMeds = () => serial(listMedsImpl);
export const saveMedication = (d) => serial(() => saveMedicationImpl(d));
export const deleteMedication = (id) => serial(() => deleteMedicationImpl(id));
export const setMedicationActive = (id, active) => serial(() => setActiveImpl(id, active));
export const updateMedicationImage = (id, data) => serial(() => updateImageImpl(id, data));
export const ensureDoses = () => serial(ensureDosesImpl);
export const getTodayDoses = () => serial(getTodayDosesImpl);
export const getUpcomingDoses = (limit) => serial(() => getUpcomingImpl(limit));
export const takeDose = (id) => serial(() => takeDoseImpl(id));
export const skipDose = (id) => serial(() => skipDoseImpl(id));
export const snoozeDose = (id) => serial(() => snoozeDoseImpl(id));
export const undoDose = (id) => serial(() => undoDoseImpl(id));
export const autoSkipExpired = () => serial(autoSkipExpiredImpl);
export const getMonthMarks = (y, m) => serial(() => getMonthMarksImpl(y, m));
export const getHistoryDay = (key) => serial(() => getHistoryDayImpl(key));
export const getSessionUser = () => serial(getSessionUserImpl);
export const createPasswordAccount = (d) => serial(() => createPasswordAccountImpl(d));
export const findAccount = (email) => serial(() => findAccountImpl(email));
export const setPassword = (id, hash, salt) => serial(() => setPasswordImpl(id, hash, salt));
export const purgeFinishedMeds = () => serial(purgeFinishedImpl);
export const startSession = (id) => serial(() => startSessionImpl(id));
export const signInGoogleUser = (g) => serial(() => signInGoogleUserImpl(g));
export const signOutUser = () => serial(signOutImpl);
export const getWeekSummary = (days) => serial(() => getWeekSummaryImpl(days));
export const getProfile = () => serial(getProfileImpl);
export const saveProfile = (p) => serial(() => saveProfileImpl(p));
export const getSettings = () => serial(getSettingsImpl);
export const saveSettings = (s) => serial(() => saveSettingsImpl(s));
export const getAccountInfo = () => serial(getAccountInfoImpl);
