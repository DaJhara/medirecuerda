// Servicio de IA (OpenRouter): extrae los medicamentos de una orden médica
// a partir de una foto y/o de texto pegado, y la IDENTIFICA (principio activo, concentración y forma).
//
// IMPORTANTE (prototipo): la clave viaja dentro de la app porque Expo incluye las
// variables EXPO_PUBLIC_* en el paquete. Para producción, mueve esta llamada a un
// backend propio (p. ej. Node.js) que guarde la clave.

import { api, hasBackend } from './api';

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const API_KEY = process.env.EXPO_PUBLIC_OPENROUTER_API_KEY;
const MODEL = process.env.EXPO_PUBLIC_OPENROUTER_MODEL || 'openrouter/free';

const SYSTEM_PROMPT = `Eres un asistente que transcribe órdenes médicas (fórmulas) a datos estructurados e IDENTIFICA cada medicamento.
NO das consejos médicos ni cambias dosis: solo extraes lo que está escrito.
Responde ÚNICAMENTE con JSON válido, sin texto adicional ni markdown, con este formato:
{"medications":[{"name":"string","activeIngredient":"string","strength":"string","form":"string","dose":"string","intervalHours":number,"durationDays":number|null,"notes":"string"}]}
Reglas:
- "name": nombre del medicamento tal como aparece en la orden (comercial o genérico).
- "activeIngredient": principio activo en español (genérico). Si el nombre es comercial, identifica su principio activo; si no estás seguro, deja "".
- "strength": concentración (p. ej. "500 mg", "50 mg/5 ml") o "".
- "form": forma farmacéutica (tableta, cápsula, jarabe, gotas, crema, inyectable, etc.) o "".
- "dose": cantidad por toma (p. ej. "1 tableta", "5 ml", "2 gotas").
- "intervalHours": cada cuántas horas se toma. "cada 8 horas"=8; "3 veces al día"=8; "2 veces al día"=12; "1 vez al día"=24; "cada 6 horas"=6.
- "durationDays": días de tratamiento (p. ej. "por 7 días"=7, "por 2 semanas"=14, "1 mes"=30). Usa null si es continuo o no se indica.
- "notes": indicaciones especiales (con comida, en ayunas, antes de dormir) o "" si no hay.
- Si no hay medicamentos legibles, responde {"medications":[]}.`;

// Llama al modelo. Recibe { text, imageBase64, mime } (al menos uno).
export async function analyzePrescription({ text, imageBase64, mime = 'image/jpeg' }) {
  // Con backend: POST /ai/extract devuelve el texto del modelo y aquí se normaliza igual que sin backend.
  if (hasBackend()) {
    const out = await api('/ai/extract', { method: 'POST', body: { text, imageBase64, mime } });
    if (!out?.content) throw new Error('La IA no devolvió contenido. Intenta de nuevo.');
    return parseMedications(out.content);
  }
  if (!API_KEY) {
    throw new Error('Falta la clave de OpenRouter. Revisa el archivo .env y reinicia con "npx expo start -c".');
  }

  // Contenido del mensaje del usuario: instrucciones + texto + imagen (opcional).
  const content = [
    { type: 'text', text: 'Extrae los medicamentos de esta orden médica.' + (text ? `\n\nTexto de la orden:\n${text}` : '') },
  ];
  if (imageBase64) {
    content.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } });
  }

  // Cancela la petición si tarda más de 90 s (los modelos gratuitos pueden ser lentos).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);

  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'X-Title': 'MediRecuerda',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content },
        ],
      }),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('La IA tardó demasiado. Intenta de nuevo.');
    throw new Error('No se pudo conectar con el servicio de IA. Revisa tu conexión a Internet.');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    if (res.status === 401) throw new Error('La clave de OpenRouter no es válida.');
    if (res.status === 429) throw new Error('Se alcanzó el límite del modelo gratuito. Espera un momento e intenta de nuevo.');
    throw new Error(`El servicio de IA respondió con error (${res.status}).`);
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) throw new Error('La IA no devolvió contenido. Intenta de nuevo.');
  return parseMedications(raw);
}

// Extrae y normaliza el JSON de la respuesta (los modelos a veces añaden texto extra).
export function parseMedications(raw) {
  // Del primer "{" al último "}" (sin expresiones regulares: evita el costo de backtracking).
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No pude interpretar la respuesta de la IA.');
  let json;
  try {
    json = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error('La respuesta de la IA no tiene el formato esperado.');
  }
  const list = Array.isArray(json.medications) ? json.medications : [];
  return list
    .filter((m) => m?.name)
    .map((m) => {
      const interval = Math.round(Number(m.intervalHours));
      const days = Math.round(Number(m.durationDays));
      return {
        name: String(m.name).trim(),
        activeIngredient: String(m.activeIngredient || '').trim(),
        strength: String(m.strength || '').trim(),
        form: String(m.form || '').trim(),
        dose: String(m.dose || '').trim(),
        intervalHours: interval >= 1 && interval <= 24 ? interval : 8,
        durationDays: days > 0 ? days : null,
        notes: String(m.notes || '').trim(),
      };
    });
}
