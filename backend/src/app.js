// Aplicación Express: seguridad, rutas y manejo de errores. (server.js la pone a escuchar.)
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config.js';
import { query } from './db.js';
import { requireAppKey, generalLimit } from './middleware/security.js';
import authRoutes from './routes/auth.js';
import aiRoutes from './routes/ai.js';
import imageRoutes from './routes/images.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Railway pone un proxy delante: así el límite por IP usa la IP real
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins.length ? config.corsOrigins : false })); // la app móvil no usa CORS
  app.use(express.json({ limit: '8mb' })); // las fotos de órdenes médicas van en base64

  // Salud: Railway lo consulta para saber si el servicio está vivo. No requiere clave.
  app.get('/health', async (_req, res) => {
    try {
      await query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false, error: 'Base de datos no disponible.' });
    }
  });
  app.get('/', (_req, res) => res.json({ name: 'MediRecuerda API', status: 'ok' }));

  // Todo lo demás exige la clave de la app (si está configurada) y tiene límite por IP.
  app.use(requireAppKey, generalLimit);
  app.use('/auth', authRoutes);
  app.use('/ai', aiRoutes);
  app.use('/images', imageRoutes);

  app.use((_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

  // Errores: los de servicios traen "status" y mensaje seguro; el resto se registran y se oculta el detalle.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'La solicitud es demasiado grande.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON no válido.' });
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Error no controlado:', err);
    res.status(500).json({ error: 'Error interno del servidor.' });
  });
  return app;
}
