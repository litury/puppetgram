/**
 * Тестовый скрипт для проверки работы базы каналов
 */

import { ChannelDatabase } from '../../app/similarityParser/utils/channelDatabase';

function testDatabase() {
    console.log('🧪 Тестирование базы каналов...\n');

    const db = new ChannelDatabase();

    // Получаем статистику
    const stats = db.getStats();
    console.log('\n📊 Статистика базы:');
    console.log(`   - Основная база: ${stats.mainDatabaseSize} каналов`);
    console.log(`   - Спарсенные каналы: ${stats.parsedChannelsSize} каналов`);
    console.log(`   - Всего уникальных: ${stats.totalUniqueChannels} каналов`);

    // Тестируем фильтрацию
    const testChannels = [
        '@AE_condition_chanal',  // Есть в базе
        '@newchannel123',        // Новый канал
        '@AIAcademy4teens',      // Есть в базе
        '@anothernewchannel',    // Новый канал
        'ALEXAROZEN'             // Есть в базе (без @)
    ];

    console.log('\n🔍 Тестируем фильтрацию:');
    console.log('Исходные каналы:', testChannels);

    const filtered = db.filterNewChannels(testChannels);
    console.log('Новые каналы:', filtered);

    // Проверяем отдельные каналы
    console.log('\n🔎 Проверка отдельных каналов:');
    for (const channel of testChannels) {
        const isKnown = db.isChannelKnown(channel);
        console.log(`   ${channel}: ${isKnown ? '✅ Известен' : '❌ Новый'}`);
    }

    // Добавляем новые каналы
    if (filtered.length > 0) {
        console.log('\n➕ Добавляем новые каналы в базу спарсенных...');
        db.addParsedChannels(filtered);

        // Проверяем обновленную статистику
        const newStats = db.getStats();
        console.log('📊 Обновленная статистика:');
        console.log(`   - Спарсенные каналы: ${newStats.parsedChannelsSize} каналов`);
    }

    console.log('\n✅ Тест завершен успешно!');
}

if (require.main === module) {
    testDatabase();
}