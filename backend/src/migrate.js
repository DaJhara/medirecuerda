// Aplica los archivos de backend/migrations/*.sql en orden, una sola vez cada uno (tabla schema_migrations).
// Se ejecuta al arrancar el contenedor (ver Dockerfile) o a mano con "npm run migrate".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertConfig } from './config.js';
import { getPool, closePool } from './db.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrate() {
  const pool = getPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`Migración aplicada: ${file}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw new Error(`Falló la migración ${file}: ${e.message}`);
    } finally {
      client.release();
    }
  }
}

// Si se ejecuta directamente (node src/migrate.js)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assertConfig();
    await migrate();
    console.log('Base de datos al día.');
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}
