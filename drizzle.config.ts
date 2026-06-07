import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

/**
 * Конфиг drizzle-kit для нормальных миграций (db:generate / db:migrate).
 *
 * Прим.: исторически схема применялась рантайм-авто-миграцией в
 * src/shared/database/client.ts (initializeTables, ADD COLUMN IF NOT EXISTS).
 * drizzle-kit вводится для изменений схемы впредь — генерирует SQL-миграции
 * в ./drizzle из src/shared/database/schema.ts (source of truth).
 */
export default defineConfig({
  schema: './src/shared/database/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // existing prod-таблицы уже созданы — не роняем их при первом generate
  strict: true,
  verbose: true,
});
