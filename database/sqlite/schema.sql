-- MediRecuerda · Esquema SQLite (copia local). Generado desde src/db/schema.js: no editar a mano.

CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Usuario: cuenta (correo / Google) + perfil. display_name = nombre completo (con apellidos).
-- Al entrar con Google, nombre y foto se copian aquí la primera vez y luego el usuario puede editarlos.
CREATE TABLE IF NOT EXISTS app_users (
  id            TEXT PRIMARY KEY,
  email         TEXT,
  auth_provider TEXT NOT NULL DEFAULT 'local' CHECK (auth_provider IN ('local','password','google')),
  google_sub    TEXT,
  display_name  TEXT,
  photo_url     TEXT,
  age           INTEGER CHECK (age IS NULL OR age BETWEEN 0 AND 120),
  height_cm     REAL CHECK (height_cm IS NULL OR height_cm BETWEEN 30 AND 260),
  weight_kg     REAL CHECK (weight_kg IS NULL OR weight_kg BETWEEN 1 AND 500),
  observations  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  synced_at     TEXT
);

-- Contraseña de las cuentas creadas con correo EN ESTE TELÉFONO (sal + hash SHA-256).
-- Solo existe en SQLite: nunca se sincroniza. En un servidor real las contraseñas se manejan allí (bcrypt/argon2).
CREATE TABLE IF NOT EXISTS local_credentials (
  user_id       TEXT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- Medicamento: nombre, dosis y frecuencia, más la identificación hecha por la IA.
CREATE TABLE IF NOT EXISTS medications (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  active_ingredient      TEXT,
  dose                   TEXT NOT NULL,
  frequency_hours        INTEGER NOT NULL CHECK (frequency_hours BETWEEN 1 AND 24),
  start_at               TEXT NOT NULL,
  duration_days          INTEGER CHECK (duration_days IS NULL OR duration_days > 0),
  notes                  TEXT,
  presentation           TEXT,
  stock_units            INTEGER CHECK (stock_units IS NULL OR stock_units >= 0),
  units_per_dose         INTEGER NOT NULL DEFAULT 1 CHECK (units_per_dose BETWEEN 1 AND 100),
  reference_image_url    TEXT,
  reference_image_source TEXT,
  schedule_shift_ms      INTEGER NOT NULL DEFAULT 0,
  active                 INTEGER NOT NULL DEFAULT 1,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  deleted_at             TEXT,
  synced_at              TEXT
);

-- Registro de cada toma programada.
--   scheduled_at : hora inicial planeada (nunca cambia)
--   due_at       : hora vigente de la toma (cambia al aplazar)
--   postponed_to : última hora a la que quedó aplazada
CREATE TABLE IF NOT EXISTS dose_logs (
  id            TEXT PRIMARY KEY,
  medication_id TEXT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  scheduled_at  TEXT NOT NULL,
  due_at        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','taken','skipped')),
  dose_taken    TEXT,
  action_at     TEXT,
  on_time       INTEGER,
  snooze_count  INTEGER NOT NULL DEFAULT 0 CHECK (snooze_count BETWEEN 0 AND 2),
  postponed_to  TEXT,
  auto_skipped  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  synced_at     TEXT,
  UNIQUE (medication_id, scheduled_at),
  CHECK (status = 'pending' OR action_at IS NOT NULL)
);

-- Bitácora: una fila por cada acción (cada aplazamiento queda con su hora de origen y destino).
CREATE TABLE IF NOT EXISTS dose_events (
  id              TEXT PRIMARY KEY,
  dose_log_id     TEXT NOT NULL REFERENCES dose_logs(id) ON DELETE CASCADE,
  medication_id   TEXT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL CHECK (event_type IN ('snoozed','taken','skipped','auto_skipped','undone')),
  event_at        TEXT NOT NULL,
  scheduled_at    TEXT NOT NULL,
  postponed_from  TEXT,
  postponed_to    TEXT,
  created_at      TEXT NOT NULL,
  synced_at       TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email  ON app_users(lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_google ON app_users(google_sub) WHERE google_sub IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meds_user        ON medications(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_logs_med_sched   ON dose_logs(medication_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_logs_sched       ON dose_logs(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_logs_pending_due ON dose_logs(due_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_events_log       ON dose_events(dose_log_id, event_at);
CREATE INDEX IF NOT EXISTS idx_logs_unsynced    ON dose_logs(synced_at) WHERE synced_at IS NULL;
