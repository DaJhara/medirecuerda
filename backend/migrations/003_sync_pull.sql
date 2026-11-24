-- Migración 003 · Descarga incremental (servidor → teléfono).
-- "server_updated_at" lo pone SIEMPRE el servidor cuando guarda una fila: así la descarga incremental
-- no depende del reloj del teléfono (un teléfono con la hora atrasada no puede "esconder" cambios).
ALTER TABLE medications ADD COLUMN IF NOT EXISTS server_updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE dose_logs   ADD COLUMN IF NOT EXISTS server_updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE dose_events ADD COLUMN IF NOT EXISTS server_updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_meds_user_server_upd ON medications(user_id, server_updated_at);
CREATE INDEX IF NOT EXISTS idx_logs_med_server_upd  ON dose_logs(medication_id, server_updated_at);
CREATE INDEX IF NOT EXISTS idx_events_med_server_upd ON dose_events(medication_id, server_updated_at);
