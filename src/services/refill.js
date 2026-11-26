// Cálculos de stock y de "hora de resurtir" (sin dependencias de UI ni de la base de datos).
//
// Un medicamento puede llevar control de stock: stockUnits = unidades que quedan (null = sin control)
// y unitsPerDose = unidades que se gastan en cada toma. Con eso se sabe cuánto alcanza.
// Se avisa para resurtir cuando faltan REFILL_DAYS días o menos para que se acabe el stock, o para que
// termine el tratamiento.
const HOUR = 3600000;
const DAY = 24 * HOUR;
export const REFILL_DAYS = 2;

// Unidades que se gastan por día con el horario dado.
export const unitsPerDay = (intervalHours, unitsPerDose = 1) => (24 / intervalHours) * unitsPerDose;

// Plan de stock a partir de lo que se escribe en el formulario (sirve para avisar ANTES de guardar).
// Devuelve null si no hay stock. { daysCovered, daysTreatment, shortfall } (shortfall > 0 = faltan unidades).
export function stockPlan({ stockUnits, unitsPerDose = 1, intervalHours, durationDays }) {
  if (stockUnits == null || !intervalHours) return null;
  const perDay = unitsPerDay(intervalHours, unitsPerDose);
  const daysCovered = stockUnits / perDay;
  const needed = durationDays ? Math.ceil(perDay * durationDays) : null;
  return {
    daysCovered,
    daysTreatment: durationDays || null,
    needed,
    shortfall: needed != null ? Math.max(0, needed - stockUnits) : 0,
  };
}

// Estado de un medicamento respecto al stock y al fin del tratamiento.
// Devuelve null si no hay nada que avisar. Si lo hay:
//   { reason: 'stock' | 'treatment', alertAt, runsOutAt, endsAt, unitsLeft, daysLeft, message }
//   alertAt = momento en que empieza a convenir resurtir (ms); si ya pasó, hay que avisar ya.
export function refillInfo(med, now = Date.now()) {
  if (!med?.active) return null;
  const step = med.intervalHours * HOUR;
  const start = Date.parse(med.startAt);
  const endsAt = med.durationDays ? start + med.durationDays * DAY : null;
  if (endsAt != null && endsAt <= now) return null; // el tratamiento ya terminó (la app lo elimina sola)

  // 1) Stock: ¿alcanza hasta el final? ¿cuándo se acaba?
  if (med.stockUnits != null) {
    const per = med.unitsPerDose || 1;
    const dosesLeft = Math.floor(med.stockUnits / per);
    const runsOutAt = now + dosesLeft * step;
    const dosesNeeded = endsAt != null ? Math.ceil((endsAt - Math.max(now, start)) / step) : Infinity;
    const coversTreatment = dosesLeft >= dosesNeeded;
    if (!coversTreatment) {
      return {
        reason: 'stock', alertAt: runsOutAt - REFILL_DAYS * DAY, runsOutAt, endsAt,
        unitsLeft: med.stockUnits, daysLeft: (dosesLeft * step) / DAY,
        message: stockMessage(med, dosesLeft * step),
      };
    }
  }
  // 2) Fin del tratamiento: aviso para pedir la continuación o la nueva fórmula.
  if (endsAt != null) {
    return {
      reason: 'treatment', alertAt: endsAt - REFILL_DAYS * DAY, runsOutAt: null, endsAt,
      unitsLeft: med.stockUnits ?? null, daysLeft: (endsAt - now) / DAY,
      message: `Tu tratamiento con ${med.name} termina ${when(endsAt - now)}. Si tu médico lo continúa, pide la fórmula a tiempo.`,
    };
  }
  return null;
}

// ¿Ya hay que avisar? (faltan REFILL_DAYS días o menos)
export const needsRefillNow = (info, now = Date.now()) => !!info && info.alertAt <= now;

function stockMessage(med, ms) {
  const unit = (med.presentation || 'unidades').toLowerCase();
  const left = med.stockUnits;
  if (left <= 0 || ms <= 0) return `Se acabó ${med.name}. Resurte lo antes posible.`;
  return `A ${med.name} le quedan ${left} ${unit}: alcanza ${when(ms, true)}. Es hora de resurtir.`;
}

// "en 2 días" / "hoy" / "mañana" (o, con alcanza=true, "para 2 días" / "para hoy").
function when(ms, alcanza = false) {
  const days = Math.ceil(ms / DAY);
  if (alcanza) {
    if (days <= 1) return 'para hoy o mañana';
    return `para unos ${days} días`;
  }
  if (days <= 0) return 'hoy';
  if (days === 1) return 'mañana';
  return `en ${days} días`;
}
