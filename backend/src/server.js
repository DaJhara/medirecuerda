// Punto de entrada: valida la configuración, aplica migraciones y escucha en el puerto de Railway.
import { config, assertConfig } from './config.js';
import { createApp } from './app.js';
import { migrate } from './migrate.js';
import { closePool } from './db.js';

assertConfig();
await migrate(); // idempotente: solo aplica lo que falta

const server = createApp().listen(config.port, '0.0.0.0', () => {
  console.log(`MediRecuerda API escuchando en el puerto ${config.port} (${config.env})`);
});

// Cierre ordenado cuando Railway reinicia o redespliega (SIGTERM).
const stop = (signal) => {
  console.log(`${signal} recibido, cerrando...`);
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
