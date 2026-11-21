// Apertura de la base de datos local (SQLite con expo-sqlite).
// Crea las tablas la primera vez y migra los datos del almacenamiento anterior (AsyncStorage).
import * as SQLite from 'expo-sqlite';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SQLITE_SCHEMA } from './schema';
import { iso, uuid } from '../utils/time';

let dbPromise = null;

// Devuelve siempre la misma conexión (se abre una sola vez).
export function getDb() {
  if (!dbPromise) {
    dbPromise = init().catch((e) => {
      dbPromise = null; // permite reintentar si falló
      throw e;
    });
  }
  return dbPromise;
}

async function init() {
  const db = await SQLite.openDatabaseAsync('medirecuerda.db');
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  await db.execAsync(SQLITE_SCHEMA);
  await ensureLocalUser(db);
  await migrateLegacy(db);
  return db;
}

async function getMeta(db, key) {
  const row = await db.getFirstAsync('SELECT value FROM app_meta WHERE key = ?', [key]);
  return row ? row.value : null;
}

async function setMeta(db, key, value) {
  await db.runAsync('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [key, value]);
}

// Crea el usuario local (un solo usuario por teléfono) y guarda su id.
async function ensureLocalUser(db) {
  if (await getMeta(db, 'local_user_id')) return;
  const id = uuid();
  const now = iso(Date.now());
  await db.runAsync(
    'INSERT INTO app_users (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [id, 'Usuario local', now, now]
  );
  await setMeta(db, 'local_user_id', id);
}

export async function getLocalUserId(db) {
  return getMeta(db, 'local_user_id');
}

// Importa una sola vez los medicamentos guardados por la versión anterior (AsyncStorage).
async function migrateLegacy(db) {
  if (await getMeta(db, 'legacy_migrated')) return;
  try {
    const raw = await AsyncStorage.getItem('@medirecuerda/meds');
    const list = raw ? JSON.parse(raw) : [];
    const userId = await getLocalUserId(db);
    const now = iso(Date.now());
    for (const m of list) {
      if (!m?.name || !m?.startAt) continue;
      await db.runAsync(
        `INSERT INTO medications
           (id, user_id, name, dose, frequency_hours, start_at, duration_days, notes, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuid(), userId, m.name, m.dose || 'Según orden médica', m.intervalHours || 8, m.startAt,
         m.durationDays || null, m.notes || '', m.active === false ? 0 : 1, now, now]
      );
    }
  } catch (e) {
    console.warn('No se pudo migrar el almacenamiento anterior:', e);
  }
  await setMeta(db, 'legacy_migrated', '1');
}
