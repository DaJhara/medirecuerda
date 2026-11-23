// Rutas de IA: POST /ai/chat (asistente médico) y POST /ai/extract (lectura de órdenes médicas).
// Las claves de OpenRouter y las instrucciones de sistema viven aquí, no en la app.
import { Router } from 'express';
import { chatCompletion } from '../services.js';
import { ASSISTANT_PROMPT, EXTRACT_PROMPT } from '../prompts.js';
import { optionalUser, aiLimit } from '../middleware/security.js';

const router = Router();
router.use(aiLimit, optionalUser);

const MAX_HISTORY = 12;
const MAX_MESSAGE = 1500;       // caracteres por mensaje
const MAX_CONTEXT = 3000;
const MAX_IMAGE_B64 = 6_000_000; // ~4.5 MB de imagen

// POST /ai/chat  { messages: [{role, content}], context?: string }  ->  { reply }
router.post('/chat', async (req, res, next) => {
  try {
    const raw = Array.isArray(req.body?.messages) ? req.body.messages : [];
    // Solo se aceptan roles user/assistant (nadie puede inyectar un mensaje "system" desde la app).
    const messages = raw
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE) }));
    if (!messages.length || messages[messages.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'Escribe una pregunta.' });
    }
    const ctx = typeof req.body?.context === 'string' ? req.body.context.slice(0, MAX_CONTEXT) : '';
    const system = ctx
      ? `${ASSISTANT_PROMPT}\n\nCONTEXTO DEL USUARIO (úsalo solo si ayuda a responder una pregunta de salud):\n${ctx}`
      : ASSISTANT_PROMPT;
    const reply = await chatCompletion({ messages: [{ role: 'system', content: system }, ...messages], temperature: 0.3 });
    res.json({ reply });
  } catch (e) { next(e); }
});

// POST /ai/extract  { text?, imageBase64?, mime? }  ->  { content }  (JSON en texto; la app lo interpreta)
router.post('/extract', async (req, res, next) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.slice(0, 8000) : '';
    const img = typeof req.body?.imageBase64 === 'string' ? req.body.imageBase64 : '';
    const mime = /^image\/(jpeg|png|webp)$/.test(req.body?.mime) ? req.body.mime : 'image/jpeg';
    if (!text.trim() && !img) return res.status(400).json({ error: 'Envía el texto o una foto de la orden médica.' });
    if (img.length > MAX_IMAGE_B64) return res.status(413).json({ error: 'La imagen es demasiado grande.' });
    if (img && !/^[A-Za-z0-9+/=\r\n]+$/.test(img)) return res.status(400).json({ error: 'La imagen no es válida.' });

    const content = [{ type: 'text', text: 'Extrae los medicamentos de esta orden médica.' + (text ? `\n\nTexto de la orden:\n${text}` : '') }];
    if (img) content.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${img}` } });
    const out = await chatCompletion({
      messages: [{ role: 'system', content: EXTRACT_PROMPT }, { role: 'user', content }],
      temperature: 0,
    });
    res.json({ content: out });
  } catch (e) { next(e); }
});

export default router;
