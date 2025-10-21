/**
 * Тестовый скрипт для проверки выбора аккаунтов
 * Имитирует работу без реального подключения к Telegram
 */

import { EnvAccountsParser } from '../../shared/utils/envAccountsParser';
import prompts from 'prompts';

async function testAccountSelection() {
    console.log('🧪 Тестирование выбора аккаунтов...\n');

    try {
        // Проверяем парсинг аккаунтов
        const accountsParser = new EnvAccountsParser();
        const accounts = accountsParser.getAvailableAccounts();

        console.log(`📋 Найдено аккаунтов: ${accounts.length}\n`);

        if (accounts.length === 0) {
            console.log('❌ Аккаунты не найдены в .env файле');
            console.log('💡 Убедитесь что в .env файле есть аккаунты в правильном формате');
            return;
        }

        // Показываем доступные аккаунты
        console.log('📝 Доступные аккаунты:');
        accounts.forEach((acc, index) => {
            console.log(`${index + 1}. ${acc.name} ${acc.username ? `@${acc.username}` : ''}`);
            console.log(`   - Session: ${acc.sessionKey}`);
            console.log(`   - API ID: ${acc.apiId ? '✅' : '❌'}`);
            console.log(`   - API Hash: ${acc.apiHash ? '✅' : '❌'}`);
        });

        console.log('\n🔐 Тестируем интерфейс выбора аккаунта...\n');

        // Имитируем выбор аккаунта
        const response = await prompts({
            type: 'select',
            name: 'account',
            message: 'Выберите аккаунт для парсинга:',
            choices: accounts.map(acc => ({
                title: `${acc.name} ${acc.username ? `@${acc.username}` : ''}`,
                value: acc
            }))
        });

        if (!response.account) {
            console.log('❌ Аккаунт не выбран');
            return;
        }

        console.log(`\n✅ Выбран аккаунт: ${response.account.name}`);
        console.log(`📱 Username: ${response.account.username || 'не указан'}`);
        console.log(`🔑 Session: ${response.account.sessionKey}`);
        console.log(`🆔 API ID: ${response.account.apiId}`);
        console.log(`#️⃣ API Hash: ${response.account.apiHash ? '✅ указан' : '❌ не указан'}`);

        console.log('\n✅ Тест выбора аккаунта завершен успешно!');
        console.log('💡 Теперь можно использовать npm run parse:similar с выбором аккаунта');

    } catch (error: any) {
        console.error('❌ Ошибка при тестировании:', error.message);

        if (error.message.includes('.env')) {
            console.log('\n💡 Возможные причины:');
            console.log('   - Файл .env не найден');
            console.log('   - Неправильный формат аккаунтов в .env');
            console.log('   - Отсутствуют необходимые поля (API_ID, API_HASH, SESSION)');
        }
    }
}

if (require.main === module) {
    testAccountSelection();
}