// Configuración leída de variables de entorno (en Railway: pestaña "Variables").
// Falla al arrancar si falta algo imprescindible, para no desplegar un servidor a medias.
const env = process.env;

export const config = {
  env: env.NODE_ENV || 'development',
  isProd: env.NODE_ENV === 'production',
  port: Number(env.PORT) || 3000,
  databaseUrl: env.DATABASE_URL,
  databaseSsl: env.DATABASE_SSL === 'true',
  jwtSecret: env.JWT_SECRET,
  jwtExpiresIn: env.JWT_EXPIRES_IN || '30d',
  appApiKey: env.APP_API_KEY || '',
  corsOrigins: (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  openrouterKey: env.OPENROUTER_API_KEY || '',
  openrouterModel: env.OPENROUTER_MODEL || 'openrouter/free',
  serperKey: env.SERPER_API_KEY || '',
  googleWebClientId: env.GOOGLE_WEB_CLIENT_ID || '',
  resendKey: env.RESEND_API_KEY || '',
  mailFrom: env.MAIL_FROM || 'MediRecuerda <onboarding@resend.dev>',
};

// Comprueba lo imprescindible (llamar al arrancar el servidor).
export function assertConfig() {
  const missing = [];
  if (!config.databaseUrl) missing.push('DATABASE_URL');
  if (!config.jwtSecret || config.jwtSecret.length < 32) missing.push('JWT_SECRET (mínimo 32 caracteres)');
  if (missing.length) {
    throw new Error(`Faltan variables de entorno: ${missing.join(', ')}`);
  }
  if (config.isProd && !config.appApiKey) {
    console.warn('[aviso] APP_API_KEY vacío: los endpoints de IA solo se protegen con límite por IP.');
  }
}
