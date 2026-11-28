// Recordatorios locales con expo-notifications.
// Funcionan sin Internet: se programan en el teléfono para las próximas tomas.
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { fmtTime } from './schedule';
import { refillInfo } from './refill';
import { autoSkipWaitMin, SNOOZE_MINUTES } from '../db/repository';

// En Android el sonido y la vibración pertenecen al CANAL y no se pueden cambiar después de creado.
// Por eso hay un canal por cada combinación de ajustes (sonido sí/no x vibración sí/no).
// Cada canal conserva el tono que el usuario elija en los ajustes del sistema.
// El prefijo "v2" crea canales NUEVOS: los de versiones anteriores pudieron quedar creados sin vibración
// (por el modo simplificado de más abajo) y Android no permite corregirlos, solo reemplazarlos.
export const channelIdFor = (settings) =>
  `recordatorios-v2-${settings.sound ? 's1' : 's0'}-${settings.vibrate ? 'v1' : 'v0'}`;

const LEGACY_CHANNELS = ['s0', 's1'].flatMap((snd) => ['v0', 'v1'].map((vib) => `medicamentos-${snd}-${vib}`));

const channelName = (settings) =>
  `Recordatorios de medicamentos (${settings.sound ? 'con sonido' : 'sin sonido'}, ${settings.vibrate ? 'con vibración' : 'sin vibración'})`;

const VIBRATION = [0, 500, 250, 500];

// Canales ya creados en esta sesión (crear el mismo canal otra vez es innecesario).
const createdChannels = new Set();
// Con qué intento se creó el último canal (1 = configuración completa). Sirve para avisar en la prueba.
let lastAttempt = 0;
export const getChannelAttempt = () => lastAttempt;

// Borra los canales de versiones anteriores (una sola vez por sesión) para que no queden en los ajustes del sistema.
let legacyCleaned = false;
async function removeLegacyChannels() {
  if (legacyCleaned) return;
  legacyCleaned = true;
  await Promise.all(LEGACY_CHANNELS.map(async (id) => {
    try { await Notifications.deleteNotificationChannelAsync(id); } catch { /* no existía */ }
  }));
}

// Crea (o reutiliza) el canal de Android que corresponde a los ajustes actuales.
// Algunas versiones del módulo nativo fallan con NullPointerException si se pasan ciertos valores en
// blanco (sound: null, vibrationPattern [0]). Por eso se intenta de lo más completo a lo más simple y
// NUNCA se lanza el error: lo peor que pasa es que el canal use el sonido/vibración por defecto del sistema.
// Devuelve el id del canal que quedó creado, o null si ninguno se pudo crear.
export async function ensureChannel(settings) {
  if (Platform.OS !== 'android') return null;
  const id = channelIdFor(settings);
  if (createdChannels.has(id)) return id;
  await removeLegacyChannels();

  const name = channelName(settings);
  const importance = settings.sound ? Notifications.AndroidImportance.MAX : Notifications.AndroidImportance.HIGH;
  const attempts = [
    // 1) Configuración completa; sin valores null ni patrones vacíos. La vibración se pide siempre de forma
    //    explícita (enableVibrate + patrón) para que Android no use el valor por defecto del fabricante.
    {
      name, importance, enableVibrate: settings.vibrate, enableLights: true, lightColor: '#2E7D32',
      ...(settings.sound ? { sound: 'default' } : {}),
      ...(settings.vibrate ? { vibrationPattern: VIBRATION } : {}),
    },
    // 2) Sin sonido ni patrón personalizados.
    { name, importance, enableVibrate: settings.vibrate },
    // 3) Lo mínimo posible.
    { name, importance: Notifications.AndroidImportance.DEFAULT },
  ];
  let lastError = null;
  for (let i = 0; i < attempts.length; i++) {
    try {
      await Notifications.setNotificationChannelAsync(id, attempts[i]);
      if (i > 0) console.warn(`Canal "${id}" creado con configuración simplificada (intento ${i + 1}).`);
      createdChannels.add(id);
      lastAttempt = i + 1;
      return id;
    } catch (e) {
      lastError = e; // se sigue con el intento más simple
    }
  }
  // Un solo aviso (no uno por intento). En Expo Go de Android el módulo de canales falla incluso con lo mínimo:
  // para probar sonido y vibración hay que usar la app instalada (APK o dev client).
  console.warn(`No se pudo crear el canal "${id}" (${attempts.length} intentos). Último error:`, lastError?.message);
  return null;
}

// iOS permite como máximo 64 notificaciones programadas; dejamos margen.
const MAX_SCHEDULED = 54; // Android admite más, pero iOS solo 64 pendientes: se deja margen para los avisos de resurtir
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

// Cancela todo y vuelve a programar las próximas tomas pendientes (y los avisos de resurtir).
// Recibe las tomas desde la base de datos (cada una con su hora vigente "dueAt") y los medicamentos.
// Como aplazar mueve la hora vigente en la BD, el nuevo aviso se programa automáticamente.
//
// Las llamadas se ponen en FILA: si dos pantallas piden reprogramar a la vez (por ejemplo, al abrir la app y al
// terminar una sincronización), una se ejecutaba a mitad de la otra y cada toma quedaba programada DOS veces
// (notificaciones dobles). Ahora corre una sola a la vez y, si llegaron más, se hace una última con los datos
// más recientes. Además cada aviso tiene un identificador propio, así que nunca se repite.
let running = null;
let nextArgs = null;

export function rescheduleAll(upcoming, settings, meds = []) {
  if (Platform.OS === 'web') return Promise.resolve();
  nextArgs = { upcoming, settings, meds };
  if (!running) running = drain();
  return running;
}

