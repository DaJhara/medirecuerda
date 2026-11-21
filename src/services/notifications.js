// Recordatorios locales con expo-notifications.
// Funcionan sin Internet: se programan en el teléfono para las próximas tomas.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { fmtTime } from './schedule';

// Canal nuevo para aplicar correctamente sonido y vibración en Android.
const CHANNEL_ID = 'medicamentos-v2';

// iOS permite como máximo 64 notificaciones programadas; dejamos margen.
const MAX_SCHEDULED = 60;
const HORIZON_DAYS = 14;

// Define cómo se muestran las notificaciones si la app está abierta.
export function configureNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

// Crea el canal y solicita los permisos necesarios.
export async function ensurePermissions() {
  if (Platform.OS === 'web') return false;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Recordatorios de medicamentos',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      enableVibrate: true,
      vibrationPattern: [0, 500, 250, 500],
    });
  }

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
export async function rescheduleAll(upcoming) {
  if (Platform.OS === 'web') return;

  // Cancelamos los recordatorios anteriores para reconstruirlos.
  await Notifications.cancelAllScheduledNotificationsAsync();

  const now = Date.now();
  const list = upcoming
    .filter((d) => d.dueAt > now)
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, MAX_SCHEDULED);

  for (const d of list) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: d.snoozeCount > 0 ? 'Recordatorio aplazado' : 'Hora de tu medicamento',
        body: `${d.name} · ${d.dose}${d.notes ? ` · ${d.notes}` : ''} (${fmtTime(d.dueAt)})`,
        sound: 'default',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(d.dueAt),
        channelId: CHANNEL_ID,
        ...(Platform.OS === 'android'
          ? { delivery: 'alarmClock' }
          : {}),
      },
    });
  }
}
