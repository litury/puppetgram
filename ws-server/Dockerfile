# Stage 1: Build dashboard static files
FROM node:20-alpine AS dashboard-builder
WORKDIR /app
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci
COPY dashboard/ .
RUN npm run build

# Stage 2: Build and run ws-server
FROM oven/bun:1-alpine
WORKDIR /app
COPY ws-server/package.json ws-server/bun.lock ./
RUN bun install --frozen-lockfile
COPY ws-server/ .
COPY src/shared/ ./src/shared/

# Copy dashboard static build from stage 1
COPY --from=dashboard-builder /app/out ./dashboard/out

EXPOSE 4000
CMD ["bun", "run", "src/index.ts"]
