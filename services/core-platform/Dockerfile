# Stage 1: Build & Dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Stage 2: Production Runner
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5070

COPY --from=deps /app/node_modules ./node_modules
COPY . .

USER node

EXPOSE 5070

HEALTHCHECK --interval=20s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5070/health || exit 1

CMD ["node", "src/index.js"]
