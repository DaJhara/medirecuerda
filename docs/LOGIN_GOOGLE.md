# Iniciar sesión con una cuenta real de Google

El botón "Continuar con Google" usa `@react-native-google-signin/google-signin` (módulo nativo).
**No funciona en Expo Go ni en la versión web**: necesita un *development build* (EAS).

## 1. Instalar dependencias
```
npx expo install expo-crypto @react-native-google-signin/google-signin expo-image-manipulator
```

## 2. Google Cloud Console (https://console.cloud.google.com)
1. Crea un proyecto (o usa uno existente).
2. **APIs y servicios → Pantalla de consentimiento OAuth**: tipo *Externo*, nombre "MediRecuerda",
   correo de soporte. Mientras esté en modo *Pruebas*, agrega en **Usuarios de prueba** los correos
   Gmail que van a entrar (máx. 100). Para cualquier usuario, hay que publicar la app (verificación de Google).
3. **Credenciales → Crear credenciales → ID de cliente de OAuth**:
   - **Aplicación web** → copia el *Client ID* a `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` en `.env`.
     (Este es el que usa la app para pedir el `idToken`.)
   - **Android** → paquete `com.medirecuerda.app` + huella **SHA-1**.
     - Build de desarrollo/EAS: `eas credentials` (Android → keystore) muestra el SHA-1.
     - Local: `cd android && ./gradlew signingReport`.
     - Si publicas en Google Play con "firma de Play", añade también el SHA-1 de *Firma de apps* de la consola de Play.
   - **iOS** (opcional) → bundle id de `app.json`; copia el *iOS client ID* a `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`.

## 3. Configurar el plugin (solo iOS)
En `app.json`, dentro de `plugins`:
```json
["@react-native-google-signin/google-signin", { "iosUrlScheme": "com.googleusercontent.apps.XXXXXXXX" }]
```
(el valor es el *client ID de iOS* al revés). En Android basta con agregar el plugin sin opciones.

## 4. Recompilar
```
npx eas build --profile development --platform android
```
Instala el APK, ejecuta `npx expo start --dev-client` y prueba el botón.

## 5. Errores comunes
| Mensaje | Causa |
|---|---|
| `DEVELOPER_ERROR` / código 10 | SHA-1 o paquete del cliente Android no coinciden con la app instalada |
| "Aún no está configurado" | Falta `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (reinicia con `npx expo start -c`) |
| "Acceso bloqueado" | La app está en modo *Pruebas* y el correo no está en *Usuarios de prueba* |
| "Esta compilación no incluye Google" | Se usa Expo Go o un build anterior a instalar el módulo |

## 6. Qué hace hoy y qué falta para producción
Hoy la app lee nombre, correo y foto de la cuenta y crea el usuario **en el teléfono**. Para que la misma
cuenta funcione en varios dispositivos, el `idToken` debe enviarse a un **backend** que lo verifique
(`google-auth-library`, `audience` = Web client ID), cree/busque el usuario en PostgreSQL y devuelva su propia sesión.
Ese backend aún no existe (ver `docs/DESPLIEGUE.md`).