async function drain() {
  try {
    while (nextArgs) {
      const args = nextArgs;
      nextArgs = null;
      try {
        // Una reprogramación a la vez: la siguiente solo empieza cuando termina la anterior.
        await rescheduleNow(args); // NOSONAR: secuencial a propósito
      } catch (e) {
        console.warn('No se pudieron reprogramar los recordatorios:', e.message);
      }
    }
  } finally {
    running = null;
  }
}

// Avisos de una toma: el de su hora y, mientras siga sin respuesta, uno cada SNOOZE_MINUTES hasta que la app la
// omita sola (autoSkipWaitMin: 30 min si no se aplazó, 20 si se aplazó una vez, 10 si ya no hay aplazos).
// Ejemplo sin aplazos y hora 8:00: avisa a las 8:00, 8:10 y 8:20, y a las 8:30 se omite.
function remindersOf(d) {
  const wait = autoSkipWaitMin(d.snoozeCount);
  const list = [{ d, at: d.dueAt, repeat: 0 }];
  for (let k = 1; k * SNOOZE_MINUTES < wait; k++) list.push({ d, at: d.dueAt + k * SNOOZE_MINUTES * 60000, repeat: k });
  return list;
}

// Programa un aviso (identificador fijo: si se repite, reemplaza al anterior y no se duplica).
function scheduleDose({ d, at, repeat }, settings) {
  const notesSuffix = d.notes ? ` · ${d.notes}` : '';
  const skipAt = fmtTime(d.dueAt + autoSkipWaitMin(d.snoozeCount) * 60000);
  let title = 'Hora de tu medicamento';
  if (d.snoozeCount > 0) title = 'Recordatorio aplazado';
  if (repeat > 0) title = 'Aún no registras tu medicamento';
  const body = repeat > 0
    ? `${d.name} · ${d.dose}${notesSuffix}. Si no la marcas, se omitirá a las ${skipAt}.`
    : `${d.name} · ${d.dose}${notesSuffix} (${fmtTime(d.dueAt)})`;
  return Notifications.scheduleNotificationAsync({
    identifier: `dose-${d.id}-${d.dueAt}-r${repeat}`,
    content: {
      title,
      body,
      sound: settings.sound ? 'default' : false,
      vibrate: settings.vibrate ? VIBRATION : undefined, // Android antiguo (antes de los canales)
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(at),
      channelId: channelIdFor(settings),
      ...(Platform.OS === 'android' ? { delivery: 'alarmClock' } : {}),
    },
  });
}

async function rescheduleNow({ upcoming, settings, meds }) {
  await Notifications.cancelAllScheduledNotificationsAsync();

  const now = Date.now();
  // Cada toma aporta su aviso y sus repeticiones; solo se programan los que aún no pasaron, los más próximos primero.
  const list = upcoming
    .flatMap(remindersOf)
    .filter((r) => r.at > now)
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX_SCHEDULED);

  // Las programaciones son independientes entre sí: se lanzan juntas.
  await Promise.all(list.map((r) => scheduleDose(r, settings)));
  await scheduleRefillNotices(meds, settings, now);
  await clearStaleDelivered(upcoming);
}

// Separa "dose-<id>-<hora>-r<n>" en { id, dueAt } (el id tiene guiones, por eso se corta por el final).
function parseDoseIdentifier(identifier) {
  const noPrefix = identifier.slice('dose-'.length);
  const noRepeat = noPrefix.slice(0, noPrefix.lastIndexOf('-r'));
  const cut = noRepeat.lastIndexOf('-');
  return { id: noRepeat.slice(0, cut), dueAt: noRepeat.slice(cut + 1) };
}

// Quita de la bandeja los avisos ya entregados que dejaron de valer: de tomas ya atendidas (tomadas u omitidas) o
// de una hora anterior a la que tienen ahora (aplazadas). Así no se acumulan avisos viejos. Nunca lanza error.
async function clearStaleDelivered(upcoming) {
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    const current = new Map(upcoming.map((d) => [d.id, String(d.dueAt)]));
    const stale = shown
      .map((n) => n.request.identifier)
      .filter((identifier) => {
        if (!identifier.startsWith('dose-')) return false;
        const { id, dueAt } = parseDoseIdentifier(identifier);
        return current.get(id) !== dueAt;
      });
    await Promise.all(stale.map((identifier) => Notifications.dismissNotificationAsync(identifier)));
  } catch {
    /* no se pudo leer la bandeja: no es grave */
  }
}

// Aviso de resurtir: el primer día que faltan REFILL_DAYS días o menos (a las 9:00). Si ya faltan menos, se
// avisa en la próxima mañana. Cada vez que se reprograma se recalcula con el stock actual.
const REFILL_HOUR = 9;
// Programa el aviso de resurtir de un medicamento; devuelve null si no hace falta ninguno.
function scheduleRefill(m, settings, now) {
  const info = refillInfo(m, now);
  if (!info) return null;
  const at = new Date(Math.max(info.alertAt, now));
  at.setHours(REFILL_HOUR, 0, 0, 0);
  if (at.getTime() <= now) at.setDate(at.getDate() + 1);
  if (info.endsAt != null && at.getTime() >= info.endsAt) return null; // el tratamiento ya habrá terminado
  return Notifications.scheduleNotificationAsync({
    identifier: `refill-${m.id}`,
    content: {
      title: info.reason === 'stock' ? 'Hora de resurtir' : 'Tu tratamiento está por terminar',
      body: info.message,
      sound: settings.sound ? 'default' : false,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: at,
      channelId: channelIdFor(settings),
    },
  });
}

async function scheduleRefillNotices(meds, settings, now) {
  await Promise.all(meds.map((m) => scheduleRefill(m, settings, now)));
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
      vibrate: settings.vibrate ? VIBRATION : undefined,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 5,
      channelId: channelIdFor(settings),
    },
  });
}
