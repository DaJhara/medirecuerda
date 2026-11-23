// Filtros de seguridad: clave de la app, JWT y límites de uso.
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

// Comparación de textos en tiempo constante.
function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Exige que la app envíe x-app-key (si APP_API_KEY está configurada).
export function requireAppKey(req, res, next) {
  if (!config.appApiKey) return next();
  if (same(req.get('x-app-key') || '', config.appApiKey)) return next();
  res.status(401).json({ error: 'Solicitud no autorizada.' });
}

// Crea el token de sesión de un usuario.
export const signToken = (user) =>
  jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

// Lee "Authorization: Bearer ..." si viene; deja req.user o nada.
export function optionalUser(req, _res, next) {
  const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');
  if (m) {
    try {
      const p = jwt.verify(m[1], config.jwtSecret);
      req.user = { id: p.sub, email: p.email };
    } catch { /* token vencido o inválido: se trata como sin sesión */ }
  }
  next();
}

// Exige sesión válida.
export function requireUser(req, res, next) {
  optionalUser(req, res, () => {
    if (!req.user) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
    next();
  });
}

const limiter = (windowMs, limit, error) =>
  rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, message: { error } });

// Límites por IP (Railway está detrás de un proxy: ver app.set('trust proxy') en app.js).
export const generalLimit = limiter(60_000, 120, 'Demasiadas solicitudes. Espera un minuto.');
export const authLimit = limiter(15 * 60_000, 20, 'Demasiados intentos. Espera unos minutos.');
export const aiLimit = limiter(60_000, 12, 'Demasiadas consultas a la IA. Espera un minuto.');
