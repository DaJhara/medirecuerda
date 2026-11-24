// Utilidades de fecha/hora y de identificadores compartidas por la base de datos y la UI.

export const MIN = 60000;
export const HOUR = 3600000;
export const DAY = 86400000;

// Milisegundos -> texto ISO 8601 en UTC (formato fijo, se puede ordenar como texto).
export const iso = (ms) => new Date(ms).toISOString();

// Inicio (00:00 local) del día al que pertenece el instante dado.
export function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Clave de día local "AAAA-MM-DD".
export function dayKey(ms) {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// "AAAA-MM-DD" -> milisegundos del inicio de ese día local.
export function parseDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

// Texto legible de la frecuencia: "Cada 8 horas".
export function fmtInterval(hours) {
  return hours === 1 ? 'Cada hora' : `Cada ${hours} horas`;
}

// UUID v4 generado en el cliente (así los registros locales se pueden fusionar luego con Postgres).
export function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.trunc(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
