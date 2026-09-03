FROM node:22-alpine

WORKDIR /app

# 1. Copy package files backend dan install dependencies
COPY backend-bot/package*.json ./backend-bot/
RUN cd backend-bot && npm install --omit=dev

# 2. Copy seluruh file frontend & backend
COPY . .

ENV PORT=3001
ENV NODE_ENV=production

EXPOSE 3001

WORKDIR /app/backend-bot
CMD ["node", "index.js"]
