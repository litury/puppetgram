# Stage 1: Build dashboard static files
FROM node:20-alpine AS dashboard-builder
WORKDIR /app
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci
COPY dashboard/ .
RUN npm run build

# Stage 2: Build and run ws-server
FROM oven/bun:1-alpine
WORKDIR /app/ws-server

# Copy ws-server dependencies
COPY ws-server/package.json ws-server/bun.lock ./
RUN bun install --frozen-lockfile

# Copy ws-server source
COPY ws-server/ .

# Copy shared database schema
COPY src/ ../src/

# Copy dashboard static build
COPY --from=dashboard-builder /app/out ../dashboard/out

EXPOSE 4000
CMD ["bun", "run", "src/index.ts"]
