// Conexión a PostgreSQL (pool). En Railway usa DATABASE_URL del plugin de Postgres.
import pg from 'pg';
import { config } from './config.js';

let pool;

export function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
      max: 10,
      idleTimeoutMillis: 30000,
    });
    pool.on('error', (e) => console.error('Error inesperado en el pool de Postgres:', e.message));
  }
  return pool;
}

export const query = (text, params) => getPool().query(text, params);

export async function closePool() {
  if (pool) await pool.end();
  pool = undefined;
}
