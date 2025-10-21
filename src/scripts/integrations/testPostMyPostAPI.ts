/**
 * Тестовый скрипт для проверки работы PostMyPost API
 */

import * as dotenv from "dotenv";

dotenv.config();

async function testAPI() {
    const token = process.env.POSTMYPOST_ACCESS_TOKEN;

    if (!token) {
        console.error('❌ POSTMYPOST_ACCESS_TOKEN не найден в .env файле');
        return;
    }

    console.log('🔍 Тестирование PostMyPost API...');
    console.log(`📝 Токен: ${token.substring(0, 10)}...`);

    // Тестируем базовый эндпоинт
    try {
        console.log('\n1. Тестирование эндпоинта /projects');
        const response = await fetch('https://api.postmypost.io/v1/projects', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        console.log(`📊 Статус: ${response.status}`);
        console.log(`📊 Статус текст: ${response.statusText}`);

        const responseText = await response.text();
        console.log(`📊 Ответ: ${responseText}`);

        if (response.ok) {
            const data = JSON.parse(responseText);
            console.log('✅ Проекты получены успешно:', data);
        } else {
            console.log('❌ Ошибка получения проектов');
        }

    } catch (error: any) {
        console.error('❌ Ошибка запроса:', error.message);
    }

    // Тестируем эндпоинт каналов
    try {
        console.log('\n2. Тестирование эндпоинта /channels');
        const response = await fetch('https://api.postmypost.io/v1/channels', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        console.log(`📊 Статус: ${response.status}`);
        console.log(`📊 Статус текст: ${response.statusText}`);

        const responseText = await response.text();
        console.log(`📊 Ответ: ${responseText.substring(0, 200)}...`);

        if (response.ok) {
            const data = JSON.parse(responseText);
            console.log('✅ Каналы получены успешно');
            console.log('📋 Доступные каналы:', data.data?.map((ch: any) => ch.name).join(', '));
        } else {
            console.log('❌ Ошибка получения каналов');
        }

    } catch (error: any) {
        console.error('❌ Ошибка запроса:', error.message);
    }

    // Тестируем эндпоинт таймзон
    try {
        console.log('\n3. Тестирование эндпоинта /timezones');
        const response = await fetch('https://api.postmypost.io/v1/timezones', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        console.log(`📊 Статус: ${response.status}`);

        if (response.ok) {
            const data = await response.json();
            console.log('✅ Таймзоны получены успешно');
            console.log('📋 Количество таймзон:', data.data?.length);
        } else {
            const errorText = await response.text();
            console.log('❌ Ошибка получения таймзон:', errorText);
        }

    } catch (error: any) {
        console.error('❌ Ошибка запроса:', error.message);
    }
}

if (require.main === module) {
    testAPI();
} 