# feed-web — фронт умной IT-ленты (SvelteKit + Tailwind)

Лёгкий клиент ленты. Карточки постов из `posts`, ранжированные ws-server'ом по score
(вовлечённость + overperformance + свежесть), вкладки «Горячее»/«Свежее», бесконечный скролл,
SSR первой страницы (быстрый экран + индексация).

## Стек
- **SvelteKit 2 + Svelte 5** (runes), **adapter-bun** (Bun на всём веб-слое, как `ws-server`).
- **Tailwind** — фундамент для shadcn-svelte. Добавить готовые компоненты:
  `npx shadcn-svelte@latest init && npx shadcn-svelte@latest add button card` (карточка сейчас на
  чистом Tailwind, чтобы работало без CLI-инициализации).

## Запуск (локально, до деплоя)
```bash
cd feed-web
npm install
cp .env.example .env          # PUBLIC_WS_SERVER_URL=http://localhost:4000
npm run dev                   # http://localhost:5173
```
Требует запущенный `ws-server` (:4000) и наполненную таблицу `posts`
(`npm run feed:listen` + `npm run feed:enrich` в корне проекта).

## Данные
`src/lib/api.ts` → `GET /api/feed` (ранжир) и `/api/feed/latest` (хронология) у ws-server.
SSR-загрузка — `src/routes/+page.ts`; подгрузка/скролл — `src/routes/+page.svelte`.

## Деплой
Отдельное Dokploy-приложение (как `dashboard`). `npm run build` → `adapter-bun` отдаёт сервер,
который запускается `bun ./build/index.js`. Переменная `PUBLIC_WS_SERVER_URL` — на прод-URL ws-server.
