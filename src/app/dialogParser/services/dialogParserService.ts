/**
 * Сервис для парсинга диалогов пользователя
 * Извлекает сообщения конкретного пользователя из всех его чатов
 */

import { TelegramClient } from 'telegram';
import { Api } from 'telegram/tl';
import {
    IDialogParser,
    IDialogParseOptions,
    IDialogParseResult,
    IChatInfo,
    IUserMessage,
    IUserMessageStats,
    IChatParseOptions,
    IChatUsersParseResult,
    IChatUserInfo,
    IUserInChatParseOptions,
    IUserInChatParseResult,
    IFoundUserInfo
} from '../interfaces';
import { generateDialogSessionId } from '../parts/dialogHelpers';
import path from 'path';

export class DialogParserService implements IDialogParser {
    private readonly p_client: TelegramClient;
    private readonly p_exportDir: string;

    constructor(_client: TelegramClient) {
        this.p_client = _client;
        this.p_exportDir = path.join(__dirname, '..', 'exports');
    }

    /**
     * Получает список всех чатов где участвует текущий пользователь
     */
    async getUserChatsAsync(_userId?: number): Promise<IChatInfo[]> {
        console.log('📋 Получаю список чатов пользователя...');

        try {
            // Получаем все диалоги пользователя
            const dialogs = await this.p_client.getDialogs({ limit: 1000 });
            const chats: IChatInfo[] = [];

            for (const dialog of dialogs) {
                const entity = dialog.entity;
                if (!entity) continue;

                let chatInfo: IChatInfo;

                if (entity.className === 'User') {
                    // Приватный чат
                    const user = entity as Api.User;
                    chatInfo = {
                        id: user.id.toString(),
                        title: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username || 'Unknown',
                        type: 'private',
                        username: user.username,
                        isActive: !user.deleted,
                        userMessageCount: 0
                    };
                } else if (entity.className === 'Chat') {
                    // Обычная группа
                    const chat = entity as Api.Chat;
                    chatInfo = {
                        id: chat.id.toString(),
                        title: chat.title,
                        type: 'group',
                        participantsCount: chat.participantsCount,
                        isActive: !chat.deactivated,
                        userMessageCount: 0
                    };
                } else if (entity.className === 'Channel') {
                    // Супергруппа или канал
                    const channel = entity as Api.Channel;
                    chatInfo = {
                        id: channel.id.toString(),
                        title: channel.title,
                        type: channel.broadcast ? 'channel' : 'supergroup',
                        username: channel.username,
                        participantsCount: channel.participantsCount,
                        isActive: !channel.restricted,
                        userMessageCount: 0
                    };
                } else {
                    continue; // Неизвестный тип
                }

                // Получаем дату последнего сообщения
                if (dialog.message) {
                    chatInfo.lastMessageDate = new Date(dialog.message.date * 1000);
                }

                chats.push(chatInfo);
            }

            console.log(`✅ Найдено ${chats.length} чатов`);
            return chats.sort((a, b) => {
                if (!a.lastMessageDate) return 1;
                if (!b.lastMessageDate) return -1;
                return b.lastMessageDate.getTime() - a.lastMessageDate.getTime();
            });

        } catch (error) {
            console.error('❌ Ошибка получения чатов:', error);
            throw error;
        }
    }

