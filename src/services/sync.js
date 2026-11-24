// Sincronización en dos sentidos con el servidor (Railway, a través de Render).
//   - La base de datos del servidor es la fuente PRINCIPAL de los datos.
//   - SQLite es la copia local: la app SIEMPRE lee y escribe en SQLite (por eso funciona sin conexión).
//   - Con conexión: 1) se SUBEN los cambios locales (incluidos los hechos sin conexión)
//                   2) se DESCARGAN los cambios del servidor y se aplican en SQLite.
//   - Si hay un conflicto, gana el cambio con updated_at más reciente (ver backend/src/routes/sync.js).
// Cualquier fallo (sin Internet, servidor dormido) deja los datos intactos en el teléfono y se reintenta
// al volver a abrir la app, al volver a primer plano y cada pocos minutos.
import * as repo from '../db/repository';
import { api, hasBackend } from './api';

const OFFLINE = /no se pudo conectar|tardó demasiado/i;

let running = null;   // sincronización en curso (se comparte entre quienes la piden a la vez)
let rerun = false;    // se pidió otra mientras corría: se repite una vez al terminar

const FULL_PUSH_EVERY_MS = 24 * 3600 * 1000; // red de seguridad: una subida completa al día

// Una vuelta: subir y/o bajar. Devuelve { skipped?, pushed, pulled, changed }
//   pullOnly: solo descarga (arranque en un teléfono vacío: lo más rápido para ver los datos)
//   pushOnly: solo sube (cierre de sesión: no hace falta bajar nada)
async function cycle({ timeout, pullOnly = false, pushOnly = false }) {
  const token = await repo.getRemoteAuthToken();
  if (!token) return { skipped: true, reason: 'no_remote_session' };

  // 1) SUBIR (solo lo que cambió desde la última subida; sin cambios no se hace ninguna llamada)
  let pushError = null;
  let pushed = false;
  if (!pullOnly) {
    try {
      const startedAt = new Date().toISOString();
      const lastFull = Number(Date.parse((await repo.getMeta('last_full_push_at')) || '')) || 0;
      const full = Date.now() - lastFull > FULL_PUSH_EVERY_MS;
      const since = full ? null : await repo.getMeta('last_push_at');
      const snapshot = await repo.getSyncSnapshot(since);
      const empty = !snapshot.profile && !snapshot.medications.length && !snapshot.doseLogs.length && !snapshot.doseEvents.length;
      if (!empty) await api('/sync/push', { method: 'POST', body: snapshot, token, timeout });
      if (snapshot.profile) await repo.markProfileSynced(snapshot.profile.updated_at);
      await repo.setMeta('last_push_at', startedAt);
      if (full) await repo.setMeta('last_full_push_at', startedAt);
      pushed = !empty;
    } catch (e) {
      if (OFFLINE.test(e.message || '') || pushOnly) throw e; // sin conexión: tampoco se puede bajar
      pushError = e;                                         // error del servidor: igual se intenta bajar
    }
  }
  if (pushOnly) return { pushed, changed: false };

  // 2) BAJAR (solo lo que cambió desde la última descarga)
  const since = await repo.getMeta('last_pull_at');
  const data = await api(`/sync/pull${since ? `?since=${encodeURIComponent(since)}` : ''}`, { token, timeout });
  const pulled = await repo.applyServerSnapshot(data);
  if (pushError) throw pushError; // se avisa del fallo de subida después de haber bajado lo del servidor

  const changed = pulled.profile || pulled.medications > 0 || pulled.doseLogs > 0 || pulled.doseEvents > 0;
  return { pushed, pulled, changed };
}

export async function syncNow(opts = {}) {
  const { timeout = 90000, pullOnly = false, pushOnly = false } = opts;
  if (!hasBackend()) return { skipped: true, reason: 'backend_unavailable' };
  if (running) { rerun = true; return running; }
  running = (async () => {
    let result = await cycle({ timeout, pullOnly, pushOnly });
    // Hubo cambios mientras se sincronizaba: una vuelta más (máximo una) para no dejarlos para después.
    if (rerun && !result.skipped) { rerun = false; const again = await cycle({ timeout, pullOnly, pushOnly }); result = { ...again, changed: result.changed || again.changed }; }
    return result;
  })();
  try {
    return await running;
  } finally {
    running = null;
    rerun = false;
  }
}
