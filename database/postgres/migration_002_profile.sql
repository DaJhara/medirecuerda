-- Migración 002: datos de perfil del usuario.
-- Ejecutar SOLO si el esquema de Postgres ya estaba desplegado antes de esta versión:
--   psql -d medirecuerda -f database/postgres/migration_002_profile.sql
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS age          smallint     CHECK (age BETWEEN 0 AND 120);
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS height_cm    numeric(5,1) CHECK (height_cm BETWEEN 30 AND 260);
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS weight_kg    numeric(5,1) CHECK (weight_kg BETWEEN 1 AND 500);
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS observations text;
