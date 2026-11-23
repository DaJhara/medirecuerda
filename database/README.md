
## Perfil del usuario (versión con menú lateral)
`app_users` ahora guarda: `display_name` (nombre completo con apellidos), `age`, `height_cm`, `weight_kg` y `observations`.
- SQLite: la app agrega las columnas sola al abrir si la base venía de una versión anterior.
- Postgres ya desplegado: ejecuta `database/postgres/migration_002_profile.sql`. En una instalación nueva basta con `schema.sql`.
- Los ajustes de sonido y vibración son del dispositivo: se guardan en `app_meta` y no se sincronizan.

## Autenticación y verificación (v3)
- `database/postgres/migration_003_auth.sql`: columnas de usuario (correo, proveedor, Google, nombre, foto) y restricciones nuevas.
- La app migra SQLite sola al abrir (`migrateSchema` en `src/db/database.js`).
- `node database/check-schema.mjs` comprueba que `src/db/schema.js` y `database/sqlite/schema.sql` sean idénticos y que SQLite y PostgreSQL tengan las mismas tablas/columnas.
  Con `--write` regenera `database/sqlite/schema.sql` desde `schema.js`.
