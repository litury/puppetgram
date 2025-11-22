/**
 * Сервис для передачи владения каналами Telegram
 * Реализует простую архитектуру для ротации каналов между аккаунтами
 * Следует стандартам компании согласно project-structure.mdc и frontend-coding-standards.mdc
 */

import { Api, TelegramClient } from "telegram";
import { computeCheck } from "telegram/Password";
import bigInt from "big-integer";
import { IOwnershipTransferRequest, IOwnershipTransferResult, IOwnershipTransferOptions, IChannelInfo, IUserInfo, IChannelOwnershipRotator } from '../interfaces/IChannelOwnershipRotator';
import { createTelegramClientAsync, createInputChannelAsync, createInputUserAsync, getUserFromChannelAdmins, formatTelegramError, maskSessionString } from '../parts/ownershipHelpers';
import { formatErrorResult } from '../adapters/ownershipResultAdapter';

/**
 * Сервис для передачи владения каналами между аккаунтами Telegram
 */
export class ChannelOwnershipRotatorService implements IChannelOwnershipRotator {

    /**
     * Основной метод для передачи владения каналом
     * 
     * @param _request - Параметры запроса передачи владения
     * @param _options - Дополнительные опции выполнения
     * @returns Promise с результатом передачи владения
     */
    async transferOwnershipAsync(
        _request: IOwnershipTransferRequest,
        _options?: IOwnershipTransferOptions
    ): Promise<IOwnershipTransferResult> {

        const sessionId = Date.now().toString(36);
        let client: TelegramClient | null = null;

        try {
            console.log(`🎯 [${sessionId}] Начинается передача владения каналом...`);
            console.log(`📊 [${sessionId}] Сессия: ${maskSessionString(_request.sessionString)}`);
            console.log(`📢 [${sessionId}] Канал: ${_request.channelIdentifier}`);
            console.log(`👤 [${sessionId}] Целевой пользователь: ${_request.targetUserIdentifier}`);

            // 1. Создаем клиент Telegram
            console.log(`📋 [${sessionId}] Шаг 1: Создание клиента Telegram...`);
            client = await createTelegramClientAsync(_request.sessionString);

            // 2. Получаем информацию о текущем пользователе
            console.log(`📋 [${sessionId}] Шаг 2: Получение информации о текущем пользователе...`);
            const currentUser = await client.getMe() as Api.User;

            if (!currentUser.id) {
                throw new Error("Не удалось получить ID текущего пользователя");
            }

            // 3. Преобразуем идентификаторы в InputChannel и InputUser
            console.log(`📋 [${sessionId}] Шаг 3: Преобразование идентификаторов...`);

            // Создаём InputChannel напрямую если переданы channelId и accessHash (обходит FLOOD_WAIT)
            let inputChannel: Api.InputChannel;
            if (_request.channelId && _request.channelAccessHash) {
                console.log(`📋 [${sessionId}] Шаг 3.0: Создание InputChannel из переданных ID и accessHash (обход resolveUsername)...`);
                inputChannel = new Api.InputChannel({
                    channelId: bigInt(_request.channelId),
                    accessHash: bigInt(_request.channelAccessHash)
                });
            } else {
                inputChannel = await createInputChannelAsync(client, _request.channelIdentifier);
            }

            // Получаем InputUser из списка администраторов канала (обходит FLOOD_WAIT)
            console.log(`📋 [${sessionId}] Шаг 3.1: Получение пользователя из администраторов канала...`);
            const inputUser = await getUserFromChannelAdmins(client, inputChannel, _request.targetUserIdentifier);

            // 4. Получаем информацию о канале
            console.log(`📋 [${sessionId}] Шаг 4: Получение информации о канале...`);
            const channelInfo = await this.getChannelInfoAsync(client, inputChannel);

            // 5. Получаем информацию о целевом пользователе  
            console.log(`📋 [${sessionId}] Шаг 5: Получение информации о целевом пользователе...`);
            const targetUserInfo = await this.getUserInfoAsync(client, inputUser);

            // 6. Валидируем права на передачу
            console.log(`📋 [${sessionId}] Шаг 6: Валидация прав...`);
            await this.validateTransferAsync(client, channelInfo, currentUser, targetUserInfo);

            // 7. Передача канала с паролем (у всех есть пароль в .env)
            console.log(`📋 [${sessionId}] Шаг 7: Подготовка 2FA аутентификации...`);
            
            if (!_request.password) {
                throw new Error('Пароль 2FA не указан. Все аккаунты требуют пароль для передачи канала.');
            }
            
            // Получаем SRP данные для 2FA
            const passwordData = await client.invoke(new Api.account.GetPassword());
            
            // Создаем SRP пароль
            console.log(`📋 [${sessionId}] Шаг 8: Создание SRP пароля...`);
            const srpPassword = await this.createSrpPasswordAsync(_request.password, passwordData);
            
            // Передача с паролем
            console.log(`📋 [${sessionId}] Шаг 9: Выполнение передачи канала с паролем 2FA...`);
            let transferResult;
            try {
                transferResult = await client.invoke(new Api.channels.EditCreator({
                    channel: inputChannel,
                    userId: inputUser,
                    password: srpPassword
                }));
                
                console.log(`✅ [${sessionId}] Канал успешно передан!`);
                
            } catch (transferError: any) {
                if (transferError.errorMessage === 'CHAT_ADMIN_REQUIRED') {
                    throw new Error('Текущий аккаунт не является владельцем канала. Проверьте, что канал действительно принадлежит этому аккаунту.');
                } else if (transferError.errorMessage === 'PASSWORD_HASH_INVALID') {
                    throw new Error('Неверный пароль 2FA. Проверьте пароль в .env файле.');
                } else if (transferError.errorMessage?.includes('PASSWORD_TOO_FRESH')) {
                    const match = transferError.errorMessage.match(/PASSWORD_TOO_FRESH_(\d+)/);
                    const seconds = match ? match[1] : 'неизвестно';
                    throw new Error(`Пароль 2FA был изменен недавно. Подождите ${seconds} секунд.`);
                } else if (transferError.errorMessage?.includes('SESSION_TOO_FRESH')) {
                    const match = transferError.errorMessage.match(/SESSION_TOO_FRESH_(\d+)/);
                    const seconds = match ? match[1] : 'неизвестно';
                    throw new Error(`Сессия создана недавно. Подождите ${seconds} секунд.`);
                } else {
                    throw transferError;
                }
            }

            // 10. Формируем успешный результат
            const result: IOwnershipTransferResult = {
                success: true,
                channelTitle: channelInfo.title,
                channelId: channelInfo.id.toString(),
                fromUser: {
                    id: Number(currentUser.id),
                    username: currentUser.username,
                    firstName: currentUser.firstName
                },
                toUser: {
                    id: Number(targetUserInfo.id),
                    username: targetUserInfo.username,
                    firstName: targetUserInfo.firstName
                },
                transferredAt: new Date()
            };

            console.log(`✅ [${sessionId}] Передача владения завершена успешно!`);
            return result;

        } catch (error) {
            console.error(`❌ [${sessionId}] Ошибка при передаче владения:`, error);

            const errorMessage = formatTelegramError(error);
            return formatErrorResult(errorMessage, {
                sessionString: maskSessionString(_request.sessionString),
                channelIdentifier: _request.channelIdentifier,
                targetUserIdentifier: _request.targetUserIdentifier
            });

        } finally {
            if (client) {
                try {
                    await client.disconnect();
                    console.log(`🔌 [${sessionId}] Клиент отключен`);
                } catch (disconnectError) {
                    console.warn(`⚠️ [${sessionId}] Предупреждение при отключении:`, disconnectError);
                }
            }
        }
    }

