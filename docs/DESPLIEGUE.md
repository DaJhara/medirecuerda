# ¿Está listo para desplegarse en línea?

**No todavía.** La app funciona como prototipo local (todo en el teléfono). Para producción falta:

| Área | Estado | Falta |
|---|---|---|
| Backend / API | No existe | Servicio (Node, etc.) con PostgreSQL, endpoints de usuarios, medicamentos y dosis |
| Autenticación | Local (hash SHA-256 con sal en el teléfono) | Auth en servidor: contraseñas con argon2/bcrypt, verificación del `idToken` de Google, sesiones/JWT, recuperar contraseña |
| Sincronización | Columnas `synced_at` listas | Lógica de subida/bajada y resolución de conflictos |
| Claves de IA/imágenes | `EXPO_PUBLIC_*` van **dentro** del APK (extraíbles) | Mover OpenRouter y Serper al backend (proxy) con límites por usuario |
| Asistente médico | Restricción por instrucciones (no infalible) | Filtro en servidor, registro y límites de uso, revisión clínica |
| Base de datos Postgres | Esquema y `migration_003_auth.sql` escritos | Desplegar, probar migraciones, respaldos, cifrado, política de privacidad (Ley 1581 de 2012, datos de salud = sensibles) |
| Google | Código listo | Configuración en Google Cloud y publicación/verificación de la pantalla de consentimiento |
| Tiendas | `eas.json` presente | Íconos finales, política de privacidad, pruebas en dispositivos reales |

Importante: la clave de OpenRouter que se compartió en el chat quedó expuesta; revócala y crea otra.


## Actualización: backend para Railway
La carpeta `backend/` contiene un servidor listo para Railway (Dockerfile, `railway.json`, migraciones, healthcheck).
Pasos en `backend/README.md`. Con él, las claves de IA salen de la app. Sigue pendiente que la app inicie sesión contra el
backend (hoy las cuentas son locales) y la sincronización de datos.
