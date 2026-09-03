FROM node:22-alpine

WORKDIR /app

# 1. Install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# 2. Copy source code (termasuk public/ yang berisi frontend)
COPY . .

ENV PORT=3001
ENV NODE_ENV=production

EXPOSE 3001

CMD ["node", "index.js"]
