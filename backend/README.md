# MediRecuerda · Backend (Railway)

API en Node.js (Express) + PostgreSQL. Hoy ofrece:

| Ruta | Para qué |
|---|---|
| `GET /health` | Salud (Railway la usa como *healthcheck*) |
| `POST /auth/register`, `/auth/login` | Cuenta con correo y contraseña (bcrypt) → devuelve `token` JWT |
| `POST /auth/google` | Recibe el `idToken` de Google y lo **verifica** en el servidor |
| `POST /auth/forgot-password`, `/auth/reset-password` | Código de 6 dígitos por correo (vence en 15 min, 5 intentos) |
| `POST /auth/change-password`, `GET /auth/me` | Con `Authorization: Bearer <token>` |
| `POST /ai/chat` | Asistente médico (OpenRouter, instrucciones en `src/prompts.js`) |
| `POST /ai/extract` | Lectura de órdenes médicas con IA |
| `GET /images/search` | Imagen de referencia (Serper → Wikimedia) |

Las rutas distintas de `/health` exigen el encabezado `x-app-key` (si defines `APP_API_KEY`) y tienen límite por IP.

## Desplegar en Railway
1. Sube el repositorio a GitHub.
2. En Railway: **New Project → Deploy from GitHub repo**. En el servicio, **Settings → Root Directory = `backend`**
   (Railway detecta `Dockerfile` y `railway.json`).
3. **+ New → Database → PostgreSQL**.
4. En el servicio del backend, pestaña **Variables**:
   - `DATABASE_URL` = `${{ Postgres.DATABASE_URL }}` (referencia al plugin; usa la red interna, `DATABASE_SSL=false`)
   - `NODE_ENV` = `production`
   - `JWT_SECRET` = resultado de `openssl rand -hex 48`
   - `APP_API_KEY` = una clave larga aleatoria (la misma va en `EXPO_PUBLIC_API_KEY` de la app)
   - `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (por ejemplo `openrouter/free`)
   - Opcionales: `SERPER_API_KEY`, `GOOGLE_WEB_CLIENT_ID`, `RESEND_API_KEY`, `MAIL_FROM`
5. **Settings → Networking → Generate Domain**. La URL (`https://xxxx.up.railway.app`) va en `EXPO_PUBLIC_API_URL` de la app.
6. Al iniciar, el contenedor aplica `migrations/*.sql` (tabla `schema_migrations`) y arranca. Verifica con `https://TU-URL/health` → `{"ok":true}`.

## Desarrollo local
```
cd backend
npm install
cp .env.example .env     # completa DATABASE_URL, JWT_SECRET, claves
npm run migrate
npm run dev
```

## Notas de diseño
- `migrations/001_init.sql` es copia exacta de `database/postgres/schema.sql` (lo verifica `node database/check-schema.mjs`).
  `002_server_auth.sql` agrega solo lo del servidor (hash de contraseña y códigos de recuperación).
- Las claves de IA y de búsqueda **ya no van en la app** cuando se define `EXPO_PUBLIC_API_URL`.
- `x-app-key` va dentro de la app: filtra tráfico casual pero no es un secreto. La protección real de `/ai/*` llega cuando
  la app inicie sesión contra este backend y envíe el JWT (el middleware `optionalUser` ya lo lee; pasar a `requireUser` es un cambio de una línea).
- Pendiente (no construido): sincronización de medicamentos y tomas (`/sync`), y que la app use `/auth/*` en lugar de la cuenta local.
