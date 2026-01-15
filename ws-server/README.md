# WebSocket Сервер

Сервер для real-time обновлений дашборда Puppetgram.

## Стек
- **Runtime:** Bun
- **Framework:** Elysia

## Эндпоинты

| Метод | Путь | Описание |
|-------|------|----------|
| WS | `/ws` | WebSocket подключение для клиентов |
| POST | `/emit` | Отправка события всем подключённым клиентам (требует авторизацию) |
| GET | `/health` | Проверка состояния сервера |

## Переменные окружения

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| `EMIT_SECRET` | `dev-secret` | Токен для авторизации `/emit` |

## Локальная разработка

```bash
bun install
bun run dev
```

## Docker

```bash
docker build -t ws-server .
docker run -p 4000:4000 -e EMIT_SECRET=your-secret ws-server
```

## Использование

### Подключение (WebSocket)
```javascript
const ws = new WebSocket('ws://localhost:4000/ws');
ws.onmessage = (event) => console.log(JSON.parse(event.data));
```

### Отправка события
```bash
curl -X POST http://localhost:4000/emit \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret" \
  -d '{"type":"new_comment","data":{"channel":"test","postId":1}}'
```
