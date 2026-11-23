-- =====================================================================
-- MediRecuerda · Esquema PostgreSQL (servidor)
-- Espejo de la copia local en SQLite (src/db/schema.js).
-- Probado con PostgreSQL 13 o superior (gen_random_uuid() viene incluido).
-- Uso:  psql -d medirecuerda -f database/postgres/schema.sql
-- =====================================================================

BEGIN;

-- Estado de una toma programada.
CREATE TYPE dose_status AS ENUM ('pending', 'taken', 'skipped');

-- Tipos de acción registrados en la bitácora.
CREATE TYPE dose_event_type AS ENUM ('snoozed', 'taken', 'skipped', 'auto_skipped', 'undone');

-- ---------------------------------------------------------------------
-- Usuarios (un teléfono = un usuario local; en el servidor puede haber muchos)
-- ---------------------------------------------------------------------
CREATE TABLE app_users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text,                                    -- correo de la cuenta
    auth_provider text NOT NULL DEFAULT 'local'
                  CHECK (auth_provider IN ('local','password','google')),
    google_sub    text,                                    -- id único de la cuenta de Google ("sub")
    display_name  text,                                    -- nombre completo (con apellidos)
    photo_url     text,                                    -- foto de perfil (URL o imagen en base64)
    age           smallint CHECK (age IS NULL OR age BETWEEN 0 AND 120),
    height_cm     numeric(5,1) CHECK (height_cm IS NULL OR height_cm BETWEEN 30 AND 260),
    weight_kg     numeric(5,1) CHECK (weight_kg IS NULL OR weight_kg BETWEEN 1 AND 500),
    observations  text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Medicamentos: nombre, dosis y frecuencia (+ identificación hecha por la IA)
-- ---------------------------------------------------------------------
CREATE TABLE medications (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    name                   text NOT NULL,                      -- nombre del medicamento
    active_ingredient      text,                               -- principio activo (identificado por la IA)
    dose                   text NOT NULL,                      -- dosis por toma, p. ej. "1 tableta"
    frequency_hours        smallint NOT NULL
                           CHECK (frequency_hours BETWEEN 1 AND 24),   -- frecuencia: cada N horas
    start_at               timestamptz NOT NULL,               -- hora de la primera toma
    duration_days          smallint CHECK (duration_days IS NULL OR duration_days > 0),
    notes                  text,
    reference_image_url    text,                               -- imagen de referencia (mercado colombiano)
    reference_image_source text,                               -- sitio de donde se tomó la imagen
    schedule_shift_ms      bigint NOT NULL DEFAULT 0,          -- desplazamiento acumulado por aplazamientos
    active                 boolean NOT NULL DEFAULT true,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    deleted_at             timestamptz                         -- borrado lógico: conserva el historial
);

-- ---------------------------------------------------------------------
-- Registro de tomas (una fila por toma programada)
-- ---------------------------------------------------------------------
CREATE TABLE dose_logs (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    medication_id uuid NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
    scheduled_at  timestamptz NOT NULL,            -- hora INICIAL a la que debía tomarse (no cambia)
    due_at        timestamptz NOT NULL,            -- hora vigente (se mueve al aplazar)
    status        dose_status NOT NULL DEFAULT 'pending',
    dose_taken    text,                            -- dosis tomada (copia de la dosis al momento de tomarla)
    action_at     timestamptz,                     -- hora en que se tomó u omitió
    on_time       boolean,                         -- solo si fue tomada: true = a tiempo
    snooze_count  smallint NOT NULL DEFAULT 0
                  CHECK (snooze_count BETWEEN 0 AND 2),   -- máximo 2 aplazamientos
    postponed_to  timestamptz,                     -- hora a la que quedó aplazada (última)
    auto_skipped  boolean NOT NULL DEFAULT false,  -- true = omitida automáticamente por la app
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (medication_id, scheduled_at),
    CHECK (status = 'pending' OR action_at IS NOT NULL)
);

-- ---------------------------------------------------------------------
-- Bitácora de acciones: cada aplazamiento guarda la hora de origen y la de destino
-- ---------------------------------------------------------------------
CREATE TABLE dose_events (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dose_log_id    uuid NOT NULL REFERENCES dose_logs(id) ON DELETE CASCADE,
    medication_id  uuid NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
    event_type     dose_event_type NOT NULL,
    event_at       timestamptz NOT NULL,           -- hora en que ocurrió la acción
    scheduled_at   timestamptz NOT NULL,           -- hora inicial de la toma
    postponed_from timestamptz,                    -- (aplazar) hora que tenía antes
    postponed_to   timestamptz,                    -- (aplazar) hora a la que quedó
    created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX ux_users_email  ON app_users(lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX ux_users_google ON app_users(google_sub) WHERE google_sub IS NOT NULL;
CREATE INDEX idx_meds_user        ON medications(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_logs_med_sched   ON dose_logs(medication_id, scheduled_at);
CREATE INDEX idx_logs_sched       ON dose_logs(scheduled_at);
CREATE INDEX idx_logs_pending_due ON dose_logs(due_at) WHERE status = 'pending';
CREATE INDEX idx_events_log       ON dose_events(dose_log_id, event_at);

-- ---------------------------------------------------------------------
-- Vista de consulta para reportes: historial de tomas con datos del medicamento.
-- El día se calcula en hora de Colombia.
-- ---------------------------------------------------------------------
CREATE VIEW v_dose_history AS
SELECT  m.user_id,
        m.id                                              AS medication_id,
        m.name                                            AS medication_name,
        m.frequency_hours,
        (d.scheduled_at AT TIME ZONE 'America/Bogota')::date AS day,
        d.id                                              AS dose_log_id,
        d.scheduled_at,                                   -- hora inicial
        d.postponed_to,                                   -- hora a la que quedó aplazada
        d.snooze_count,
        d.status,
        d.dose_taken,
        d.action_at,
        d.on_time,
        d.auto_skipped
FROM    dose_logs d
JOIN    medications m ON m.id = d.medication_id;

COMMIT;
