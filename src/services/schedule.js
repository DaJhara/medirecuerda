// Lógica de programación de tomas (sin dependencias de UI).
//
// Un medicamento tiene esta forma:
// {
//   id, name, dose,            // nombre y dosis (texto libre, p. ej. "1 tableta de 500 mg")
//   intervalHours,             // cada cuántas horas se toma (1–24)
//   startAt,                   // ISO de la primera toma
//   durationDays,              // número de días o null (tratamiento continuo)
//   notes, active              // indicaciones y si está activo
// }

const HOUR = 3600000;
const DAY = 24 * HOUR;

// Devuelve las tomas de un medicamento entre dos fechas.
export function getDoses(med, from, to) {
  if (!med.active) return [];
  const step = med.intervalHours * HOUR;
  const start = new Date(med.startAt).getTime();
  const end = med.durationDays ? start + med.durationDays * DAY : Infinity;
  const out = [];
  const first = Math.max(0, Math.ceil((from.getTime() - start) / step));
  for (let t = start + first * step; t <= to.getTime() && t < end; t += step) {
    out.push({ key: `${med.id}|${t}`, medId: med.id, med, time: t });
  }
  return out;
}

// Tomas de un día completo, ordenadas por hora.
export function dosesOfDay(meds, date) {
  const from = new Date(date);
  from.setHours(0, 0, 0, 0);
  const to = new Date(date);
  to.setHours(23, 59, 59, 999);
  return meds
    .flatMap((m) => getDoses(m, from, to))
    .sort((a, b) => a.time - b.time);
}

// Convierte "08:30" o "8.30" en { h, m } o null si no es válido.
export function parseTime(str) {
  const match = /^\s*(\d{1,2})[:.](\d{2})\s*$/.exec(str || '');
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return { h, m };
}

// Fecha ISO de la próxima vez que sea HH:MM (hoy si aún no pasó, si no mañana).
export function nextOccurrence(h, m) {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

// Fecha ISO para HH:MM con un desplazamiento de días (0 = hoy, 1 = mañana).
export function atDayOffset(h, m, offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

export function fmtTime(t) {
  const d = new Date(t);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const suffix = h >= 12 ? 'p. m.' : 'a. m.';
  h = h % 12 || 12;
  return `${h}:${m} ${suffix}`;
}

export function fmtDate(t) {
  const d = new Date(t);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// Fecha de fin del tratamiento (o null si es continuo).
export function endDate(med) {
  if (!med.durationDays) return null;
  return new Date(new Date(med.startAt).getTime() + med.durationDays * DAY);
}
