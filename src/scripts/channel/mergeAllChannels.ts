import * as fs from 'fs';
import * as path from 'path';

const parsedChannelsDir = path.join(__dirname, '../modules/channelSimilarityParser/filter-duplicates/parsed-channels');
const outputFile = path.join(__dirname, '../modules/channelSimilarityParser/filter-duplicates/all-channels-unique.txt');

function mergeAndRemoveDuplicates() {
    console.log('📂 Начинаю объединение каналов из директории:', parsedChannelsDir);
    
    const allChannels = new Set<string>();
    let totalChannelsBeforeDuplicates = 0;
    const fileStats: { [filename: string]: { total: number, unique: number } } = {};
    
    try {
        const files = fs.readdirSync(parsedChannelsDir)
            .filter(file => file.endsWith('.txt'));
        
        console.log(`\n📋 Найдено файлов: ${files.length}`);
        console.log('━'.repeat(50));
        
        for (const file of files) {
            const filePath = path.join(parsedChannelsDir, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            const channels = content.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0 && line.startsWith('@'));
            
            const uniqueInFile = new Set(channels);
            const beforeSize = allChannels.size;
            
            channels.forEach(channel => allChannels.add(channel));
            
            const addedFromFile = allChannels.size - beforeSize;
            
            fileStats[file] = {
                total: channels.length,
                unique: addedFromFile
            };
            
            totalChannelsBeforeDuplicates += channels.length;
            
            console.log(`📄 ${file}:`);
            console.log(`   Всего каналов: ${channels.length}`);
            console.log(`   Уникальных в файле: ${uniqueInFile.size}`);
            console.log(`   Добавлено новых: ${addedFromFile}`);
        }
        
        const sortedChannels = Array.from(allChannels).sort();
        
        fs.writeFileSync(outputFile, sortedChannels.join('\n'), 'utf-8');
        
        const duplicatesRemoved = totalChannelsBeforeDuplicates - allChannels.size;
        
        console.log('\n' + '═'.repeat(50));
        console.log('📊 ИТОГОВАЯ СТАТИСТИКА:');
        console.log('═'.repeat(50));
        console.log(`✅ Всего каналов обработано: ${totalChannelsBeforeDuplicates}`);
        console.log(`🔄 Дубликатов удалено: ${duplicatesRemoved}`);
        console.log(`📝 Уникальных каналов сохранено: ${allChannels.size}`);
        console.log(`💾 Результат сохранен в: ${outputFile}`);
        console.log('═'.repeat(50));
        
        console.log('\n📈 Детальная статистика по файлам:');
        console.log('━'.repeat(50));
        
        const sortedFiles = Object.entries(fileStats)
            .sort((a, b) => b[1].total - a[1].total);
        
        for (const [filename, stats] of sortedFiles) {
            const duplicatesInFile = stats.total - stats.unique;
            console.log(`${filename}:`);
            console.log(`  • Всего: ${stats.total}`);
            console.log(`  • Новых уникальных: ${stats.unique}`);
            console.log(`  • Дубликатов с другими файлами: ${duplicatesInFile}`);
        }
        
    } catch (error) {
        console.error('❌ Ошибка при обработке файлов:', error);
    }
}

mergeAndRemoveDuplicates();