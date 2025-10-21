/**
 * Утилита для форматированного вывода логов
 */

// Список ошибок, которые не нужно выводить в консоль
const p_suppressedErrors = new Set<string>([
    'TIMEOUT',
    'Request timed out'
]);

export class Logger {
    /**
     * Инициализация подавления TIMEOUT ошибок
     */
    static initTimeoutSuppression(): void {
        // Перехватываем console.error для фильтрации TIMEOUT
        const originalError = console.error;
        console.error = (...args: any[]) => {
            const errorStr = args.join(' ');
            if (!p_suppressedErrors.has(errorStr) && !errorStr.includes('TIMEOUT')) {
                originalError.apply(console, args);
            }
        };
    }

    /**
     * Информационное сообщение
     */
    static info(message: string): void {
        console.log(`ℹ️  ${message}`);
    }

    /**
     * Успешная операция
     */
    static success(message: string): void {
        console.log(`✅ ${message}`);
    }

    /**
     * Ошибка
     */
    static error(message: string, error?: any): void {
        console.log(`❌ ${message}`);
        if (error) {
            console.error(error);
        }
    }

    /**
     * Предупреждение
     */
    static warn(message: string): void {
        console.log(`⚠️  ${message}`);
    }

    /**
     * Секция/заголовок
     */
    static section(message: string): void {
        console.log(`\n${'═'.repeat(60)}`);
        console.log(`  ${message}`);
        console.log('═'.repeat(60));
    }

    /**
     * Прогресс (без переноса строки)
     */
    static progress(message: string): void {
        process.stdout.write(message);
    }

    /**
     * Действие с форматированием
     */
    static action(
        accountName: string,
        counters: string,
        channel: string,
        status: string,
        result: string
    ): void {
        // Обрезаем результат если слишком длинный
        const maxResultLength = 60;
        const truncatedResult = result.length > maxResultLength
            ? result.substring(0, maxResultLength) + '...'
            : result;

        console.log(
            `${accountName.padEnd(15)} | ${counters.padEnd(7)} | ${channel.padEnd(20)} | ${status} ${truncatedResult}`
        );
    }

    /**
     * Ротация аккаунта
     */
    static rotation(fromAccount: string, toAccount: string, reason: string): void {
        console.log(`\n🔄 РОТАЦИЯ: ${fromAccount} → ${toAccount} (${reason})`);
    }

    /**
     * FloodWait предупреждение
     */
    static floodWait(seconds: number): void {
        const formatTime = (_seconds: number): string => {
            const hours = Math.floor(_seconds / 3600);
            const minutes = Math.floor((_seconds % 3600) / 60);
            const secs = _seconds % 60;

            if (hours > 0) return `${hours}ч ${minutes}м`;
            if (minutes > 0) return `${minutes}м ${secs}с`;
            return `${secs}с`;
        };

        console.log(`\n⏳ FLOOD_WAIT: Нужно подождать ${formatTime(seconds)}`);
        console.log(`Работа остановлена. Запустите скрипт снова через ${formatTime(seconds)}`);
    }
}

