import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

/**
 * Конфиг для Drizzle Studio (веб-GUI по БД): npm run db:studio.
 *
 * Берёт STUDIO_DATABASE_URL (внешний хост прода или SSH-туннель), а если он не
 * задан — падает обратно на DATABASE_URL. Так основной DATABASE_URL и миграции
 * (drizzle.config.ts) не затрагиваются, а Studio смотрит куда нужно.
 */
export default defineConfig({
  schema: './src/shared/database/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.STUDIO_DATABASE_URL || process.env.DATABASE_URL!,
  },
  verbose: true,
});
