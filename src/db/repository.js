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
    presentation: r.presentation || '',       // tabletas, gotas... (opcional)
    stockUnits: r.stock_units ?? null,        // unidades que quedan (null = no se lleva control)
    unitsPerDose: r.units_per_dose || 1,      // unidades que se gastan por toma
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
  const times = [];
  for (let t = start + k0 * step; t <= horizon && t < end; t += step) times.push(t);
  // OR IGNORE: si la toma ya existe (misma hora planeada) no se duplica.
  await Promise.all(times.map((t) => db.runAsync(
    `INSERT OR IGNORE INTO dose_logs
       (id, medication_id, scheduled_at, due_at, status, snooze_count, auto_skipped, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', 0, 0, ?, ?)`,
    [uuid(), med.id, iso(t), iso(t + shift), stamp, stamp]
  )));
}

async function ensureDosesImpl() {
  const db = await getDb();
  const uid = await getCurrentUserId(db);
  if (!uid) return;
  const meds = await db.getAllAsync('SELECT * FROM medications WHERE active = 1 AND deleted_at IS NULL AND user_id = ?', [uid]);
  await db.withTransactionAsync(async () => {
    await Promise.all(meds.map((m) => generateForMed(db, m, startOfDay(Date.now()))));
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
           duration_days=?, notes=?, schedule_shift_ms=?, presentation=?, stock_units=?, units_per_dose=?, updated_at=? WHERE id=?`,
        [d.name, d.activeIngredient ?? old.active_ingredient, d.dose, d.intervalHours, d.startAt,
         d.durationDays ?? null, d.notes || '', anchorChanged ? 0 : old.schedule_shift_ms,
         d.presentation || null, d.stockUnits ?? null, d.unitsPerDose || 1, now, medId]
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
            reference_image_url, reference_image_source, presentation, stock_units, units_per_dose,
            active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [medId, userId, d.name, d.activeIngredient || null, d.dose, d.intervalHours, d.startAt,
         d.durationDays ?? null, d.notes || '', d.imageUrl || null, d.imageSource || null,
         d.presentation || null, d.stockUnits ?? null, d.unitsPerDose || 1, now, now]
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
  if (row?.status !== 'pending') return { error: 'estado' };
  if (Date.parse(row.due_at) > Date.now()) return { error: 'aun-no' }; // botones bloqueados hasta la hora
  return { row };
}

// Suma o resta las unidades de UNA toma al stock del medicamento (sign = -1 al tomar, +1 al deshacer).
// Si el medicamento no lleva control de stock (stock_units NULL) no hace nada. Nunca baja de 0.
async function adjustStock(db, medId, sign, nowMs) {
  const m = await db.getFirstAsync('SELECT stock_units, units_per_dose FROM medications WHERE id = ?', [medId]);
  if (m?.stock_units == null) return;
  const next = Math.max(0, m.stock_units + sign * (m.units_per_dose || 1));
  await db.runAsync('UPDATE medications SET stock_units = ?, updated_at = ? WHERE id = ?', [next, iso(nowMs), medId]);
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
    await adjustStock(db, row.medication_id, -1, now); // descuenta las unidades de esta toma del stock
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
    await Promise.all(future.map((f) => db.runAsync('UPDATE dose_logs SET due_at=?, updated_at=? WHERE id=?',
      [iso(Date.parse(f.due_at) + delta), iso(now), f.id])));
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
    if (row.status === 'taken') await adjustStock(db, row.medication_id, +1, now); // se devuelven las unidades
  });
  return { ok: true };
}

// Marca una toma vencida como omitida automática y deja el evento en la bitácora.
async function autoSkipRow(db, r) {
  // La hora registrada es la del vencimiento (due + 10 min), aunque la app se haya enterado tarde.
  const at = Date.parse(r.due_at) + AUTO_SKIP_MINUTES * MIN;
  await db.runAsync(
    `UPDATE dose_logs SET status='skipped', auto_skipped=1, action_at=?, on_time=NULL, updated_at=? WHERE id=?`,
    [iso(at), iso(Date.now()), r.id]
  );
  await addEvent(db, { doseId: r.id, medId: r.medication_id, type: 'auto_skipped', at, scheduledAt: r.scheduled_at });
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
    await Promise.all(rows.map((r) => autoSkipRow(db, r)));
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

// Todas las tomas con datos entre dos fechas (para exportar el historial a PDF).
async function getHistoryRangeImpl(fromMs, toMs) {
  const db = await getDb();
  const rows = await db.getAllAsync(
    `${DOSE_SELECT}
     WHERE m.user_id = ? AND d.scheduled_at >= ? AND d.scheduled_at < ? AND ${HAS_DATA}
     ORDER BY d.scheduled_at`,
    [await getCurrentUserId(db), iso(fromMs), iso(toMs), iso(Date.now())]
  );
  return rows.map(mapDose);
}

// ---------------------------------------------------------------------------
// Perfil, ajustes y cuenta
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = { sound: true, vibrate: true, fontScale: 1 }; // fontScale: tamaño de letra (1 = normal)

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
  const token = await db.getFirstAsync("SELECT value FROM app_meta WHERE key = 'remote_auth_token'");
  return { id: u.id, email: u.email || '', provider: u.auth_provider, createdAt: toMs(u.created_at), linked: !!token?.value,
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
    `SELECT u.id, u.auth_provider, u.display_name, c.password_hash, c.password_salt
     FROM app_users u LEFT JOIN local_credentials c ON c.user_id = u.id
     WHERE lower(u.email) = ?`,
    [email.trim().toLowerCase()]
  );
  return r ? { id: r.id, provider: r.auth_provider, name: r.display_name || '', hash: r.password_hash, salt: r.password_salt } : null;
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
  const stamp = iso(nowMs);
  // Cada tratamiento terminado se revisa por separado; devuelve su nombre si se eliminó, o null si se conserva.
  const purgeOne = async (m) => {
    const open = await db.getFirstAsync(
      `SELECT COUNT(*) AS c FROM dose_logs WHERE medication_id = ? AND status = 'pending' AND due_at > ?`, [m.id, stamp]);
    if (open.c > 0) return null; // queda una toma por responder o aplazada
    await db.runAsync('UPDATE medications SET deleted_at = ?, active = 0, updated_at = ? WHERE id = ?', [stamp, stamp, m.id]);
    return m.name;
  };
  const finished = rows.filter((m) => Date.parse(m.start_at) + m.duration_days * DAY <= nowMs); // ya pasó la fecha final
  const names = await Promise.all(finished.map(purgeOne));
  return names.filter(Boolean);
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


// Vincula la identidad autenticada en Render con el usuario LOCAL de SQLite.
// Conserva el ID local para no romper las FK de medicamentos, dosis e historial.
async function linkRemoteAccountImpl({ user, token }) {
  if (!user?.email || !token) throw new Error('La respuesta de autenticación del servidor está incompleta.');
  const db = await getDb();
  const mail = user.email.trim().toLowerCase();
  let id;
  await db.withTransactionAsync(async () => {
    let local = await db.getFirstAsync('SELECT * FROM app_users WHERE lower(email) = ? ORDER BY created_at LIMIT 1', [mail]);
    if (local) {
      id = local.id;
      await db.runAsync(
        `UPDATE app_users SET
           email = ?,
           auth_provider = CASE WHEN auth_provider = 'local' THEN ? ELSE auth_provider END,
           display_name = CASE WHEN display_name IS NULL OR display_name = '' THEN ? ELSE display_name END,
           photo_url = CASE WHEN photo_url IS NULL OR photo_url = '' THEN ? ELSE photo_url END,
           updated_at = ? WHERE id = ?`,
        [mail, user.provider || 'password', user.name || '', user.photoUrl || null, iso(Date.now()), id]
      );
    } else {
      id = await adoptOrCreateUser(db, {
        email: mail, provider: user.provider || 'password', name: user.name || '', photoUrl: user.photoUrl || null,
      });
    }
    await setCurrentUserId(db, id);
    // La fecha de creación de la cuenta es la del servidor (columna created_at de app_users en Postgres).
    if (user.createdAt && !Number.isNaN(Date.parse(user.createdAt))) {
      await db.runAsync('UPDATE app_users SET created_at = ? WHERE id = ?', [iso(Date.parse(user.createdAt)), id]);
    }
    // Usuario nuevo en este teléfono (sin medicamentos ni datos de perfil): el perfil debe venir del servidor,
    // no subirse en blanco. Se marca como sincronizado para que la descarga lo llene.
    const hasData = await db.getFirstAsync(
      `SELECT (SELECT COUNT(*) FROM medications WHERE user_id = ?) AS meds,
              (SELECT (age IS NOT NULL OR height_cm IS NOT NULL OR weight_kg IS NOT NULL OR COALESCE(observations,'') <> '') FROM app_users WHERE id = ?) AS prof`, [id, id]);
    if (!hasData.meds && !hasData.prof) await db.runAsync('UPDATE app_users SET synced_at = ? WHERE id = ?', [iso(Date.now()), id]);
    await db.runAsync("DELETE FROM app_meta WHERE key IN ('last_pull_at', 'last_push_at', 'last_full_push_at')"); // primera descarga y subida completas
    await db.runAsync("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('remote_auth_token', ?)", [token]);
    await db.runAsync("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('remote_user_id', ?)", [String(user.id || '')]);
  });
  return mapUser(await db.getFirstAsync('SELECT * FROM app_users WHERE id = ?', [id]));
}

// Prepara una copia completa e idempotente de los datos del usuario actual.
// Los IDs locales se conservan; el backend los asocia al usuario del JWT.
// Con "since" (texto ISO) solo se incluyen las filas creadas o modificadas después de esa hora (subida incremental);
// sin "since" se envía todo.
async function getSyncSnapshotImpl(since = null) {
  const db = await getDb();
  const uid = await getCurrentUserId(db);
  if (!uid) throw new Error('No hay una sesión local activa.');

  const profileRow = await db.getFirstAsync(
    `SELECT display_name, photo_url, age, height_cm, weight_kg, observations, updated_at, synced_at
     FROM app_users WHERE id = ?`, [uid]
  );
  const medications = await db.getAllAsync(
    `SELECT id, name, active_ingredient, dose, frequency_hours, start_at, duration_days,
            notes, reference_image_url, reference_image_source, schedule_shift_ms,
            active, created_at, updated_at, deleted_at, presentation, stock_units, units_per_dose
     FROM medications WHERE user_id = ? AND (? IS NULL OR updated_at > ?) ORDER BY created_at`, [uid, since, since]
  );
  const doseLogs = await db.getAllAsync(
    `SELECT d.id, d.medication_id, d.scheduled_at, d.due_at, d.status, d.dose_taken,
            d.action_at, d.on_time, d.snooze_count, d.postponed_to, d.auto_skipped,
            d.created_at, d.updated_at
     FROM dose_logs d JOIN medications m ON m.id = d.medication_id
     WHERE m.user_id = ? AND (? IS NULL OR d.updated_at > ?) ORDER BY d.scheduled_at`, [uid, since, since]
  );
  const doseEvents = await db.getAllAsync(
    `SELECT e.id, e.dose_log_id, e.medication_id, e.event_type, e.event_at,
            e.scheduled_at, e.postponed_from, e.postponed_to, e.created_at
     FROM dose_events e JOIN medications m ON m.id = e.medication_id
     WHERE m.user_id = ? AND (? IS NULL OR e.created_at > ?) ORDER BY e.event_at`, [uid, since, since]
  );

  // El perfil solo se envía si tiene cambios sin sincronizar (synced_at NULL); si no, se recibe del servidor.
  const profileDirty = !!profileRow && profileRow.synced_at == null;
  return {
    profile: profileDirty ? {
      display_name: profileRow.display_name || '',
      photo_url: profileRow.photo_url || null,
      age: profileRow.age ?? null,
      height_cm: profileRow.height_cm ?? null,
      weight_kg: profileRow.weight_kg ?? null,
      observations: profileRow.observations || '',
      updated_at: profileRow.updated_at,
    } : null,
    medications,
    doseLogs,
    doseEvents,
  };
}

// Marca el perfil como sincronizado, salvo que la persona lo haya vuelto a editar mientras se enviaba.
async function markProfileSyncedImpl(pushedUpdatedAt) {
  const db = await getDb();
  const uid = await getCurrentUserId(db);
  if (!uid || !pushedUpdatedAt) return;
  await db.runAsync('UPDATE app_users SET synced_at = ? WHERE id = ? AND updated_at <= ?', [iso(Date.now()), uid, pushedUpdatedAt]);
}

// Valores sencillos guardados en app_meta (p. ej. fecha de la última descarga del servidor).
async function getMetaImpl(key) {
  const db = await getDb();
  return (await db.getFirstAsync('SELECT value FROM app_meta WHERE key = ?', [key]))?.value ?? null;
}
async function setMetaImpl(key, value) {
  const db = await getDb();
  if (value == null) await db.runAsync('DELETE FROM app_meta WHERE key = ?', [key]);
  else await db.runAsync('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [key, String(value)]);
}

// Aplica en SQLite lo que llegó del servidor (el servidor es la fuente principal).
// Reglas: una fila local solo se reemplaza si la del servidor es MÁS NUEVA (updated_at); así un cambio hecho
// sin conexión no se pierde (se envía en la próxima subida). Todo ocurre en una sola transacción.
// Devuelve cuántas filas cambiaron en cada tabla.
const num = (v) => (v == null ? null : Number(v));
const flag = (v) => {
  if (v == null) return null;
  return v ? 1 : 0;
};
const newer = (a, b) => Date.parse(a) > Date.parse(b);
const EPOCH = '1970-01-01T00:00:00.000Z';

// --- Perfil: solo si no hay cambios locales pendientes de subir ---
async function applyProfile(db, uid, p, stamp) {
  if (!p) return false;
  const me = await db.getFirstAsync('SELECT synced_at FROM app_users WHERE id = ?', [uid]);
  if (me?.synced_at == null) return false;
  await db.runAsync(
    `UPDATE app_users SET display_name = COALESCE(NULLIF(?, ''), display_name), photo_url = ?, age = ?, height_cm = ?,
       weight_kg = ?, observations = ?, updated_at = ?, synced_at = ? WHERE id = ?`,
    [p.display_name || '', p.photo_url || null, num(p.age), num(p.height_cm), num(p.weight_kg), p.observations || '',
     p.updated_at || stamp, stamp, uid]);
  return true;
}

// Si el horario o la duración cambiaron en otro dispositivo, las tomas pendientes que ya no corresponden se descartan.
// (Las nuevas llegan en este mismo lote o en el siguiente.)
async function discardStalePending(db, local, m, logs) {
  const keep = logs.filter((d) => d.medication_id === m.id).map((d) => d.id);
  const marks = keep.length ? ` AND id NOT IN (${keep.map(() => '?').join(',')})` : '';
  const sql = `DELETE FROM dose_logs WHERE medication_id = ? AND status = 'pending' AND scheduled_at >= ?${marks}`;
  if (local.start_at !== m.start_at || local.frequency_hours !== Number(m.frequency_hours)) {
    await db.runAsync(sql, [m.id, iso(startOfDay(Date.now())), ...keep]);
  } else if ((local.duration_days ?? null) !== num(m.duration_days) && m.duration_days) {
    await db.runAsync(sql, [m.id, iso(Date.parse(m.start_at) + m.duration_days * DAY), ...keep]);
  }
}

// Aplica un medicamento del servidor. Devuelve true si cambió algo en SQLite.
async function applyMedication(db, uid, m, logs, stamp) {
  const local = await db.getFirstAsync('SELECT * FROM medications WHERE id = ?', [m.id]);
  // Mismo medicamento (mismo id) pero guardado bajo OTRO usuario local de este teléfono (p. ej. se cambió el
  // correo de la cuenta): el servidor dice que pertenece a esta sesión, así que se traspasa a este usuario.
  // Sus tomas e historial lo siguen automáticamente (van enlazados por medication_id).
  if (local && local.user_id !== uid) {
    await db.runAsync('UPDATE medications SET user_id = ?, updated_at = ? WHERE id = ?', [uid, EPOCH, m.id]);
    local.updated_at = EPOCH; // fuerza a que se aplique la versión del servidor
  }
  if (local && !newer(m.updated_at, local.updated_at)) return false; // lo local es igual o más nuevo
  const vals = [m.name, m.active_ingredient || null, m.dose, Number(m.frequency_hours), m.start_at, num(m.duration_days),
    m.notes || '', m.reference_image_url || null, m.reference_image_source || null, Number(m.schedule_shift_ms || 0),
    m.active ? 1 : 0, m.updated_at, m.deleted_at || null, m.presentation || null, num(m.stock_units), Number(m.units_per_dose || 1), stamp];
  if (!local) {
    await db.runAsync(
      `INSERT INTO medications (name, active_ingredient, dose, frequency_hours, start_at, duration_days, notes,
         reference_image_url, reference_image_source, schedule_shift_ms, active, updated_at, deleted_at,
         presentation, stock_units, units_per_dose, synced_at, id, user_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [...vals, m.id, uid, m.created_at || stamp]);
    return true;
  }
  await db.runAsync(
    `UPDATE medications SET name=?, active_ingredient=?, dose=?, frequency_hours=?, start_at=?, duration_days=?, notes=?,
       reference_image_url=?, reference_image_source=?, schedule_shift_ms=?, active=?, updated_at=?, deleted_at=?,
       presentation=?, stock_units=?, units_per_dose=?, synced_at=?
     WHERE id=?`, [...vals, m.id]);
  await discardStalePending(db, local, m, logs);
  return true;
}

// Datos de las tomas locales leídos UNA sola vez (en vez de consultar la base por cada fila que llega).
// Con miles de tomas, esto evita miles de consultas y acelera mucho el primer inicio de sesión.
async function loadDoseContext(db, uid) {
  const meds = await db.getAllAsync('SELECT id FROM medications WHERE user_id = ?', [uid]);
  const logs = await db.getAllAsync(
    `SELECT d.id, d.medication_id, d.scheduled_at, d.updated_at FROM dose_logs d
     JOIN medications m ON m.id = d.medication_id WHERE m.user_id = ?`, [uid]);
  return {
    ownedMeds: new Set(meds.map((m) => m.id)),
    logUpdated: new Map(logs.map((l) => [l.id, l.updated_at])),          // id de toma -> updated_at
    slots: new Map(logs.map((l) => [`${l.medication_id}|${l.scheduled_at}`, { id: l.id, updated_at: l.updated_at }])),
  };
}

// Aplica una toma del servidor. Devuelve true si cambió algo en SQLite.
async function applyDoseLog(db, ctx, d, stamp) {
  if (!ctx.ownedMeds.has(d.medication_id)) return false;
  const localUpdated = ctx.logUpdated.get(d.id);
  const vals = [d.due_at, d.status, d.dose_taken || null, d.action_at || null, flag(d.on_time), Number(d.snooze_count || 0),
    d.postponed_to || null, d.auto_skipped ? 1 : 0, d.updated_at, stamp];
  if (localUpdated !== undefined) {
    if (!newer(d.updated_at, localUpdated)) return false;
    await db.runAsync(
      `UPDATE dose_logs SET due_at=?, status=?, dose_taken=?, action_at=?, on_time=?, snooze_count=?, postponed_to=?,
         auto_skipped=?, updated_at=?, synced_at=? WHERE id=?`, [...vals, d.id]);
    ctx.logUpdated.set(d.id, d.updated_at);
    return true;
  }
  // Otra toma local del mismo medicamento y hora (generada sin conexión con otro id): gana la más nueva.
  const slotKey = `${d.medication_id}|${d.scheduled_at}`;
  const clash = ctx.slots.get(slotKey);
  if (clash) {
    if (newer(clash.updated_at, d.updated_at)) return false;
    await db.runAsync('DELETE FROM dose_logs WHERE id = ?', [clash.id]);
    ctx.logUpdated.delete(clash.id);
  }
  await db.runAsync(
    `INSERT INTO dose_logs (due_at, status, dose_taken, action_at, on_time, snooze_count, postponed_to, auto_skipped,
       updated_at, synced_at, id, medication_id, scheduled_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [...vals, d.id, d.medication_id, d.scheduled_at, d.created_at || stamp]);
  ctx.logUpdated.set(d.id, d.updated_at);
  ctx.slots.set(slotKey, { id: d.id, updated_at: d.updated_at });
  return true;
}

// Bitácora de eventos (inmutable: solo se agregan los que faltan). Devuelve cuántas filas se insertaron.
async function applyDoseEvent(db, ctx, e, stamp) {
  if (!ctx.logUpdated.has(e.dose_log_id)) return 0;
  const r = await db.runAsync(
    `INSERT OR IGNORE INTO dose_events (id, dose_log_id, medication_id, event_type, event_at, scheduled_at,
       postponed_from, postponed_to, created_at, synced_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [e.id, e.dose_log_id, e.medication_id, e.event_type, e.event_at, e.scheduled_at, e.postponed_from || null,
     e.postponed_to || null, e.created_at || stamp, stamp]);
  return r.changes || 0;
}

// Aplica una lista en orden y cuenta cuántas filas cambiaron (secuencial a propósito: una sola conexión y
// una sola transacción SQLite, y las filas se comparan contra lo ya escrito).
async function countApplied(list, applyOne) {
  let n = 0;
  for (const item of list) if (await applyOne(item)) n++; // eslint-disable-line no-await-in-loop
  return n;
}

async function applyServerSnapshotImpl(data) {
  const db = await getDb();
  const uid = await getCurrentUserId(db);
  if (!uid) throw new Error('No hay una sesión local activa.');
  const stamp = iso(Date.now());
  const out = { profile: false, medications: 0, doseLogs: 0, doseEvents: 0 };
  const logs = data.doseLogs || [];

  await db.withTransactionAsync(async () => {
    out.profile = await applyProfile(db, uid, data.profile, stamp);
    out.medications = await countApplied(data.medications || [], (m) => applyMedication(db, uid, m, logs, stamp));
    const ctx = await loadDoseContext(db, uid); // se lee después de los medicamentos (pueden cambiar de dueño)
    out.doseLogs = await countApplied(logs, (d) => applyDoseLog(db, ctx, d, stamp));
    for (const e of data.doseEvents || []) out.doseEvents += await applyDoseEvent(db, ctx, e, stamp); // eslint-disable-line no-await-in-loop
    if (data.serverTime) await db.runAsync("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('last_pull_at', ?)", [data.serverTime]);
  });
  return out;
}

async function getRemoteAuthTokenImpl() {
  const db = await getDb();
  const row = await db.getFirstAsync("SELECT value FROM app_meta WHERE key = 'remote_auth_token'");
  return row?.value || null;
}

async function clearRemoteAuthImpl() {
  const db = await getDb();
  await db.runAsync("DELETE FROM app_meta WHERE key IN ('remote_auth_token', 'remote_user_id', 'last_pull_at', 'last_push_at', 'last_full_push_at')");
}

// Cierra la sesión. Con { wipe: true } (cuenta del servidor) también borra la copia local del usuario:
// medicamentos, tomas, historial y perfil (el servidor es la fuente principal y al volver a entrar se descarga todo).
// Las filas hijas se eliminan en cascada.
// Guarda la fecha de creación que informa el servidor (para sesiones iniciadas antes de que se guardara).
async function setAccountCreatedAtImpl(ms) {
  const db = await getDb();
  await db.runAsync('UPDATE app_users SET created_at = ? WHERE id = ?', [iso(ms), await getCurrentUserId(db)]);
}

async function signOutImpl({ wipe = false } = {}) {
  const db = await getDb();
  const uid = await getCurrentUserId(db);
  if (wipe && uid) await db.runAsync('DELETE FROM app_users WHERE id = ?', [uid]);
  await setCurrentUserId(db, null);
  await db.runAsync("DELETE FROM app_meta WHERE key IN ('remote_auth_token', 'remote_user_id', 'last_pull_at', 'last_push_at', 'last_full_push_at')");
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
export const getHistoryRange = (from, to) => serial(() => getHistoryRangeImpl(from, to));
export const getSessionUser = () => serial(getSessionUserImpl);
export const createPasswordAccount = (d) => serial(() => createPasswordAccountImpl(d));
export const findAccount = (email) => serial(() => findAccountImpl(email));
export const linkRemoteAccount = (data) => serial(() => linkRemoteAccountImpl(data));
export const getRemoteAuthToken = () => serial(getRemoteAuthTokenImpl);
export const getSyncSnapshot = (since) => serial(() => getSyncSnapshotImpl(since));
export const clearRemoteAuth = () => serial(clearRemoteAuthImpl);
export const markProfileSynced = (stamp) => serial(() => markProfileSyncedImpl(stamp));
export const getMeta = (k) => serial(() => getMetaImpl(k));
export const setMeta = (k, v) => serial(() => setMetaImpl(k, v));
export const applyServerSnapshot = (data) => serial(() => applyServerSnapshotImpl(data));
export const setPassword = (id, hash, salt) => serial(() => setPasswordImpl(id, hash, salt));
export const purgeFinishedMeds = () => serial(purgeFinishedImpl);
export const startSession = (id) => serial(() => startSessionImpl(id));
export const signInGoogleUser = (g) => serial(() => signInGoogleUserImpl(g));
export const signOutUser = (opts) => serial(() => signOutImpl(opts));
export const getWeekSummary = (days) => serial(() => getWeekSummaryImpl(days));
export const getProfile = () => serial(getProfileImpl);
export const saveProfile = (p) => serial(() => saveProfileImpl(p));
export const getSettings = () => serial(getSettingsImpl);
export const saveSettings = (s) => serial(() => saveSettingsImpl(s));
export const getAccountInfo = () => serial(getAccountInfoImpl);
export const setAccountCreatedAt = (ms) => serial(() => setAccountCreatedAtImpl(ms));
