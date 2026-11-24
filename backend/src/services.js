// Servicios externos: OpenRouter (IA), Serper/Wikimedia (imágenes) y Resend (correo).
import { config } from './config.js';

// fetch con tiempo máximo.
async function timed(url, options = {}, ms = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const httpError = (status, message) => Object.assign(new Error(message), { status });

// ---------------- OpenRouter ----------------
// Devuelve el texto de la respuesta del modelo.
export async function chatCompletion({ messages, temperature = 0.3 }) {
  if (!config.openrouterKey) throw httpError(503, 'La IA no está configurada en el servidor.');
  let res;
  try {
    res = await timed('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openrouterKey}`, 'Content-Type': 'application/json', 'X-Title': 'MediRecuerda' },
      body: JSON.stringify({ model: config.openrouterModel, temperature, messages }),
    }, 90000);
  } catch (e) {
    throw httpError(504, e.name === 'AbortError' ? 'La IA tardó demasiado. Intenta de nuevo.' : 'No se pudo conectar con la IA.');
  }
  if (!res.ok) {
    if (res.status === 429) throw httpError(429, 'Se alcanzó el límite del modelo. Espera un momento e intenta de nuevo.');
    console.error('OpenRouter respondió', res.status);
    throw httpError(502, 'El servicio de IA respondió con error.');
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw httpError(502, 'La IA no devolvió respuesta.');
  return text;
}

// ---------------- Imágenes ----------------
const CO_DOMAINS = [
  'farmatodo.com.co', 'drogueriascafam.com.co', 'cruzverde.com.co', 'locatelcolombia.com',
  'larebajavirtual.com', 'farmacenter.com.co', 'olimpica.com', 'exito.com', 'alkosto.com',
  'drogueriasalemana.com', 'copidrogas.com.co', 'pasteur.com.co', 'mercadolibre.com.co',
];

async function serper(query) {
  const res = await timed('https://google.serper.dev/images', {
    method: 'POST',
    headers: { 'X-API-KEY': config.serperKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, gl: 'co', hl: 'es', num: 10 }),
  }, 12000);
  if (!res.ok) return null;
  const list = ((await res.json()).images || []).filter((i) => (i.thumbnailUrl || i.imageUrl || '').startsWith('https://'));
  if (!list.length) return null;
  const local = list.find((i) => CO_DOMAINS.some((d) => (i.domain || i.link || '').includes(d)));
  const pick = local || list[0];
  let source = pick.domain;
  if (!source && pick.link) { try { source = new URL(pick.link).hostname; } catch { /* enlace no válido */ } }
  return { url: pick.thumbnailUrl || pick.imageUrl, source: source || 'Google Imágenes', colombian: !!local };
}

async function wikimedia(query) {
  const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=5' +
    `&prop=imageinfo&iiprop=url|mime&iiurlwidth=400&gsrsearch=${encodeURIComponent(query)}`;
  const res = await timed(url, { headers: { 'User-Agent': 'MediRecuerda/0.1 (backend)' } }, 12000);
  if (!res.ok) return null;
  const pages = Object.values((await res.json())?.query?.pages || {});
  const img = pages.map((p) => p.imageinfo?.[0]).find((i) => i && /^image\/(jpeg|png)$/.test(i.mime || '') && i.thumburl);
  return img ? { url: img.thumburl, source: 'Wikimedia Commons (imagen genérica)', colombian: false } : null;
}

// Devuelve { url, source, colombian } o null. Nunca lanza error.
export async function findImage({ name, activeIngredient, strength, form }) {
  const base = [name, activeIngredient && !name.toLowerCase().includes(activeIngredient.toLowerCase()) ? activeIngredient : '', strength, form].filter(Boolean).join(' ');
  try {
    if (config.serperKey) {
      const r = await serper(`${base} Colombia droguería`);
      if (r) return r;
    }
    return await wikimedia(`${activeIngredient || name} ${form || ''}`.trim());
  } catch (e) {
    console.warn('Búsqueda de imagen falló:', e.message);
    return null;
  }
}

// ---------------- Correo (Resend) ----------------
export async function sendMail({ to, subject, text }) {
  if (!config.resendKey) {
    // Sin proveedor de correo: solo para pruebas. NUNCA imprimir códigos en producción.
    if (!config.isProd) console.log(`[correo simulado] Para: ${to} | ${subject}\n${text}`);
    else console.warn('RESEND_API_KEY no configurada: no se envió el correo de recuperación.');
    return false;
  }
  const res = await timed('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.mailFrom, to: [to], subject, text }),
  }, 15000);
  if (!res.ok) console.error('Resend respondió', res.status);
  return res.ok;
}
