// Recordatorios locales con expo-notifications.
// Funcionan sin Internet: se programan en el teléfono para las próximas tomas.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getDoses, fmtTime } from './schedule';

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
export async function rescheduleAll(meds, log) {
  if (Platform.OS === 'web') return;

  // Cancelamos los recordatorios anteriores para reconstruirlos.
  await Notifications.cancelAllScheduledNotificationsAsync();

  const now = new Date();
  const to = new Date(now.getTime() + HORIZON_DAYS * 86400000);

  const upcoming = meds
    .flatMap((m) => getDoses(m, now, to))
    .map((d) => {
      const entry = log[d.key];

      // No programar tomas que ya se realizaron u omitieron.
      if (entry?.status === 'taken' || entry?.status === 'skipped') {
        return null;
      }

      // Si está aplazada, utilizar su nueva hora.
      const scheduledTime =
        entry?.status === 'snoozed' && entry.until
          ? Number(entry.until)
          : d.time;

      return { ...d, scheduledTime };
    })
    .filter((d) => d && d.scheduledTime > now.getTime())
    .sort((a, b) => a.scheduledTime - b.scheduledTime)
    .slice(0, MAX_SCHEDULED);

  for (const d of upcoming) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Hora de tu medicamento',
        body: `${d.med.name} · ${d.med.dose}${d.med.notes ? ` · ${d.med.notes}` : ''} (${fmtTime(d.scheduledTime)})`,
        sound: 'default',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(d.scheduledTime),
        channelId: CHANNEL_ID,
        ...(Platform.OS === 'android'
          ? { delivery: 'alarmClock' }
          : {}),
      },
    });
  }

  console.log(
    'Recordatorios programados:',
    upcoming.map((d) => ({
      medicamento: d.med.name,
      hora: new Date(d.scheduledTime).toLocaleString(),
    }))
  );
}

// Aplaza un recordatorio: programa un aviso extra dentro de N minutos.
export async function scheduleSnooze(med, minutes = 10) {
  if (Platform.OS === 'web') return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Recordatorio aplazado',
      body: `${med.name} · ${med.dose}`,
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: minutes * 60,
      channelId: CHANNEL_ID,
    },
  });
}