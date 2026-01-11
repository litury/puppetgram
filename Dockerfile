# Билдит Next.js дашборд из поддиректории dashboard/

FROM node:20-alpine AS base
RUN apk add --no-cache python3 make g++

# Установка зависимостей
FROM base AS deps
WORKDIR /app
COPY dashboard/package.json ./
RUN npm install

# Сборка приложения
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY dashboard/ .
RUN npm run build

# Финальный образ
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Копируем standalone сборку
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# better-sqlite3 нужно пересобрать для Alpine
COPY --from=deps /app/package.json ./
RUN npm install better-sqlite3 --build-from-source

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
