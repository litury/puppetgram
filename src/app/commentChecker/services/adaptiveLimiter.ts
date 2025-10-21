/**
 * Адаптивная система лимитов для Telegram API
 * Автоматически подстраивается под скорость ответов и избегает FloodWait
 */

export interface IAdaptiveLimiterOptions {
    initialDelay: number;
    minDelay: number;
    maxDelay: number;
    aggressiveMode?: boolean;
    responseTimeThreshold?: number;
}

export interface IRequestMetrics {
    responseTime: number;
    success: boolean;
    timestamp: number;
    errorType?: string;
}

/**
 * ПРОСТОЙ ЛИМИТЕР С ФИКСИРОВАННОЙ ЗАДЕРЖКОЙ
 * Никакой адаптивности - только фиксированная задержка 30 секунд!
 */
export class AdaptiveLimiter {
    private readonly _options: IAdaptiveLimiterOptions;
    private _currentDelay: number;

    constructor(options: IAdaptiveLimiterOptions) {
        this._options = options;
        this._currentDelay = options.minDelay; // Всегда используем minDelay
    }

    /**
     * ПРОСТОЕ ОЖИДАНИЕ - фиксированная задержка
     */
    async waitForNext(): Promise<void> {
        console.log(`⏱️ Жду ${this._currentDelay}мс (${this._currentDelay / 1000} сек)...`);
        await new Promise(resolve => setTimeout(resolve, this._currentDelay));
    }

    /**
     * ПРОСТАЯ ЗАПИСЬ МЕТРИК - ничего не делаем с ними
     */
    recordRequest(metrics: IRequestMetrics): void {
        // Просто показываем базовую информацию
        const status = metrics.success ? "✅ успех" : "❌ ошибка";
        console.log(`📊 Запрос: ${metrics.responseTime}мс, ${status}, задержка: ${this._currentDelay}мс`);

        // Задержка ВСЕГДА одинаковая - 30 секунд!
        this._currentDelay = this._options.minDelay;
    }

    /**
     * ПРОСТАЯ СТАТИСТИКА - показываем только базовую информацию
     */
    getPerformanceStats(): string {
        return `📊 Фиксированная задержка: ${this._currentDelay}мс (30 секунд)`;
    }

    /**
     * Получить текущую задержку (всегда 30000мс)
     */
    getCurrentDelay(): number {
        return this._currentDelay;
    }

    /**
     * Сброс состояния (ничего не делаем)
     */
    reset(): void {
        this._currentDelay = this._options.minDelay;
    }
} 
 
 
 
 