
## Perfil del usuario (versión con menú lateral)
`app_users` ahora guarda: `display_name` (nombre completo con apellidos), `age`, `height_cm`, `weight_kg` y `observations`.
- SQLite: la app agrega las columnas sola al abrir si la base venía de una versión anterior.
- Postgres ya desplegado: ejecuta `database/postgres/migration_002_profile.sql`. En una instalación nueva basta con `schema.sql`.
- Los ajustes de sonido y vibración son del dispositivo: se guardan en `app_meta` y no se sincronizan.
