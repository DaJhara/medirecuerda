// Recordatorios locales con expo-notifications.
// Funcionan sin Internet: se programan en el teléfono para las próximas tomas.
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { fmtTime } from './schedule';

// En Android el sonido y la vibración pertenecen al CANAL y no se pueden cambiar después de creado.
// Por eso hay un canal por cada combinación de ajustes (sonido sí/no x vibración sí/no).
// Cada canal conserva el tono que el usuario elija en los ajustes del sistema.
export const channelIdFor = (settings) =>
  `medicamentos-${settings.sound ? 's1' : 's0'}-${settings.vibrate ? 'v1' : 'v0'}`;

const channelName = (settings) =>
  `Recordatorios de medicamentos (${settings.sound ? 'con sonido' : 'sin sonido'}, ${settings.vibrate ? 'con vibración' : 'sin vibración'})`;

// Canales ya creados en esta sesión (crear el mismo canal otra vez es innecesario).
const createdChannels = new Set();

// Crea (o reutiliza) el canal de Android que corresponde a los ajustes actuales.
// Algunas versiones del módulo nativo fallan con NullPointerException si se pasan ciertos valores en
// blanco (sound: null, vibrationPattern [0]). Por eso se intenta de lo más completo a lo más simple y
// NUNCA se lanza el error: lo peor que pasa es que el canal use el sonido/vibración por defecto del sistema.
// Devuelve el id del canal que quedó creado, o null si ninguno se pudo crear.
export async function ensureChannel(settings) {
  if (Platform.OS !== 'android') return null;
  const id = channelIdFor(settings);
  if (createdChannels.has(id)) return id;

  const name = channelName(settings);
  const attempts = [
    // 1) Configuración completa; sin valores null ni patrones vacíos.
    {
      name,
      importance: settings.sound ? Notifications.AndroidImportance.MAX : Notifications.AndroidImportance.LOW,
      enableVibrate: settings.vibrate,
      ...(settings.sound ? { sound: 'default' } : {}),
      ...(settings.vibrate ? { vibrationPattern: [0, 500, 250, 500] } : {}),
    },
    // 2) Sin sonido ni patrón personalizados.
    { name, importance: settings.sound ? Notifications.AndroidImportance.MAX : Notifications.AndroidImportance.LOW, enableVibrate: settings.vibrate },
    // 3) Lo mínimo posible.
    { name, importance: Notifications.AndroidImportance.DEFAULT },
  ];
  for (let i = 0; i < attempts.length; i++) {
    try {
      await Notifications.setNotificationChannelAsync(id, attempts[i]);
      if (i > 0) console.warn(`Canal "${id}" creado con configuración simplificada (intento ${i + 1}).`);
      createdChannels.add(id);
      return id;
    } catch (e) {
      console.warn(`No se pudo crear el canal "${id}" (intento ${i + 1}/${attempts.length}):`, e.message);
    }
  }
  return null;
}

// iOS permite como máximo 64 notificaciones programadas; dejamos margen.
const MAX_SCHEDULED = 60;
const HORIZON_DAYS = 14;

// Define cómo se muestran las notificaciones si la app está abierta.
export function configureNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true, // el sonido real lo decide el canal (Android) o el contenido (iOS)
      shouldSetBadge: false,
    }),
  });
}

// Crea el canal y solicita los permisos necesarios.
export async function ensurePermissions(settings) {
  if (Platform.OS === 'web') return false;

  await ensureChannel(settings);

  let permission = await Notifications.getPermissionsAsync();

  if (!permission.granted) {
    permission = await Notifications.requestPermissionsAsync();
  }

  if (!permission.granted) {
    console.warn('No se concedió el permiso para mostrar notificaciones.');
    return false;
  }

  // En Android 12 o superior, comprobamos el permiso de alarmas exactas.
  if (Platform.OS === 'android') {
    try {
      const exactPermission =
        await Notifications.getExactAlarmPermissionsAsync();

      if (!exactPermission.granted) {
        await Notifications.requestExactAlarmPermissionsAsync();
      }
    } catch (error) {
      console.warn('No se pudo habilitar el permiso de alarmas exactas:', error);
    }
  }

  return true;
}

// Cancela todo y vuelve a programar las próximas tomas pendientes.
// Recibe las tomas desde la base de datos (cada una con su hora vigente "dueAt").
// Como aplazar mueve la hora vigente en la BD, el nuevo aviso se programa automáticamente.
export async function rescheduleAll(upcoming, settings) {
  if (Platform.OS === 'web') return;

  // Cancelamos los recordatorios anteriores para reconstruirlos.
  await Notifications.cancelAllScheduledNotificationsAsync();

  const now = Date.now();
  const list = upcoming
    .filter((d) => d.dueAt > now)
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, MAX_SCHEDULED);

  for (const d of list) {
    const notesSuffix = d.notes ? ` · ${d.notes}` : '';
    await Notifications.scheduleNotificationAsync({
      content: {
        title: d.snoozeCount > 0 ? 'Recordatorio aplazado' : 'Hora de tu medicamento',
        body: `${d.name} · ${d.dose}${notesSuffix} (${fmtTime(d.dueAt)})`,
        sound: settings.sound ? 'default' : false,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(d.dueAt),
        channelId: channelIdFor(settings),
        ...(Platform.OS === 'android'
          ? { delivery: 'alarmClock' }
          : {}),
      },
    });
  }
}

// Abre los ajustes del sistema del canal para ELEGIR UN TONO del celular.
// (Android no permite listar los tonos desde la app; el selector oficial está en los ajustes del canal.)
export async function openToneSettings(settings) {
  if (Platform.OS !== 'android') return false;
  await ensureChannel(settings); // el canal debe existir para poder abrirlo
  // En Expo Go los canales pertenecen a Expo Go; en una build propia, a la app.
  const pkg = Constants.executionEnvironment === ExecutionEnvironment.StoreClient ? 'host.exp.exponent' : 'com.medirecuerda.app';
  try {
    await Linking.sendIntent('android.settings.CHANNEL_NOTIFICATION_SETTINGS', [
      { key: 'android.provider.extra.APP_PACKAGE', value: pkg },
      { key: 'android.provider.extra.CHANNEL_ID', value: channelIdFor(settings) },
    ]);
  } catch {
    await Linking.openSettings(); // respaldo: ajustes generales de la app
  }
  return true;
}

// Notificación de prueba a los 5 segundos para oír/sentir los ajustes actuales.
export async function sendTestNotification(settings) {
  if (Platform.OS === 'web') return;
  await ensureChannel(settings);
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Prueba de recordatorio',
      body: 'Así sonará y vibrará tu recordatorio de medicamentos.',
      sound: settings.sound ? 'default' : false,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 5,
      channelId: channelIdFor(settings),
    },
  });
}
