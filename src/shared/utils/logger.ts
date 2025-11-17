/**
 * Enhanced Pino Logger with scoped logging
 *
 * Соответствует требованиям из лекции Event-Driven Architecture:
 * - Scoped logging для каждого компонента
 * - Structured logging (JSON)
 * - Relative timestamps (время с момента старта)
 * - Message escaping (защита от injection)
 * - Operation tracking (start/end операций)
 * - Development/Production modes
 *
 * BONUS функции (сверх лекции):
 * - Correlation IDs для distributed tracing
 * - Child loggers для контекстного логирования
 * - TypeScript типизация
 * - Error stack trace support
 */

import pino from "pino";

// Типы для type-safety
type LogData = Record<string, unknown>;
type LogError = Error | { message: string; stack?: string };

const isDevelopment = process.env.NODE_ENV !== "production";

// Timestamp начала приложения (для relative timestamps из лекции)
const APP_START_TIME = Date.now();

/**
 * Вычисляет относительное время с момента старта приложения
 * Требование из лекции: "relative timestamp"
 */
const getRelativeTime = (): string => {
  const elapsed = Date.now() - APP_START_TIME;
  return `+${elapsed}ms`;
};

/**
 * Экранирует сообщение для безопасного логирования
 * Требование из лекции: "check message escaping"
 */
const escapeMessage = (msg: string): string => {
  return msg
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
};

// Базовый Pino logger с enhanced конфигурацией
export const logger = pino({
  level: process.env.LOG_LEVEL || "info",

  // Pretty printing только в development
  transport: isDevelopment
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:mm:ss.l",
          ignore: "pid,hostname",
          singleLine: false,
          messageFormat: "{scope} | {relativeTime} | {msg}",
        },
      }
    : undefined,

  // Форматтеры для production JSON
  formatters: {
    level: (label) => ({ level: label }),
  },

  // Базовые поля для всех логов
  base: {
    env: process.env.NODE_ENV || "development",
  },
});

/**
 * Интерфейс scoped logger с поддержкой всех фич из лекции
 */
interface ScopedLogger {
  trace(msg: string, data?: LogData): void;
  debug(msg: string, data?: LogData): void;
  info(msg: string, data?: LogData): void;
  warn(msg: string, data?: LogData): void;
  error(msg: string, error?: LogError, data?: LogData): void;
  fatal(msg: string, error?: LogError, data?: LogData): void;

  // Operation tracking из лекции
  operationStart(operation: string, data?: LogData): void;
  operationEnd(operation: string, startTime: number, data?: LogData): void;

  // Child logger для вложенных контекстов
  child(bindings: LogData): ScopedLogger;
}

/**
 * Создает scoped logger для модуля
 *
 * Требования из лекции:
 * - scope (обязательно)
 * - info, warning, error уровни
 * - message escaping
 * - relative timestamps
 *
 * @param scope - Название модуля/компонента (например, 'UserService' или 'VacancyWorker')
 * @param bindings - Дополнительные поля для всех логов (correlation ID, userId, etc.)
 *
 * @example
 * ```typescript
 * const log = createLogger('UserService', { userId: '123' });
 * log.info('User created');
 *
 * // Operation tracking (из лекции)
 * log.operationStart('CreateUser', { email: 'test@example.com' });
 * // ... do work ...
 * log.operationEnd('CreateUser', startTime);
 * ```
 */
export const createLogger = (
  scope: string,
  bindings: LogData = {},
): ScopedLogger => {
  const childLogger = logger.child({ scope, ...bindings });

  // Helper для добавления relative time и escaped message
  const logWithEnhancements = (
    level: "trace" | "debug" | "info" | "warn" | "error" | "fatal",
    msg: string,
    data?: LogData | LogError,
  ) => {
    const escapedMsg = escapeMessage(msg);
    const relativeTime = getRelativeTime();

    childLogger[level](
      {
        relativeTime,
        ...data,
      },
      escapedMsg,
    );
  };

  return {
    trace: (msg, data) => logWithEnhancements("trace", msg, data),
    debug: (msg, data) => logWithEnhancements("debug", msg, data),
    info: (msg, data) => logWithEnhancements("info", msg, data),
    warn: (msg, data) => logWithEnhancements("warn", msg, data),

    // Error с поддержкой Error объектов и stack traces
    error: (msg, error, data) => {
      const errorData =
        error instanceof Error ? { err: error, ...data } : { error, ...data };
      logWithEnhancements("error", msg, errorData);
    },

    fatal: (msg, error, data) => {
      const errorData =
        error instanceof Error ? { err: error, ...data } : { error, ...data };
      logWithEnhancements("fatal", msg, errorData);
    },

    // Operation tracking из лекции
    operationStart: (operation, data) => {
      logWithEnhancements("info", `${operation} started`, {
        operation,
        status: "IN_PROGRESS",
        ...data,
      });
    },

    operationEnd: (operation, startTime, data) => {
      const duration = Date.now() - startTime;
      logWithEnhancements("info", `${operation} completed`, {
        operation,
        status: "COMPLETED",
        duration: `${duration}ms`,
        ...data,
      });
    },

    // Child logger для вложенных контекстов
    child: (childBindings) =>
      createLogger(scope, { ...bindings, ...childBindings }),
  };
};

// Default export для совместимости
export default logger;
