FROM node:22-alpine

WORKDIR /app

# 1. Copy package files backend dan install dependencies
COPY sellbot-landing/backend-bot/package*.json ./sellbot-landing/backend-bot/
RUN cd sellbot-landing/backend-bot && npm install --omit=dev

# 2. Copy seluruh source code (frontend dan backend)
COPY . .

# 3. Setting environment default dan expose port
ENV PORT=3001
ENV NODE_ENV=production

EXPOSE 3001

# 4. Masuk ke folder backend-bot dan jalankan server
WORKDIR /app/sellbot-landing/backend-bot
CMD ["node", "index.js"]
