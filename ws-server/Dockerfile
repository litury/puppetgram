FROM oven/bun:1-alpine
WORKDIR /app/ws-server
COPY ws-server/package.json ws-server/bun.lock ./
RUN bun install --frozen-lockfile
COPY ws-server/ .
COPY src/ ../src/
# Общий src лежит в /app/src и резолвит зависимости (drizzle-orm/pg) вверх от своей папки —
# даём ему node_modules ws-server через симлинк на /app/node_modules.
RUN ln -s /app/ws-server/node_modules /app/node_modules

EXPOSE 4000
CMD ["bun", "run", "src/index.ts"]
