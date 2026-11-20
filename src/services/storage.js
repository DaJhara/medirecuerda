// Almacenamiento local (AsyncStorage): medicamentos y registro de tomas.
// Todo se guarda en el teléfono; no se envía a ningún servidor.
import AsyncStorage from '@react-native-async-storage/async-storage';

const MEDS_KEY = '@medirecuerda/meds';
const LOG_KEY = '@medirecuerda/log';

// Genera un identificador único sencillo.
export const newId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export async function loadMeds() {
  try {
    const raw = await AsyncStorage.getItem(MEDS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveMeds(meds) {
  await AsyncStorage.setItem(MEDS_KEY, JSON.stringify(meds));
}

// El registro es un objeto: { "<medId>|<timestamp>": { status, at } }
export async function loadLog() {
  try {
    const raw = await AsyncStorage.getItem(LOG_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function saveLog(log) {
  await AsyncStorage.setItem(LOG_KEY, JSON.stringify(log));
}
