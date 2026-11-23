# Imagen para Railway (también sirve para correr local con Docker).
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .
USER node
EXPOSE 3000
# Aplica las migraciones y arranca (Railway define PORT).
CMD ["sh", "-c", "node src/migrate.js && node src/server.js"]
