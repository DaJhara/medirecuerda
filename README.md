# MediRecuerda (prototipo)

App móvil (Expo SDK 58 + Expo Router) que recuerda tomar medicamentos según la orden médica.

## Instalación
```bash
npm install
npx expo install expo-router react react-native react-native-screens react-native-safe-area-context \
  expo-linking expo-constants expo-status-bar expo-notifications expo-image-picker \
  @react-native-async-storage/async-storage @expo/vector-icons
npx expo start -c
```

## Estructura (Expo Router)
```
app/
  _layout.js          Layout raíz: proveedor de estado + Stack
  (tabs)/
    _layout.js        Pestañas inferiores
    index.js          Hoy            (ruta /)
    meds.js           Medicamentos   (ruta /meds)
    history.js        Historial      (ruta /history)
  med-form.js         Crear/editar medicamento (/med-form?id=...)
  scan.js             Escanear orden con IA (/scan)
src/
  context/AppContext.js   Estado global y acciones
  services/               storage, schedule, notifications, ai
  components/UI.js        Componentes reutilizables
  theme.js                Colores verde/blanco
.env                      Clave y modelo de OpenRouter
```
