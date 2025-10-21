import * as fs from 'fs';
import * as path from 'path';

/**
 * Скрипт для очистки и форматирования файла successful-channels.txt
 * Преобразует записи вида "yuniorapp # Added: 2025-09-05" в "@yuniorapp"
 */

const CHANNELS_FILE = path.resolve(__dirname, '../../../input-channels/successful-channels.txt');
const BACKUP_FILE = path.resolve(__dirname, '../../../input-channels/successful-channels.backup.txt');

function cleanChannelsList() {
    try {
        // Проверяем существование файла
        if (!fs.existsSync(CHANNELS_FILE)) {
            console.error(`❌ Файл не найден: ${CHANNELS_FILE}`);
            process.exit(1);
        }

        // Читаем содержимое файла
        const content = fs.readFileSync(CHANNELS_FILE, 'utf-8');
        const lines = content.split('\n');

        console.log(`📖 Прочитано ${lines.length} строк`);

        // Создаем резервную копию
        fs.writeFileSync(BACKUP_FILE, content);
        console.log(`💾 Создана резервная копия: ${BACKUP_FILE}`);

        // Обрабатываем каждую строку
        const cleanedChannels = lines
            .map(line => {
                // Убираем лишние пробелы
                line = line.trim();
                
                // Пропускаем пустые строки и комментарии
                if (!line || line.startsWith('#')) {
                    return null;
                }

                // Если строка уже начинается с @, оставляем как есть
                if (line.startsWith('@')) {
                    return line.split(/\s+/)[0]; // Берем только username без комментариев
                }

                // Извлекаем username из строки вида "username # Added: date"
                const match = line.match(/^([a-zA-Z0-9_]+)/);;
                if (match) {
                    return `@${match[1]}`;
                }

                return null;
            })
            .filter(Boolean) // Убираем null значения
            .filter((value, index, self) => self.indexOf(value) === index); // Убираем дубликаты

        console.log(`✨ Обработано ${cleanedChannels.length} уникальных каналов`);

        // Сохраняем очищенный список
        const cleanedContent = cleanedChannels.join('\n');
        fs.writeFileSync(CHANNELS_FILE, cleanedContent + '\n');

        console.log(`✅ Файл успешно очищен и сохранен`);
        console.log(`📝 Примеры обработанных каналов:`);
        cleanedChannels.slice(0, 5).forEach(channel => {
            console.log(`   ${channel}`);
        });

        // Статистика
        const removedCount = lines.filter(l => l.trim()).length - cleanedChannels.length;
        if (removedCount > 0) {
            console.log(`\n🗑️  Удалено дубликатов/некорректных строк: ${removedCount}`);
        }

    } catch (error) {
        console.error('❌ Ошибка при обработке файла:', error);
        process.exit(1);
    }
}

// Запускаем очистку
if (require.main === module) {
    console.log('🚀 Запуск очистки файла successful-channels.txt\n');
    cleanChannelsList();
}