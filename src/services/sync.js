// Sincronización de respaldo: SQLite sigue siendo la fuente local de trabajo.
// Cada envío es una copia completa e idempotente; si no hay conexión, los datos
// permanecen en el teléfono y se reintentan al volver a abrir la app.
import * as repo from '../db/repository';
import { api, hasBackend } from './api';

let pendingSync = null;

export async function syncNow() {
  if (pendingSync) return pendingSync;
  pendingSync = (async () => {
    if (!hasBackend()) return { ok: false, skipped: true, reason: 'backend_unavailable' };
    const token = await repo.getRemoteAuthToken();
    if (!token) return { ok: false, skipped: true, reason: 'no_remote_session' };
    const snapshot = await repo.getSyncSnapshot();
    return api('/sync/push', { method: 'POST', body: snapshot, token, timeout: 90000 });
  })();
  try {
    return await pendingSync;
  } finally {
    pendingSync = null;
  }
}