    /**
     * Создает SRP пароль для 2FA аутентификации используя встроенную функцию GramJS
     */
    private async createSrpPasswordAsync(_password: string, _passwordData: Api.account.Password): Promise<Api.InputCheckPasswordSRP> {
        try {
            // Проверяем, что SRP включен
            if (!_passwordData.currentAlgo || !_passwordData.srp_B || !_passwordData.srpId) {
                throw new Error("2FA не настроена для этого аккаунта");
            }

            // Используем встроенную функцию GramJS для создания правильного SRP
            const srpPassword = await computeCheck(_passwordData, _password);
            return srpPassword;

        } catch (error) {
            throw new Error(`Ошибка создания SRP пароля: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`);
        }
    }

    /**
     * Получает информацию о канале для валидации
     * @param _sessionString - строка сессии
     * @param _channelIdentifier - идентификатор канала
     * @returns Promise с информацией о канале
     */
    async getChannelInfoAsync(_client: TelegramClient, _inputChannel: Api.InputChannel): Promise<IChannelInfo> {
        try {
            const result = await _client.invoke(new Api.channels.GetFullChannel({
                channel: _inputChannel
            }));

            const channelInfo = result.chats[0] as Api.Channel;

            return {
                id: Number(channelInfo.id),
                title: channelInfo.title || 'Без названия',
                username: channelInfo.username,
                participantsCount: Number(channelInfo.participantsCount) || 0,
                isPublic: !!(channelInfo.username && !channelInfo.megagroup)
            };

        } catch (error) {
            throw new Error(`Ошибка получения информации о канале: ${formatTelegramError(error)}`);
        }
    }

    /**
     * Получает информацию о пользователе
     * @param _sessionString - строка сессии
     * @param _userIdentifier - идентификатор пользователя
     * @returns Promise с информацией о пользователе
     */
    async getUserInfoAsync(_client: TelegramClient, _inputUser: Api.InputUser): Promise<IUserInfo> {
        try {
            const result = await _client.invoke(new Api.users.GetUsers({
                id: [_inputUser]
            }));

            const userInfo = result[0] as Api.User;

            return {
                id: Number(userInfo.id),
                username: userInfo.username,
                firstName: userInfo.firstName,
                lastName: userInfo.lastName,
                isBot: userInfo.bot || false
            };

        } catch (error) {
            throw new Error(`Ошибка получения информации о пользователе: ${formatTelegramError(error)}`);
        }
    }

    /**
     * Валидация возможности передачи владения
     */
    async validateTransferAsync(
        _client: TelegramClient,
        _channelInfo: IChannelInfo,
        _currentUser: Api.User,
        _targetUser: IUserInfo
    ): Promise<void> {
        // Проверяем, что текущий пользователь является владельцем канала
        try {
            // Для упрощения пропускаем валидацию прав - в реальном проекте 
            // здесь должна быть проверка через channels.GetParticipant
            console.log('⚠️ Валидация прав владельца пропущена (упрощенная версия)');

        } catch (error) {
            throw new Error(`Ошибка валидации прав: ${formatTelegramError(error)}`);
        }

        // Проверяем, что целевой пользователь не является ботом
        if (_targetUser.isBot) {
            throw new Error("Нельзя передать владение канала боту");
        }

        // Проверяем, что это не передача самому себе
        if (Number(_currentUser.id) === _targetUser.id) {
            throw new Error("Нельзя передать владение канала самому себе");
        }
    }
} 