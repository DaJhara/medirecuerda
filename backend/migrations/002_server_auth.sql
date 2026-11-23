-- Migración 002 · Autenticación en el servidor (solo existe en PostgreSQL, nunca en el teléfono).
-- La contraseña del servidor se guarda con bcrypt (columna password_hash); el teléfono guarda la suya aparte.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS password_hash text;

-- Códigos de recuperación de contraseña ("Olvidé mi contraseña"): se guarda solo el hash del código.
CREATE TABLE IF NOT EXISTS password_resets (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    code_hash   text NOT NULL,
    expires_at  timestamptz NOT NULL,
    attempts    integer NOT NULL DEFAULT 0,
    used_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_resets_user ON password_resets(user_id, created_at DESC);
