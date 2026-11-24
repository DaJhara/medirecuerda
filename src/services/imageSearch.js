// Búsqueda de una imagen de REFERENCIA del medicamento en el mercado colombiano.
//
// Estrategia (en orden):
//   1) Serper (Google Imágenes con gl=co) si hay clave en EXPO_PUBLIC_IMAGE_SEARCH_KEY.
//      Se prefieren resultados de droguerías colombianas.
//   2) Wikimedia Commons (sin clave): imagen genérica del principio activo.
//   3) null -> la app muestra "sin imagen".
// La imagen es solo una guía visual: puede no coincidir con la presentación exacta que
// entrega tu droguería. El usuario siempre debe confiar en su fórmula médica.

import { api, hasBackend } from './api';

const SERPER_KEY = process.env.EXPO_PUBLIC_IMAGE_SEARCH_KEY;

// Dominios de droguerías y cadenas colombianas (se priorizan en los resultados).
const CO_DOMAINS = [
  'farmatodo.com.co', 'drogueriascafam.com.co', 'cruzverde.com.co', 'locatelcolombia.com',
  'larebajavirtual.com', 'farmacenter.com.co', 'olimpica.com', 'exito.com', 'alkosto.com',
  'drogueriasalemana.com', 'copidrogas.com.co', 'pasteur.com.co', 'mercadolibre.com.co',
];

const withTimeout = async (url, options = {}, ms = 12000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

// Busca con Serper (Google Imágenes) enfocado en Colombia.
async function searchSerper(query) {
  const res = await withTimeout('https://google.serper.dev/images', {
    method: 'POST',
    headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, gl: 'co', hl: 'es', num: 10 }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const list = (data.images || []).filter((i) => (i.thumbnailUrl || i.imageUrl || '').startsWith('https://'));
  if (list.length === 0) return null;
  // Primero los de droguerías colombianas; si no hay, el primer resultado (búsqueda ya filtrada por país).
  const local = list.find((i) => CO_DOMAINS.some((d) => (i.domain || i.link || '').includes(d)));
  const pick = local || list[0];
  return {
    // La miniatura de Google carga de forma fiable; la URL original puede bloquear el uso externo.
    url: pick.thumbnailUrl || pick.imageUrl,
    source: pick.domain || (pick.link ? new URL(pick.link).hostname : 'Google Imágenes'),
    colombian: !!local,
  };
}

// Busca una foto genérica en Wikimedia Commons (sin clave).
async function searchWikimedia(query) {
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*' +
    '&generator=search&gsrnamespace=6&gsrlimit=5&prop=imageinfo&iiprop=url|mime&iiurlwidth=400' +
    `&gsrsearch=${encodeURIComponent(query)}`;
  const res = await withTimeout(url);
  if (!res.ok) return null;
  const data = await res.json();
  const pages = Object.values(data?.query?.pages || {});
  const img = pages
    .map((p) => p.imageinfo?.[0])
    .find((i) => i && /^image\/(jpeg|png)$/.test(i.mime || '') && i.thumburl);
  return img ? { url: img.thumburl, source: 'Wikimedia Commons (imagen genérica)', colombian: false } : null;
}

// Devuelve { url, source, colombian } o null. Nunca lanza error.
export async function findReferenceImage({ name, activeIngredient, strength, form }) {
  const base = [name, activeIngredient && !name.toLowerCase().includes(activeIngredient.toLowerCase()) ? activeIngredient : '', strength, form]
    .filter(Boolean)
    .join(' ');
  try {
    if (hasBackend()) {
      // El backend aplica Serper (con su clave) y Wikimedia como respaldo.
      const q = new URLSearchParams({ name, activeIngredient: activeIngredient || '', strength: strength || '', form: form || '' });
      const r = await api(`/images/search?${q}`, { timeout: 20000 });
      return r?.url ? r : null;
    }
    if (SERPER_KEY) {
      const r = await searchSerper(`${base} Colombia droguería`);
      if (r) return r;
    }
    return await searchWikimedia(`${activeIngredient || name} ${form || ''}`.trim());
  } catch (e) {
    console.warn('No se pudo buscar la imagen de referencia:', e?.message);
    return null;
  }
}
