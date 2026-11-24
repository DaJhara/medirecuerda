
# Imagen para Railway
FROM node:22-alpine

ENV NODE_ENV=production

WORKDIR /app

# Instalar únicamente las dependencias de producción
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copiar exclusivamente los archivos necesarios
COPY migrations/ ./migrations/
COPY src/ ./src/

# Ejecutar como usuario sin privilegios
USER node

EXPOSE 3000

# Aplicar migraciones y arrancar el servidor
CMD ["sh", "-c", "node src/migrate.js && node src/server.js"]