
// Aplicación Express: seguridad, rutas y documentación Swagger.
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';

import { config } from './config.js';
import { query } from './db.js';
import { requireAppKey, generalLimit } from './middleware/security.js';

import authRoutes from './routes/auth.js';
import aiRoutes from './routes/ai.js';
import imageRoutes from './routes/images.js';
import openApiSpec from './openapi.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({
    origin: config.corsOrigins.length ? config.corsOrigins : false,
  }));

  app.use(express.json({ limit: '8mb' }));

  // Estado del servicio: rutas públicas.
  app.get('/health', async (_req, res) => {
    try {
      await query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({
        ok: false,
        error: 'Base de datos no disponible.',
      });
    }
  });

  app.get('/', (_req, res) => {
    res.json({
      name: 'MediRecuerda API',
      status: 'ok',
    });
  });

  // Documentación Swagger pública.
  // Se retira CSP únicamente para Swagger UI, que necesita ejecutar
  // su interfaz JavaScript. Las demás rutas conservan Helmet.
  app.use('/docs', (_req, res, next) => {
    res.removeHeader('Content-Security-Policy');
    next();
  });

  app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(openApiSpec, {
      customSiteTitle: 'MediRecuerda API - Documentación',
    })
  );

  // Las rutas de la API requieren la clave de aplicación
  // (si APP_API_KEY está configurada) y límite por IP.
  app.use(requireAppKey, generalLimit);

  app.use('/auth', authRoutes);
  app.use('/ai', aiRoutes);
  app.use('/images', imageRoutes);

  // Ruta no encontrada.
  app.use((_req, res) => {
    res.status(404).json({
      error: 'Ruta no encontrada.',
    });
  });

  // Manejo centralizado de errores.
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') {
      return res.status(413).json({
        error: 'La solicitud es demasiado grande.',
      });
    }

    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({
        error: 'JSON no válido.',
      });
    }

    if (err.status && err.status < 500) {
      return res.status(err.status).json({
        error: err.message,
      });
    }

    if (err.status) {
      return res.status(err.status).json({
        error: err.message,
      });
    }

    console.error('Error no controlado:', err);

    res.status(500).json({
      error: 'Error interno del servidor.',
    });
  });

  return app;
}
