import { Elysia, t } from 'elysia';

const clients = new Set<any>();
const EMIT_SECRET = process.env.EMIT_SECRET || 'dev-secret';

new Elysia()
  .ws('/ws', {
    open(ws) {
      clients.add(ws);
      console.log(`Client connected. Total: ${clients.size}`);
    },
    close(ws) {
      clients.delete(ws);
      console.log(`Client disconnected. Total: ${clients.size}`);
    },
  })
  .post('/emit', ({ body, headers }) => {
    // Проверка секретного токена
    if (headers['x-api-key'] !== EMIT_SECRET) {
      console.log('Unauthorized emit attempt');
      return { error: 'Unauthorized' };
    }

    const message = JSON.stringify(body);
    clients.forEach(ws => ws.send(message));
    console.log(`Broadcasted to ${clients.size} clients:`, body.type);

    return { ok: true, clients: clients.size };
  }, {
    body: t.Object({
      type: t.String(),
      data: t.Any(),
    }),
  })
  .get('/health', () => ({ status: 'ok', clients: clients.size }))
  .listen(4000);

console.log('WS Server running on :4000');
