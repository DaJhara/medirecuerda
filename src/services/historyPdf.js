// Exporta el historial de tomas a un PDF y abre el menú de compartir/guardar del teléfono.
// Usa expo-print (genera el PDF a partir de HTML) y expo-sharing (compartir o guardar el archivo).
// Ambos se cargan con require() dentro de la función: si el paquete todavía no está instalado en la
// compilación, la app no se cae; solo avisa con un mensaje claro.
import { getHistoryRange } from '../db/repository';
import { fmtTime } from './schedule';

const DAY = 24 * 3600000;
const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const fmtDay = (ms) => new Date(ms).toLocaleDateString('es-CO', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

// Texto del estado de una toma para la tabla.
function statusOf(d) {
  if (d.status === 'taken') return d.onTime ? 'Tomada a tiempo' : 'Tomada con retraso';
  if (d.status === 'skipped') return d.autoSkipped ? 'Omitida (automática)' : 'Omitida';
  return 'Sin respuesta';
}

// Resumen por medicamento: tomadas / omitidas / sin respuesta.
function summarize(doses) {
  const map = new Map();
  for (const d of doses) {
    if (!map.has(d.medId)) map.set(d.medId, { name: d.name, taken: 0, skipped: 0, missed: 0 });
    const row = map.get(d.medId);
    if (d.status === 'taken') row.taken++;
    else if (d.status === 'skipped') row.skipped++;
    else row.missed++;
  }
  return [...map.values()];
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

// Construye el documento HTML del informe.
export function buildHistoryHtml({ doses, days, profile }) {
  const total = doses.length;
  const taken = doses.filter((d) => d.status === 'taken').length;
  const rows = summarize(doses);
  const detail = doses
    .map((d) => `<tr>
      <td>${esc(fmtDay(d.plannedAt))}</td><td>${esc(fmtTime(d.plannedAt))}</td>
      <td>${esc(d.name)}</td><td>${esc(d.dose)}</td><td>${esc(statusOf(d))}</td>
      <td>${d.actionAt ? esc(fmtTime(d.actionAt)) : '—'}</td>
      <td>${d.snoozeCount > 0 ? d.snoozeCount : '—'}</td></tr>`)
    .join('');
  const who = [profile?.fullName, profile?.age ? `${profile.age} años` : null].filter(Boolean).join(' · ');
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
<style>
  body { font-family: Helvetica, Arial, sans-serif; color: #1B2B1E; padding: 24px; font-size: 12px; }
  h1 { color: #2E7D32; margin: 0 0 4px; font-size: 24px; }
  h2 { color: #1B5E20; font-size: 16px; margin: 22px 0 8px; border-bottom: 2px solid #A5D6A7; padding-bottom: 4px; }
  .sub { color: #5F6F63; margin: 0; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #2E7D32; color: #fff; text-align: left; padding: 6px; font-size: 11px; }
  td { padding: 5px 6px; border-bottom: 1px solid #D5E3D7; }
  tr:nth-child(even) td { background: #F4FAF5; }
  .big { font-size: 28px; font-weight: bold; color: #2E7D32; }
</style></head><body>
<h1>MediRecuerda · Historial de tomas</h1>
<p class="sub">${esc(who)}${who ? ' · ' : ''}Últimos ${days} días · Generado el ${esc(new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }))}</p>
<h2>Resumen</h2>
<p><span class="big">${pct(taken, total)}</span> de las tomas realizadas (${taken} de ${total}).</p>
<table><tr><th>Medicamento</th><th>Tomadas</th><th>Omitidas</th><th>Sin respuesta</th><th>Cumplimiento</th></tr>
${rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.taken}</td><td>${r.skipped}</td><td>${r.missed}</td><td>${pct(r.taken, r.taken + r.skipped + r.missed)}</td></tr>`).join('')}
</table>
<h2>Detalle</h2>
${total === 0 ? '<p>No hay tomas registradas en este periodo.</p>' : `<table><tr><th>Fecha</th><th>Hora prevista</th><th>Medicamento</th><th>Dosis</th><th>Estado</th><th>Registrada</th><th>Aplazos</th></tr>${detail}</table>`}
</body></html>`;
}

// El archivo que crea expo-print queda en una carpeta que, en Expo Go y en algunos teléfonos, ni expo-sharing ni
// la API de archivos tienen permiso de leer ("Not allowed to read file" / "Missing READ permission").
// Para no depender de leer ese archivo, se pide el PDF en base64 y se escribe una copia en la caché de la propia
// app; esa copia sí se puede compartir. Si algo falla devuelve null y se intenta con el archivo original.
async function writeToCache(base64) {
  if (!base64) return null;
  try {
    // API clásica (sigue incluida en expo-file-system)
    // eslint-disable-next-line global-require
    const FS = require('expo-file-system/legacy');
    const dest = `${FS.cacheDirectory}Historial-MediRecuerda-${new Date().toISOString().slice(0, 10)}.pdf`;
    await FS.writeAsStringAsync(dest, base64, { encoding: FS.EncodingType.Base64 });
    return dest;
  } catch (e) {
    console.warn('No se pudo guardar el PDF en la caché de la app:', e.message);
    return null;
  }
}

// Genera el PDF de los últimos "days" días y abre el menú de compartir. Lanza Error con mensaje en español.
export async function exportHistoryPdf({ days, profile }) {
  let Print;
  let Sharing;
  try {
    // eslint-disable-next-line global-require
    Print = require('expo-print');
    // eslint-disable-next-line global-require
    Sharing = require('expo-sharing');
  } catch {
    throw new Error('Para descargar el PDF falta instalar "expo-print" y "expo-sharing" y generar de nuevo la app.');
  }
  const to = Date.now() + DAY; // hasta mañana a esta hora (incluye todo lo de hoy)
  const doses = await getHistoryRange(to - (days + 1) * DAY, to);
  const { uri, base64 } = await Print.printToFileAsync({ html: buildHistoryHtml({ doses, days, profile }), base64: true });
  if (!(await Sharing.isAvailableAsync())) throw new Error('Este teléfono no permite compartir archivos.');
  const shareUri = (await writeToCache(base64)) || uri;
  await Sharing.shareAsync(shareUri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Historial de tomas' });
}
