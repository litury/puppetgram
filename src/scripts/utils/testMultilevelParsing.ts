/**
 * Тестовый скрипт для проверки многоуровневого алгоритма парсинга
 * Имитирует работу без реальных API запросов
 */

import { ChannelDatabase } from '../../app/similarityParser/utils/channelDatabase';

// Имитация API ответов для разных каналов
const mockApiResponses: { [key: string]: string[] } = {
    'testchannel': ['@newchannel1', '@newchannel2', '@AIAcademy4teens', '@newchannel3'], // 2 дубликата из базы
    'newchannel1': ['@newchannel4', '@newchannel5', '@ALEXAROZEN'], // 1 дубликат из базы
    'newchannel2': ['@newchannel6', '@newchannel7'],
    'newchannel3': ['@newchannel8', '@AE_condition_chanal'], // 1 дубликат из базы
    'newchannel4': ['@newchannel9', '@newchannel10'],
    'newchannel5': ['@newchannel11'],
    'newchannel6': ['@newchannel12'],
    'newchannel7': [], // пустой ответ
    'newchannel8': ['@newchannel13', '@newchannel14']
};

async function simulateMultilevelParsing() {
    console.log('🧪 Тестирование многоуровневого алгоритма...\n');

    const database = new ChannelDatabase();
    const targetCount = 10;

    // Имитируем многоуровневый алгоритм
    let sourceChannels = ['testchannel'];
    let allNewChannels: string[] = [];
    let totalProcessed = 0;
    let totalDuplicates = 0;
    let level = 1;

    console.log(`🎯 Цель: найти ${targetCount} новых каналов\n`);

    while (allNewChannels.length < targetCount && sourceChannels.length > 0) {
        console.log(`📡 Уровень ${level}: обрабатываем ${sourceChannels.length} источников...`);
        const nextSources: string[] = [];
        let levelNewChannels = 0;

        for (const source of sourceChannels) {
            if (allNewChannels.length >= targetCount) break;

            console.log(`   🔍 Парсим @${source}...`);

            // Имитируем API запрос
            const rawChannels = mockApiResponses[source] || [];
            totalProcessed += rawChannels.length;

            // Фильтруем через базу данных
            const newChannels = database.filterNewChannels(rawChannels);
            const duplicates = rawChannels.length - newChannels.length;
            totalDuplicates += duplicates;

            // Добавляем новые каналы в общий результат
            allNewChannels.push(...newChannels);
            levelNewChannels += newChannels.length;

            // Новые каналы становятся источниками для следующего уровня
            nextSources.push(...newChannels.map(ch => ch.replace('@', '')));

            console.log(`      📊 Получено: ${rawChannels.length}, новых: ${newChannels.length}, дубликатов: ${duplicates}`);
            console.log(`      ➡️  Новые источники: ${newChannels.join(', ')}`);
        }

        console.log(`   ✨ Уровень ${level} завершен: +${levelNewChannels} новых каналов`);
        console.log(`   📋 Общий результат: ${allNewChannels.length}/${targetCount}`);

        if (levelNewChannels === 0) {
            console.log(`   🛑 На уровне ${level} не найдено новых каналов, останавливаем поиск`);
            break;
        }

        sourceChannels = nextSources;
        level++;
    }

    console.log(`\n📊 Многоуровневый поиск завершен:`);
    console.log(`   🔄 Обработано уровней: ${level - 1}`);
    console.log(`   📡 Всего каналов от API: ${totalProcessed}`);
    console.log(`   🚫 Дубликатов отфильтровано: ${totalDuplicates}`);
    console.log(`   ✨ Новых каналов найдено: ${allNewChannels.length}`);
    console.log(`   🎯 Цель достигнута: ${allNewChannels.length >= targetCount ? '✅ ДА' : '❌ НЕТ'}`);

    // Показываем финальный результат
    const finalChannels = allNewChannels.slice(0, targetCount);
    console.log(`\n📝 Итоговый список (первые ${targetCount}):`);
    finalChannels.forEach((channel, index) => {
        console.log(`${index + 1}. ${channel}`);
    });

    console.log('\n✅ Тест завершен успешно!');
}

if (require.main === module) {
    simulateMultilevelParsing().catch(console.error);
}