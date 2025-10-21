/**
 * Универсальная утилита для обработки FloodWait ошибок Telegram
 */

export interface IFloodWaitError {
    isFloodWait: boolean;
    seconds: number;
    hours: number;
    shouldStop: boolean;
    message: string;
    originalError: any;
}

/**
 * Критический порог FloodWait в секундах (5 минут)
 * Если FloodWait больше этого значения - останавливаем скрипт
 */
const CRITICAL_FLOOD_WAIT_THRESHOLD = 300; // 5 минут

/**
 * Анализирует ошибку на предмет FloodWait
 */
export function analyzeFloodWaitError(_error: any): IFloodWaitError {
    const errorMessage = _error?.message || String(_error);
    const errorClass = _error?.className || '';
    const errorCode = _error?.errorMessage || '';

    // Проверяем различные форматы FloodWait ошибок
    const isFloodWait =
        errorClass === 'FloodWaitError' ||
        errorCode === 'FLOOD' ||
        errorMessage.includes('FloodWaitError') ||
        errorMessage.includes('FLOOD_WAIT') ||
        errorMessage.includes('Flood wait') ||
        errorMessage.includes('A wait of') ||
        _error?.code === 420;

    if (!isFloodWait) {
        return {
            isFloodWait: false,
            seconds: 0,
            hours: 0,
            shouldStop: false,
            message: errorMessage,
            originalError: _error
        };
    }

    // Извлекаем количество секунд ожидания
    let seconds = _error?.seconds || 0;

    if (!seconds) {
        // Пытаемся извлечь из сообщения
        const waitMatch = errorMessage.match(/(\d+)\s*seconds?/i);
        if (waitMatch) {
            seconds = parseInt(waitMatch[1]);
        } else {
            seconds = 60; // Дефолтное значение
        }
    }

    const hours = Math.round(seconds / 3600 * 10) / 10;
    const shouldStop = seconds > CRITICAL_FLOOD_WAIT_THRESHOLD;

    const message = shouldStop
        ? `🛑 КРИТИЧЕСКИЙ FloodWait: ${seconds} секунд (${hours} часов). ОСТАНОВКА СКРИПТА!`
        : `⚠️ FloodWait: ${seconds} секунд (${hours} часов)`;

    return {
        isFloodWait: true,
        seconds,
        hours,
        shouldStop,
        message,
        originalError: _error
    };
}

/**
 * Обрабатывает FloodWait ошибку и принимает решение о дальнейших действиях
 */
export function handleFloodWaitError(_error: any, _context: string = ''): never {
    const analysis = analyzeFloodWaitError(_error);

    if (!analysis.isFloodWait) {
        throw _error; // Перебрасываем если это не FloodWait
    }

    console.error(`\n${analysis.message}`);

    if (_context) {
        console.error(`📍 Контекст: ${_context}`);
    }

    if (analysis.shouldStop) {
        console.error(`\n🚫 НЕМЕДЛЕННАЯ ОСТАНОВКА ВСЕХ ОПЕРАЦИЙ!`);
        console.error(`⏰ Требуется ожидание: ${analysis.hours} часов`);
        console.error(`💡 Рекомендация: перезапустите скрипт через ${analysis.hours} часов`);
        console.error(`\n❌ Скрипт завершен из-за критического FloodWait`);

        // Выбрасываем специальную ошибку для остановки
        throw new Error(`CRITICAL_FLOOD_WAIT: ${analysis.seconds} seconds required`);
    } else {
        console.error(`⏳ Короткий FloodWait, можно продолжить через ${analysis.seconds} секунд`);
        throw new Error(`FloodWait: ${analysis.seconds} seconds required`);
    }
}

/**
 * Проверяет, является ли ошибка критическим FloodWait
 */
export function isCriticalFloodWait(_error: any): boolean {
    const analysis = analyzeFloodWaitError(_error);
    return analysis.isFloodWait && analysis.shouldStop;
}

/**
 * Форматирует время ожидания для пользователя
 */
export function formatWaitTime(_seconds: number): string {
    if (_seconds < 60) {
        return `${_seconds} секунд`;
    } else if (_seconds < 3600) {
        const minutes = Math.round(_seconds / 60);
        return `${minutes} минут`;
    } else {
        const hours = Math.round(_seconds / 3600 * 10) / 10;
        return `${hours} часов`;
    }
}

/**
 * Создает сообщение об остановке скрипта
 */
export function createStopMessage(_seconds: number, _scriptName: string = 'скрипт'): string {
    const waitTime = formatWaitTime(_seconds);
    return `🛑 ${_scriptName.toUpperCase()} ОСТАНОВЛЕН из-за FloodWait (${waitTime}). Перезапустите позже.`;
} 