    /**
     * Парсит сообщения пользователя из указанных чатов
     */
    async parseUserDialogsAsync(_options: IDialogParseOptions): Promise<IDialogParseResult> {
        const sessionId = generateDialogSessionId();
        const startTime = new Date();

        console.log(`🚀 === ПАРСИНГ ДИАЛОГОВ ПОЛЬЗОВАТЕЛЯ ===`);
        console.log(`📝 Сессия: ${sessionId}`);
        console.log(`🎯 Пользователь: ${_options.targetUsername || _options.targetUserId || 'текущий'}`);

        try {
            // 1. Получаем информацию о целевом пользователе
            const currentUser = await this.p_client.getMe();
            const targetUserId = _options.targetUserId || currentUser.id.toJSNumber();
            const targetUsername = _options.targetUsername || currentUser.username;
            const fullName = `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim();

            console.log(`👤 Парсим сообщения: ${fullName} (@${targetUsername}, ID: ${targetUserId})`);

            // 2. Получаем список чатов
            const allChats = await this.getUserChatsAsync();
            const filteredChats = this.filterChatsByOptions(allChats, _options);

            console.log(`📊 Чатов для анализа: ${filteredChats.length} из ${allChats.length}`);

            // 3. Парсим сообщения из каждого чата (упрощенная версия)
            const allMessages: IUserMessage[] = [];
            const processedChats: IChatInfo[] = [];

            for (const [index, chat] of filteredChats.entries()) {
                console.log(`\n📂 [${index + 1}/${filteredChats.length}] ${chat.title} (${chat.type})`);

                try {
                    const messages = await this.extractUserMessagesFromChatAsync(
                        chat,
                        targetUserId,
                        _options
                    );

                    if (messages.length > 0) {
                        allMessages.push(...messages);
                        chat.userMessageCount = messages.length;
                        processedChats.push(chat);

                        console.log(`💬 Найдено сообщений: ${messages.length}`);
                    } else {
                        console.log(`⏭️ Сообщений не найдено`);
                    }

                    // Задержка между запросами
                    await new Promise(resolve => setTimeout(resolve, 500));

                } catch (error) {
                    console.error(`❌ Ошибка в чате ${chat.title}:`, error);
                    continue;
                }
            }

            // 4. Фильтруем и сортируем сообщения
            const filteredMessages = this.filterMessages(allMessages, _options.filters);
            const sortedMessages = this.sortMessages(filteredMessages, _options.exportConfig);

            // 5. Ограничиваем количество если указано
            const finalMessages = _options.limit
                ? sortedMessages.slice(0, _options.limit)
                : sortedMessages;

            // 6. Создаем результат
            const dateRange = this.calculateDateRange(finalMessages);
            const exportPath = path.join(this.p_exportDir, `user_${targetUserId}_${sessionId}`);

            const result: IDialogParseResult = {
                userId: targetUserId,
                username: targetUsername,
                fullName,
                totalMessages: finalMessages.length,
                totalChats: processedChats.length,
                messages: finalMessages,
                chats: processedChats,
                dateRange,
                filters: _options.filters,
                exportConfig: _options.exportConfig,
                exportPath
            };

            const endTime = new Date();
            const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);

            console.log(`\n🎉 === ПАРСИНГ ЗАВЕРШЕН ===`);
            console.log(`⏱️ Время выполнения: ${duration} сек`);
            console.log(`💬 Всего сообщений: ${result.totalMessages}`);
            console.log(`📂 Активных чатов: ${result.totalChats}`);
            console.log(`📅 Период: ${dateRange.from.toLocaleDateString()} - ${dateRange.to.toLocaleDateString()}`);

            return result;

        } catch (error) {
            console.error('❌ Критическая ошибка парсинга:', error);
            throw error;
        }
    }

    /**
 * Парсинг всех пользователей из конкретного чата
 */
    async parseChatUsersAsync(_options: IChatParseOptions): Promise<IChatUsersParseResult> {
        const sessionId = await generateDialogSessionId();
        const startTime = new Date();

        console.log(`🚀 === ПАРСИНГ ПОЛЬЗОВАТЕЛЕЙ ЧАТА ===`);
        console.log(`📝 Сессия: ${sessionId}`);
        console.log(`🎯 Чат ID: ${_options.chatId}`);

        try {
            // 1. Сначала ищем чат среди диалогов пользователя
            console.log(`🔍 Ищу чат среди ваших диалогов...`);

            const dialogs = await this.p_client.getDialogs({ limit: 1000 });
            let chatEntity: any = null;
            let chatInfo: { title: string; type: 'private' | 'group' | 'supergroup' | 'channel'; participantsCount?: number } | null = null;

            // Ищем нужный чат по ID
            for (const dialog of dialogs) {
                const entity = dialog.entity;
                if (!entity) continue;

                const entityId = entity.id.toString();
                if (entityId === _options.chatId || entityId === `-${_options.chatId}` || `${entityId}` === _options.chatId) {
                    chatEntity = entity;

                    if (entity.className === 'User') {
                        const user = entity as Api.User;
                        chatInfo = {
                            title: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username || 'Unknown',
                            type: 'private'
                        };
                    } else if (entity.className === 'Chat') {
                        const chat = entity as Api.Chat;
                        chatInfo = {
                            title: chat.title,
                            type: 'group',
                            participantsCount: chat.participantsCount
                        };
                    } else if (entity.className === 'Channel') {
                        const channel = entity as Api.Channel;
                        chatInfo = {
                            title: channel.title,
                            type: channel.broadcast ? 'channel' : 'supergroup',
                            participantsCount: channel.participantsCount
                        };
                    }
                    break;
                }
            }

            if (!chatEntity || !chatInfo) {
                console.log(`❌ Чат с ID ${_options.chatId} не найден среди ваших диалогов.`);
                console.log(`💡 Убедитесь, что:`);
                console.log(`   - Вы являетесь участником этого чата`);
                console.log(`   - ID чата указан правильно`);
                console.log(`   - У вас есть доступ к истории сообщений`);

                // Показываем несколько последних чатов для справки
                console.log(`\n📋 Ваши последние чаты (для справки):`);
                dialogs.slice(0, 5).forEach((dialog, index) => {
                    const entity = dialog.entity;
                    if (entity) {
                        let title = 'Unknown';
                        if (entity.className === 'User') {
                            const user = entity as Api.User;
                            title = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username || 'Unknown';
                        } else if (entity.className === 'Chat') {
                            const chat = entity as Api.Chat;
                            title = chat.title;
                        } else if (entity.className === 'Channel') {
                            const channel = entity as Api.Channel;
                            title = channel.title;
                        }
                        console.log(`   ${index + 1}. ${title} (ID: ${entity.id})`);
                    }
                });

                throw new Error(`Чат с ID ${_options.chatId} не найден среди ваших диалогов`);
            }

            console.log(`📊 Найден чат: ${chatInfo.title} (${chatInfo.type})`);
            if (chatInfo.participantsCount) {
                console.log(`�� Участников: ${chatInfo.participantsCount}`);
            }

            // 2. Получаем сообщения из чата, используя найденную сущность
            console.log('📥 Загружаю сообщения из чата...');

            const allMessages = await this.extractAllMessagesFromChatAsync(chatEntity.id.toString(), _options);
            console.log(`💬 Найдено сообщений: ${allMessages.length}`);

            // 3. Группируем сообщения по пользователям
            const userMessages: { [userId: number]: IUserMessage[] } = {};
            const userStats: { [userId: number]: IChatUserInfo } = {};

            for (const message of allMessages) {
                const userId = message.userId;

                if (!userMessages[userId]) {
                    userMessages[userId] = [];
                }
                userMessages[userId].push(message);

                // Обновляем статистику пользователя
                if (!userStats[userId]) {
                    userStats[userId] = {
                        id: userId,
                        username: message.username,
                        firstName: message.firstName,
                        lastName: message.lastName,
                        fullName: `${message.firstName || ''} ${message.lastName || ''}`.trim() || message.username || `User ${userId}`,
                        messageCount: 0,
                        isBot: false,
                        isDeleted: false
                    };
                }

                userStats[userId].messageCount++;

                if (!userStats[userId].firstMessageDate || message.date < userStats[userId].firstMessageDate!) {
                    userStats[userId].firstMessageDate = message.date;
                }

                if (!userStats[userId].lastMessageDate || message.date > userStats[userId].lastMessageDate!) {
                    userStats[userId].lastMessageDate = message.date;
                }
            }

            // 4. Фильтруем пользователей
            const filteredUsers = Object.values(userStats).filter(user => {
                if (_options.minMessagesPerUser && user.messageCount < _options.minMessagesPerUser) {
                    return false;
                }
                if (_options.excludeBots && user.isBot) {
                    return false;
                }
                return true;
            });

            // 5. Сортируем пользователей по количеству сообщений
            filteredUsers.sort((a, b) => b.messageCount - a.messageCount);

            // 6. Фильтруем сообщения для включенных пользователей
            const finalUserMessages: { [userId: number]: IUserMessage[] } = {};
            for (const user of filteredUsers) {
                finalUserMessages[user.id] = userMessages[user.id] || [];
            }

            // 7. Вычисляем диапазон дат
            const dateRange = this.calculateDateRange(allMessages);
            const exportPath = path.join(this.p_exportDir, `chat_${_options.chatId}_${sessionId}`);

            const result: IChatUsersParseResult = {
                chatId: _options.chatId,
                chatTitle: chatInfo.title,
                chatType: chatInfo.type,
                totalMessages: allMessages.length,
                totalUsers: filteredUsers.length,
                users: filteredUsers,
                userMessages: finalUserMessages,
                dateRange,
                filters: _options.filters,
                exportConfig: _options.exportConfig,
                exportPath
            };

            const endTime = new Date();
            const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);

            console.log(`\n🎉 === ПАРСИНГ ЧАТА ЗАВЕРШЕН ===`);
            console.log(`⏱️ Время выполнения: ${duration} сек`);
            console.log(`💬 Всего сообщений: ${result.totalMessages}`);
            console.log(`👥 Активных пользователей: ${result.totalUsers}`);
            console.log(`📅 Период: ${dateRange.from.toLocaleDateString()} - ${dateRange.to.toLocaleDateString()}`);

            // Показываем топ пользователей
            console.log(`\n👥 Топ пользователей по активности:`);
            filteredUsers.slice(0, 10).forEach((user, index) => {
                console.log(`  ${index + 1}. ${user.fullName} (@${user.username || 'no_username'}) - ${user.messageCount} сообщений`);
            });

            return result;

        } catch (error) {
            console.error('❌ Критическая ошибка парсинга чата:', error);
            throw error;
        }
    }

    /**
     * Парсинг конкретного пользователя в чате
     */
    async parseUserInChatAsync(_options: IUserInChatParseOptions): Promise<IUserInChatParseResult> {
        const sessionId = await generateDialogSessionId();
        const startTime = new Date();

        console.log(`🚀 === ПАРСИНГ ПОЛЬЗОВАТЕЛЯ В ЧАТЕ ===`);
        console.log(`📝 Сессия: ${sessionId}`);
        console.log(`🎯 Чат ID: ${_options.chatId}`);

        if (_options.targetUsername) {
            console.log(`👤 Ищем пользователя: @${_options.targetUsername}`);
        } else if (_options.targetName) {
            console.log(`👤 Ищем пользователя: ${_options.targetName}`);
        } else if (_options.targetUserId) {
            console.log(`👤 Ищем пользователя ID: ${_options.targetUserId}`);
        }

        try {
            // 1. Находим чат так же, как в parseChatUsersAsync
            console.log(`🔍 Ищу чат среди ваших диалогов...`);

            const dialogs = await this.p_client.getDialogs({ limit: 1000 });
            let chatEntity: any = null;
            let chatInfo: { title: string; type: 'private' | 'group' | 'supergroup' | 'channel'; participantsCount?: number } | null = null;

            // Ищем нужный чат по ID
            for (const dialog of dialogs) {
                const entity = dialog.entity;
                if (!entity) continue;

                const entityId = entity.id.toString();
                if (entityId === _options.chatId || entityId === `-${_options.chatId}` || `${entityId}` === _options.chatId) {
                    chatEntity = entity;

                    if (entity.className === 'User') {
                        const user = entity as Api.User;
                        chatInfo = {
                            title: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username || 'Unknown',
                            type: 'private'
                        };
                    } else if (entity.className === 'Chat') {
                        const chat = entity as Api.Chat;
                        chatInfo = {
                            title: chat.title,
                            type: 'group',
                            participantsCount: chat.participantsCount
                        };
                    } else if (entity.className === 'Channel') {
                        const channel = entity as Api.Channel;
                        chatInfo = {
                            title: channel.title,
                            type: channel.broadcast ? 'channel' : 'supergroup',
                            participantsCount: channel.participantsCount
                        };
                    }
                    break;
                }
            }

            if (!chatEntity || !chatInfo) {
                throw new Error(`Чат с ID ${_options.chatId} не найден среди ваших диалогов`);
            }

            console.log(`📊 Найден чат: ${chatInfo.title} (${chatInfo.type})`);

            // 2. Получаем все сообщения из чата
            console.log('📥 Загружаю сообщения из чата...');
            // Создаем опции для extractAllMessagesFromChatAsync
            const chatOptions: IChatParseOptions = {
                chatId: _options.chatId,
                limit: _options.limit,
                filters: _options.filters || {
                    excludeMedia: false,
                    excludeForwarded: false
                },
                exportConfig: _options.exportConfig
            };
            const allMessages = await this.extractAllMessagesFromChatAsync(chatEntity.id.toString(), chatOptions);
            console.log(`💬 Всего сообщений в чате: ${allMessages.length}`);

            // 3. Группируем сообщения по пользователям для поиска нужного
            const userMessageMap: Map<number, IUserMessage[]> = new Map();
            const userInfoMap: Map<number, IFoundUserInfo> = new Map();

            for (const message of allMessages) {
                const userId = message.userId;

                if (!userMessageMap.has(userId)) {
                    userMessageMap.set(userId, []);
                }
                userMessageMap.get(userId)!.push(message);

                // Создаем информацию о пользователе
                if (!userInfoMap.has(userId)) {
                    userInfoMap.set(userId, {
                        id: userId,
                        username: message.username || '',
                        firstName: message.firstName || '',
                        lastName: message.lastName || '',
                        fullName: `${message.firstName || ''} ${message.lastName || ''}`.trim() || message.username || `User ${userId}`,
                        isBot: false,
                        isDeleted: false,
                        messageCount: 0
                    });
                }

                userInfoMap.get(userId)!.messageCount++;
            }

            // 4. Ищем целевого пользователя
            let targetUser: IFoundUserInfo | null = null;
            let targetMessages: IUserMessage[] = [];

            console.log(`🔍 Ищу целевого пользователя среди ${userInfoMap.size} активных пользователей...`);

            for (const [userId, userInfo] of userInfoMap) {
                let isMatch = false;

                // Поиск по ID
                if (_options.targetUserId && userId === _options.targetUserId) {
                    isMatch = true;
                }

                // Поиск по username (без @)
                if (_options.targetUsername && userInfo.username) {
                    const cleanUsername = _options.targetUsername.replace('@', '').toLowerCase();
                    if (userInfo.username.toLowerCase() === cleanUsername) {
                        isMatch = true;
                    }
                }

                // Поиск по имени (частичное совпадение)
                if (_options.targetName && !isMatch) {
                    const searchName = _options.targetName.toLowerCase();
                    const firstName = userInfo.firstName.toLowerCase();
                    const lastName = userInfo.lastName.toLowerCase();
                    const fullName = userInfo.fullName.toLowerCase();

                    if (firstName.includes(searchName) ||
                        lastName.includes(searchName) ||
                        fullName.includes(searchName)) {
                        isMatch = true;
                    }
                }

                if (isMatch) {
                    targetUser = userInfo;
                    targetMessages = userMessageMap.get(userId) || [];
                    break;
                }
            }

            if (!targetUser) {
                console.log(`❌ Пользователь не найден!`);
                console.log(`💡 Проверьте:`);
                if (_options.targetUsername) {
                    console.log(`   - Username: @${_options.targetUsername}`);
                }
                if (_options.targetName) {
                    console.log(`   - Имя: ${_options.targetName}`);
                }
                if (_options.targetUserId) {
                    console.log(`   - ID: ${_options.targetUserId}`);
                }

                // Показываем топ пользователей для справки
                console.log(`\n📋 Топ активных пользователей в этом чате:`);
                const sortedUsers = Array.from(userInfoMap.values())
                    .sort((a, b) => b.messageCount - a.messageCount)
                    .slice(0, 10);

                sortedUsers.forEach((user, index) => {
                    console.log(`   ${index + 1}. ${user.fullName} (@${user.username || 'no_username'}) - ${user.messageCount} сообщений`);
                });

                throw new Error('Целевой пользователь не найден в этом чате');
            }

            console.log(`✅ Найден пользователь: ${targetUser.fullName} (@${targetUser.username || 'no_username'})`);
            console.log(`📊 Сообщений пользователя: ${targetMessages.length}`);

            // 5. Вычисляем диапазон дат
            const dateRange = this.calculateDateRange(targetMessages);
            const exportPath = path.join(this.p_exportDir, `user_${targetUser.id}_chat_${_options.chatId}_${sessionId}`);

            const result: IUserInChatParseResult = {
                chatId: _options.chatId,
                chatTitle: chatInfo.title,
                chatType: chatInfo.type,
                targetUser,
                messages: targetMessages,
                totalMessages: targetMessages.length,
                dateRange,
                filters: _options.filters,
                exportConfig: _options.exportConfig,
                exportPath
            };

            const endTime = new Date();
            const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);

            console.log(`\n🎉 === ПАРСИНГ ПОЛЬЗОВАТЕЛЯ ЗАВЕРШЕН ===`);
            console.log(`⏱️ Время выполнения: ${duration} сек`);
            console.log(`💬 Сообщений пользователя: ${result.totalMessages}`);
            console.log(`📅 Период: ${dateRange.from.toLocaleDateString()} - ${dateRange.to.toLocaleDateString()}`);
            console.log(`👤 Пользователь: ${targetUser.fullName} (@${targetUser.username || 'no_username'})`);

            return result;

        } catch (error) {
            console.error('❌ Критическая ошибка парсинга пользователя:', error);
            throw error;
        }
    }

    /**
     * Экспортирует результаты в указанные форматы
     */
    async exportDialogsAsync(_result: IDialogParseResult): Promise<string[]> {
        console.log('\n📤 Экспортирую результаты...');

        // Импортируем адаптеры экспорта здесь, чтобы избежать циклических зависимостей
        const { DialogExportAdapter } = await import('../adapters/dialogExportAdapter');

        const adapter = new DialogExportAdapter();
        const exportedFiles = await adapter.exportAsync(_result);

        console.log(`✅ Экспортировано файлов: ${exportedFiles.length}`);
        exportedFiles.forEach(file => console.log(`📄 ${file}`));

        return exportedFiles;
    }

    /**
     * Экспортирует результаты парсинга чата в указанные форматы
     */
    async exportChatUsersAsync(_result: IChatUsersParseResult): Promise<string[]> {
        console.log('\n📤 Экспортирую результаты парсинга чата...');

        // Импортируем адаптеры экспорта здесь
        const { ChatUsersExportAdapter } = await import('../adapters/chatUsersExportAdapter');

        const adapter = new ChatUsersExportAdapter();
        const exportedFiles = await adapter.exportAsync(_result);

        console.log(`✅ Экспортировано файлов: ${exportedFiles.length}`);
        exportedFiles.forEach(file => console.log(`📄 ${file}`));

        return exportedFiles;
    }

    /**
     * Экспортирует результаты парсинга пользователя в чате
     */
    async exportUserInChatAsync(_result: IUserInChatParseResult): Promise<string[]> {
        console.log('\n📤 Экспортирую результаты парсинга пользователя...');

        // Импортируем адаптер экспорта
        const { DialogExportAdapter } = await import('../adapters/dialogExportAdapter');

        const adapter = new DialogExportAdapter();
        const exports: string[] = [];

        // Создаем структуру для экспорта как диалоги
        const dialogResult: IDialogParseResult = {
            userId: _result.targetUser.id,
            username: _result.targetUser.username,
            fullName: _result.targetUser.fullName,
            totalChats: 1,
            totalMessages: _result.totalMessages,
            messages: _result.messages,
            chats: [{
                id: _result.chatId,
                title: _result.chatTitle,
                type: _result.chatType,
                username: '',
                isActive: true,
                userMessageCount: _result.totalMessages,
                lastMessageDate: _result.messages.length > 0 ? _result.messages[_result.messages.length - 1].date : new Date()
            }],
            dateRange: _result.dateRange,
            filters: _result.filters || { excludeMedia: false },
            exportConfig: _result.exportConfig,
            exportPath: _result.exportPath
        };

        // Экспортируем в указанные форматы
        const exportedPaths = await adapter.exportAsync(dialogResult);
        exports.push(...exportedPaths);

        exportedPaths.forEach(path => {
            console.log(`✅ Экспорт: ${path}`);
        });

        console.log(`\n🎉 Экспорт завершен! Создано файлов: ${exports.length}`);
        return exports;
    }

    /**
     * Извлекает сообщения пользователя из конкретного чата (упрощенная версия)
     */
    private async extractUserMessagesFromChatAsync(
        _chat: IChatInfo,
        _userId: number,
        _options: IDialogParseOptions
    ): Promise<IUserMessage[]> {
        const messages: IUserMessage[] = [];

        try {
            // Получаем последние сообщения из чата
            const batch = await this.p_client.getMessages(_chat.id, {
                limit: 100
            });

            // Фильтруем сообщения пользователя
            for (const message of batch) {
                if (message.senderId?.toJSNumber() === _userId && message.message) {
                    const userMessage: IUserMessage = {
                        id: message.id,
                        text: message.message,
                        date: new Date(message.date * 1000),
                        chatId: _chat.id,
                        chatTitle: _chat.title,
                        chatType: _chat.type,
                        userId: _userId,
                        username: _options.targetUsername,
                        hasMedia: !!message.media,
                        isEdited: !!message.editDate
                    };

                    if (this.messageMatchesFilters(userMessage, _options.filters)) {
                        messages.push(userMessage);
                    }
                }
            }

        } catch (error) {
            console.error(`Ошибка извлечения сообщений из ${_chat.title}:`, error);
        }

        return messages;
    }

    /**
     * Извлекает все сообщения из конкретного чата
     */
    private async extractAllMessagesFromChatAsync(
        _chatId: string,
        _options: IChatParseOptions
    ): Promise<IUserMessage[]> {
        const messages: IUserMessage[] = [];
        let offsetId = 0;
        const batchSize = 100;

        try {
            console.log('📥 Загружаю сообщения из чата...');

            while (true) {
                // Получаем порцию сообщений
                const batch = await this.p_client.getMessages(_chatId, {
                    limit: batchSize,
                    offsetId: offsetId > 0 ? offsetId : undefined,
                    reverse: false
                });

                if (batch.length === 0) break;

                // Обрабатываем каждое сообщение
                for (const message of batch) {
                    if (message.message && message.senderId) {
                        const userMessage = await this.convertMessageToUserMessage(message, _chatId, _options);
                        if (userMessage) {
                            messages.push(userMessage);
                        }
                    }
                }

                console.log(`📊 Обработано сообщений: ${messages.length}`);

                // Проверяем лимит
                if (_options.limit && messages.length >= _options.limit) {
                    break;
                }

                // Проверяем лимит даты
                const lastMessage = batch[batch.length - 1];
                if (_options.filters.dateFrom && lastMessage.date) {
                    const messageDate = new Date(lastMessage.date * 1000);
                    if (messageDate < _options.filters.dateFrom) {
                        break;
                    }
                }

                offsetId = batch[batch.length - 1].id;

                // Задержка между запросами
                await new Promise(resolve => setTimeout(resolve, 200));
            }

        } catch (error) {
            console.error(`Ошибка извлечения сообщений из чата ${_chatId}:`, error);
        }

        return messages;
    }

    /**
     * Конвертирует Telegram сообщение в IUserMessage для чата
     */
    private async convertMessageToUserMessage(
        _message: any,
        _chatId: string,
        _options: IChatParseOptions
    ): Promise<IUserMessage | null> {
        try {
            if (!_message.message) {
                return null; // Пустое сообщение
            }

            const sender = _message.sender;

            const userMessage: IUserMessage = {
                id: _message.id,
                text: _message.message,
                date: new Date(_message.date * 1000),
                chatId: _chatId,
                chatTitle: '', // Будет заполнено позже
                chatType: 'group', // Будет определено позже
                userId: sender?.id?.toJSNumber() || 0,
                username: sender?.username,
                firstName: sender?.firstName,
                lastName: sender?.lastName,
                hasMedia: !!_message.media,
                isEdited: !!_message.editDate
            };

            // Проверяем фильтры
            if (!this.messageMatchesFilters(userMessage, _options.filters)) {
                return null;
            }

            return userMessage;

        } catch (error) {
            console.error('Ошибка конвертации сообщения:', error);
            return null;
        }
    }

    /**
     * Фильтрует чаты по опциям
     */
    private filterChatsByOptions(_chats: IChatInfo[], _options: IDialogParseOptions): IChatInfo[] {
        return _chats.filter(chat => {
            // Фильтр по типам чатов
            if (!_options.includePrivateChats && chat.type === 'private') return false;
            if (!_options.includeGroups && chat.type === 'group') return false;
            if (!_options.includeSupergroups && chat.type === 'supergroup') return false;
            if (!_options.includeChannels && chat.type === 'channel') return false;

            return chat.isActive;
        });
    }

    /**
     * Проверяет соответствие сообщения фильтрам
     */
    private messageMatchesFilters(_message: IUserMessage, _filters: any): boolean {
        // Фильтр по дате
        if (_filters.dateFrom && _message.date < _filters.dateFrom) return false;
        if (_filters.dateTo && _message.date > _filters.dateTo) return false;

        // Фильтр по длине
        if (_filters.minMessageLength && _message.text.length < _filters.minMessageLength) return false;

        // Исключения
        if (_filters.excludeMedia && _message.hasMedia) return false;

        return true;
    }

    /**
     * Фильтрует сообщения по дополнительным критериям
     */
    private filterMessages(_messages: IUserMessage[], _filters: any): IUserMessage[] {
        return _messages.filter(message => this.messageMatchesFilters(message, _filters));
    }

    /**
     * Сортирует сообщения
     */
    private sortMessages(_messages: IUserMessage[], _config: any): IUserMessage[] {
        return _messages.sort((a, b) => {
            let comparison = 0;

            switch (_config.sortBy) {
                case 'date':
                    comparison = a.date.getTime() - b.date.getTime();
                    break;
                case 'chat':
                    comparison = a.chatTitle.localeCompare(b.chatTitle);
                    if (comparison === 0) {
                        comparison = a.date.getTime() - b.date.getTime();
                    }
                    break;
                case 'length':
                    comparison = a.text.length - b.text.length;
                    break;
            }

            return _config.sortOrder === 'desc' ? -comparison : comparison;
        });
    }

    /**
     * Вычисляет диапазон дат
     */
    private calculateDateRange(_messages: IUserMessage[]): { from: Date; to: Date } {
        if (_messages.length === 0) {
            const now = new Date();
            return { from: now, to: now };
        }

        const dates = _messages.map(m => m.date.getTime());
        return {
            from: new Date(Math.min(...dates)),
            to: new Date(Math.max(...dates))
        };
    }

    /**
     * Вычисляет статистику сообщений пользователя
     */
    calculateMessageStats(_messages: IUserMessage[]): IUserMessageStats {
        if (_messages.length === 0) {
            return {
                totalMessages: 0,
                averageMessageLength: 0,
                mostActiveChat: '',
                mostActivePeriod: '',
                messagesByHour: {},
                messagesByDay: {},
                messagesByChat: {},
                replyRate: 0,
                mediaRate: 0,
                editRate: 0
            };
        }

        // Подсчет базовых метрик
        const totalMessages = _messages.length;
        const averageMessageLength = _messages.reduce((sum, m) => sum + m.text.length, 0) / totalMessages;
        const repliesCount = _messages.filter(m => m.replyToMessageId).length;
        const mediaCount = _messages.filter(m => m.hasMedia).length;
        const editedCount = _messages.filter(m => m.isEdited).length;

        // Статистика по чатам
        const messagesByChat: { [chatId: string]: number } = {};
        _messages.forEach(m => {
            messagesByChat[m.chatId] = (messagesByChat[m.chatId] || 0) + 1;
        });

        const mostActiveChat = Object.keys(messagesByChat).reduce((a, b) =>
            messagesByChat[a] > messagesByChat[b] ? a : b
        );

        // Статистика по времени
        const messagesByHour: { [hour: number]: number } = {};
        const messagesByDay: { [day: string]: number } = {};

        _messages.forEach(m => {
            const hour = m.date.getHours();
            const day = m.date.toISOString().split('T')[0];

            messagesByHour[hour] = (messagesByHour[hour] || 0) + 1;
            messagesByDay[day] = (messagesByDay[day] || 0) + 1;
        });

        const mostActivePeriod = Object.keys(messagesByDay).reduce((a, b) =>
            messagesByDay[a] > messagesByDay[b] ? a : b
        );

        return {
            totalMessages,
            averageMessageLength: Math.round(averageMessageLength),
            mostActiveChat: _messages.find(m => m.chatId === mostActiveChat)?.chatTitle || '',
            mostActivePeriod,
            messagesByHour,
            messagesByDay,
            messagesByChat,
            replyRate: Math.round((repliesCount / totalMessages) * 100),
            mediaRate: Math.round((mediaCount / totalMessages) * 100),
            editRate: Math.round((editedCount / totalMessages) * 100)
        };
    }
} 