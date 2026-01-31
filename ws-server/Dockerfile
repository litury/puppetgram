FROM oven/bun:1-alpine
WORKDIR /app/ws-server
COPY ws-server/package.json ws-server/bun.lock ./
RUN bun install --frozen-lockfile
COPY ws-server/ .
COPY src/ ../src/

EXPOSE 4000
CMD ["bun", "run", "src/index.ts"]
