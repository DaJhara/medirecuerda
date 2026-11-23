-- Migración 003: cuenta (correo / Google), foto de perfil y restricciones alineadas con SQLite.
-- Ejecutar SOLO si el esquema de Postgres ya estaba desplegado antes de esta versión:
--   psql -d medirecuerda -f database/postgres/migration_003_auth.sql
BEGIN;

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email         text;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS auth_provider text NOT NULL DEFAULT 'local'
                                              CHECK (auth_provider IN ('local','password','google'));
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS google_sub    text;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS photo_url     text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email  ON app_users(lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_google ON app_users(google_sub)   WHERE google_sub IS NOT NULL;

COMMIT;
