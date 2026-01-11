/**
 * Тестовый скрипт для проверки работы SOCKS5 прокси
 *
 * Проверяет:
 * 1. Доступность каждого прокси (туннель живой)
 * 2. IP адрес, который получает прокси
 * 3. Страну и ISP
 * 4. Сохраняет результаты для сравнения при следующем запуске
 *
 * Запуск: npm run test:proxy
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

import { loadAllProxies, ProxyInfo } from '../../shared/utils/proxyParser';
import { checkProxyHealth, ProxyHealthResult } from '../../shared/utils/proxyChecker';

// Файл для сохранения истории IP (для проверки hardsession)
const IP_HISTORY_FILE = path.join(process.cwd(), '.proxy-ip-history.json');

interface IpHistoryEntry {
    proxyKey: string;
    hardsession: string;
    ip: string;
    lastChecked: string;
}

interface IpHistory {
    entries: IpHistoryEntry[];
}

/**
 * Загружает историю IP из файла
 */
function loadIpHistory(): IpHistory {
    try {
        if (fs.existsSync(IP_HISTORY_FILE)) {
            const content = fs.readFileSync(IP_HISTORY_FILE, 'utf-8');
            return JSON.parse(content);
        }
    } catch {
        // Игнорируем ошибки чтения
    }
    return { entries: [] };
}

/**
 * Сохраняет историю IP в файл
 */
function saveIpHistory(history: IpHistory): void {
    fs.writeFileSync(IP_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
}

/**
 * Форматирует строку таблицы
 */
function formatTableRow(cells: string[], widths: number[]): string {
    return '│ ' + cells.map((cell, i) => cell.padEnd(widths[i])).join(' │ ') + ' │';
}

/**
 * Создаёт разделитель таблицы
 */
function formatTableSeparator(widths: number[], type: 'top' | 'mid' | 'bot'): string {
    const chars = {
        top: { left: '┌', mid: '┬', right: '┐', line: '─' },
        mid: { left: '├', mid: '┼', right: '┤', line: '─' },
        bot: { left: '└', mid: '┴', right: '┘', line: '─' }
    };
    const c = chars[type];
    return c.left + widths.map(w => c.line.repeat(w + 2)).join(c.mid) + c.right;
}

/**
 * Основная функция тестирования
 */
async function main() {
    console.log('\n🔍 ТЕСТ ПРОКСИ СОЕДИНЕНИЙ\n');
    console.log('Загрузка прокси из .env...\n');

    // Загружаем все прокси
    const proxies = loadAllProxies('PROXY_USA_');

    if (proxies.length === 0) {
        console.log('❌ Не найдено ни одного прокси (PROXY_USA_*)');
        console.log('   Добавьте прокси в .env файл в формате:');
        console.log('   PROXY_USA_1=socks5://host:port:user:pass');
        process.exit(1);
    }

    console.log(`📋 Найдено прокси: ${proxies.length}\n`);

    // Загружаем историю IP
    const ipHistory = loadIpHistory();

    // Результаты проверки
    const results: Array<{
        key: string;
        proxy: ProxyInfo;
        health: ProxyHealthResult;
        ipChanged: boolean;
        previousIp?: string;
    }> = [];

    // Проверяем каждый прокси
    for (const { key, config } of proxies) {
        process.stdout.write(`Проверка ${key}... `);

        const health = await checkProxyHealth(config, 15000);

        // Ищем предыдущий IP для этого hardsession
        const previousEntry = ipHistory.entries.find(e =>
            e.hardsession === config.hardsession
        );

        const ipChanged = previousEntry
            ? previousEntry.ip !== health.ip
            : false;

        results.push({
            key,
            proxy: config,
            health,
            ipChanged,
            previousIp: previousEntry?.ip
        });

        // Обновляем историю
        if (health.alive && health.ip) {
            const existingIndex = ipHistory.entries.findIndex(e =>
                e.hardsession === config.hardsession
            );

            const newEntry: IpHistoryEntry = {
                proxyKey: key,
                hardsession: config.hardsession || 'unknown',
                ip: health.ip,
                lastChecked: new Date().toISOString()
            };

            if (existingIndex >= 0) {
                ipHistory.entries[existingIndex] = newEntry;
            } else {
                ipHistory.entries.push(newEntry);
            }
        }

        console.log(health.alive ? '✅' : '❌');
    }

    // Сохраняем историю
    saveIpHistory(ipHistory);

    // Выводим результаты в виде таблицы
    console.log('\n📊 РЕЗУЛЬТАТЫ:\n');

    const headers = ['Прокси', 'hardsession', 'IP', 'Страна', 'ISP', 'Статус'];
    const widths = [10, 12, 16, 8, 20, 12];

    console.log(formatTableSeparator(widths, 'top'));
    console.log(formatTableRow(headers, widths));
    console.log(formatTableSeparator(widths, 'mid'));

    let aliveCount = 0;
    let usaCount = 0;

    for (const result of results) {
        const { key, proxy, health, ipChanged, previousIp } = result;

        let status = '❌ DEAD';
        if (health.alive) {
            aliveCount++;
            if (health.countryCode === 'US') {
                usaCount++;
                status = ipChanged
                    ? `⚠️ IP CHANGED`
                    : '✅ OK';
            } else {
                status = `⚠️ ${health.countryCode}`;
            }
        }

        const cells = [
            key.replace('PROXY_', ''),
            proxy.hardsession || '-',
            health.ip || '-',
            health.countryCode || '-',
            (health.isp || '-').substring(0, 20),
            status
        ];

        console.log(formatTableRow(cells, widths));

        // Показываем предыдущий IP если изменился
        if (ipChanged && previousIp) {
            console.log(formatTableRow([
                '',
                '',
                `(было: ${previousIp})`,
                '',
                '',
                ''
            ], widths));
        }
    }

    console.log(formatTableSeparator(widths, 'bot'));

    // Статистика
    console.log('\n📈 СТАТИСТИКА:');
    console.log(`   Всего прокси: ${results.length}`);
    console.log(`   Живых: ${aliveCount}`);
    console.log(`   USA IP: ${usaCount}`);
    console.log(`   Мёртвых: ${results.length - aliveCount}`);

    // Проверка hardsession
    const ipChangedCount = results.filter(r => r.ipChanged).length;
    if (ipChangedCount > 0) {
        console.log(`\n⚠️  IP изменился у ${ipChangedCount} прокси!`);
        console.log('   Это может означать что hardsession не работает как ожидалось.');
    } else if (ipHistory.entries.length > 0) {
        console.log('\n✅ Все IP остались прежними (hardsession работает)');
    }

    // Предупреждения
    const deadProxies = results.filter(r => !r.health.alive);
    if (deadProxies.length > 0) {
        console.log('\n⚠️  Мёртвые прокси:');
        deadProxies.forEach(r => {
            console.log(`   - ${r.key}: ${r.health.error}`);
        });
    }

    const nonUsaProxies = results.filter(r => r.health.alive && r.health.countryCode !== 'US');
    if (nonUsaProxies.length > 0) {
        console.log('\n⚠️  Прокси не из USA:');
        nonUsaProxies.forEach(r => {
            console.log(`   - ${r.key}: ${r.health.countryCode} (${r.health.country})`);
        });
    }

    console.log('\n');
}

// Запуск
main().catch(error => {
    console.error('Ошибка:', error);
    process.exit(1);
});
