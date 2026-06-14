/**
 * Основной сервис для автоматического вступления в каналы Telegram
 * Следует стандартам компании согласно proj-struct-guideline.md и web-coding-guideline.md
 */

import { TelegramClient } from 'telegram';
import { Api } from 'telegram';
import {
    IChannelJoiner,
    IJoinTarget,
    IJoinAttemptResult,
    IJoinSessionOptions,
    IJoinSessionResult,
    IChannelAccessInfo,
    IBulkJoinOptions,
    IJoinSession
} from '../interfaces';
import {
    generateJoinSessionId,
    delayJoinAsync,
    generateRandomJoinDelay,
    categorizeJoinError,
    calculateJoinErrorStats,
    formatJoinDuration,
    shuffleJoinTargets,
    sortTargetsByPriority,
    extractRetryableChannels,
    checkJoinSafetyLimits
} from '../parts';

export class ChannelJoinerService implements IChannelJoiner {
    private p_client: TelegramClient;
    private p_activeSessions: Map<string, IJoinSession> = new Map();
    private p_dailyJoinCount: number = 0;
    private p_hourlyJoinCount: number = 0;
    private p_lastResetDate: Date = new Date();

    constructor(client: TelegramClient) {
        this.p_client = client;
    }

    /**
     * Вступление в один канал
     */
    async joinChannel(_target: IJoinTarget): Promise<IJoinAttemptResult> {
        const startTime = Date.now();

        try {
            console.log(`🚪 Попытка вступления в @${_target.channelUsername}`);

            // Проверяем доступ к каналу
            const accessInfo = await this.checkChannelAccess(_target.channelUsername);

            if (!accessInfo.isJoinable) {
                if (accessInfo.isPrivate && accessInfo.requiresApproval) {
                    return {
                        target: _target,
                        success: false,
                        joined: false,
                        alreadyMember: false,
                        errorCode: 'REQUIRES_APPROVAL',
                        errorMessage: 'Канал требует одобрения для вступления',
                        timestamp: new Date()
                    };
                } else if (accessInfo.isPrivate) {
                    return {
                        target: _target,
                        success: false,
                        joined: false,
                        alreadyMember: false,
                        errorCode: 'PRIVATE_CHANNEL',
                        errorMessage: 'Канал приватный',
                        timestamp: new Date()
                    };
                }
            }

            // Проверяем, не состоим ли уже в канале
            const isMember = await this.p_checkMembershipAsync(_target.channelUsername);
            if (isMember) {
                console.log(`✅ Уже состою в @${_target.channelUsername}`);
                return {
                    target: _target,
                    success: true,
                    joined: false,
                    alreadyMember: true,
                    timestamp: new Date()
                };
            }

            // Выполняем вступление
            const joinResult = await this.p_performJoinAsync(_target.channelUsername);

            if (joinResult.type === 'joined') {
                console.log(`✅ Успешно вступил в @${_target.channelUsername}`);
                this.p_dailyJoinCount++;
                this.p_hourlyJoinCount++;

                return {
                    target: _target,
                    success: true,
                    joined: true,
                    alreadyMember: false,
                    timestamp: new Date()
                };
            } else if (joinResult.type === 'request_sent') {
                console.log(`📝 Заявка на вступление отправлена в @${_target.channelUsername}`);
                this.p_dailyJoinCount++;
                this.p_hourlyJoinCount++;

                return {
                    target: _target,
                    success: true,
                    joined: false,
                    alreadyMember: false,
                    inviteRequestSent: true,
                    timestamp: new Date()
                };
            }

            // Fallback - не должно попасть сюда
            throw new Error(`Неизвестный тип результата: ${joinResult.type}`);

        } catch (error: any) {
            console.log(`❌ Ошибка вступления в @${_target.channelUsername}: ${error.message}`);

            const errorCode = this.p_mapTelegramErrorToCode(error);
            let retryAfter: number | undefined;

            // Обработка flood wait
            if (error.errorMessage === 'FLOOD_WAIT') {
                retryAfter = error.seconds || 60;
            }

            return {
                target: _target,
                success: false,
                joined: false,
                alreadyMember: false,
                errorCode: errorCode,
                errorMessage: error.message || error.toString(),
                timestamp: new Date(),
                retryAfter: retryAfter
            };
        }
    }

    /**
     * Вступление в несколько каналов
     */
    async joinMultipleChannels(_options: IJoinSessionOptions): Promise<IJoinSessionResult> {
        const sessionId = generateJoinSessionId();
        const startTime = Date.now();

        console.log(`🚀 Начинаю сессию вступления: ${sessionId}`);
        console.log(`📋 Каналов: ${_options.targets.length}`);
        console.log(`🧪 Тестовый режим: ${_options.dryRun ? 'ДА' : 'НЕТ'}`);
        console.log(`⏱️ Задержка между подписками: ${_options.delayBetweenJoins / 1000} сек`);

        if (!_options.dryRun) {
            console.log(`\n⚠️ ВАЖНО: Безопасные лимиты Telegram:`);
            console.log(`   • Максимум 8-10 подписок в час`);
            console.log(`   • Максимум 15-20 подписок в день`);
            console.log(`   • Рекомендуемая задержка: 180+ секунд\n`);
        }

        // Создаем сессию
        const session: IJoinSession = {
            sessionId,
            startTime: new Date(),
            totalTargets: _options.targets.length,
            processedTargets: 0,
            successfulJoins: 0,
            failedJoins: 0,
            isActive: true,
            options: _options
        };

        this.p_activeSessions.set(sessionId, session);

        const results: IJoinAttemptResult[] = [];
        let processedTargets = [..._options.targets];

        // Применяем фильтры и сортировку
        if (_options.skipAlreadyJoined) {
            processedTargets = processedTargets.filter(target => target.isActive);
        }

        if (_options.randomizeOrder) {
            processedTargets = shuffleJoinTargets(processedTargets);
        } else {
            processedTargets = sortTargetsByPriority(processedTargets);
        }

        // Ограничиваем количество
        if (_options.maxJoinsPerSession > 0) {
            processedTargets = processedTargets.slice(0, _options.maxJoinsPerSession);
        }

        console.log(`📊 Обрабатываю ${processedTargets.length} каналов`);

        // Обрабатываем каналы
        for (const [index, target] of processedTargets.entries()) {
            if (!session.isActive) {
                console.log('⏹️ Сессия остановлена пользователем');
                break;
            }

            session.currentTarget = target;
            session.processedTargets = index + 1;

            console.log(`\n[${index + 1}/${processedTargets.length}] 📺 @${target.channelUsername}`);

            let result: IJoinAttemptResult;

            if (_options.dryRun) {
                console.log('🧪 Тестовый режим - пропускаю вступление');
                result = {
                    target,
                    success: true,
                    joined: false,
                    alreadyMember: false,
                    timestamp: new Date()
                };
            } else {
                // Проверяем лимиты безопасности
                const safetyCheck = checkJoinSafetyLimits(
                    this.p_dailyJoinCount,
                    50, // часовой лимит
                    200 // дневной лимит
                );

                if (!safetyCheck.canJoin) {
                    console.log(`⚠️ ${safetyCheck.reason}`);
                    break;
                }

                result = await this.joinChannel(target);
            }

            results.push(result);

            // Обновляем статистику сессии и показываем результат
            if (result.success) {
                if (result.joined) {
                    session.successfulJoins++;
                    console.log(`   ✅ Успешно вступил! (Всего: ${session.successfulJoins})`);
                } else if (result.inviteRequestSent) {
                    session.successfulJoins++;
                    console.log(`   📝 Заявка отправлена! (Всего заявок: ${session.successfulJoins})`);
                } else if (result.alreadyMember) {
                    console.log(`   ℹ️ Уже состоял в канале`);
                    // Считаем как успех, но отдельно
                }
            } else {
                session.failedJoins++;
                console.log(`   ❌ Ошибка: ${result.errorMessage} (Всего ошибок: ${session.failedJoins})`);
            }

            // Задержка между вступлениями
            if (index < processedTargets.length - 1) {
                const delay = _options.delayBetweenJoins;
                const nextIndex = index + 2;
                const remaining = processedTargets.length - nextIndex + 1;
                console.log(`⏱️ Пауза ${delay / 1000} сек... (Осталось: ${remaining} каналов)`);
                await delayJoinAsync(delay);
            }
        }

        const endTime = Date.now();
        const duration = endTime - startTime;

        session.endTime = new Date();
        session.isActive = false;
        this.p_activeSessions.delete(sessionId);

        // Подсчитываем финальную статистику
        const successfulJoins = results.filter(r => r.success && r.joined).length;
        const inviteRequestsSent = results.filter(r => r.success && r.inviteRequestSent).length;
        const alreadyJoined = results.filter(r => r.success && r.alreadyMember).length;
        const failedJoins = results.filter(r => !r.success).length;
        const skippedChannels = _options.targets.length - results.length;

        const errorStats = calculateJoinErrorStats(results);
        const retryableChannels = extractRetryableChannels(results);

        const sessionResult: IJoinSessionResult = {
            sessionId,
            totalTargets: _options.targets.length,
            successfulJoins,
            failedJoins,
            alreadyJoined,
            skippedChannels,
            duration,
            results,
            summary: {
                successRate: (successfulJoins / _options.targets.length) * 100,
                averageDelay: _options.delayBetweenJoins,
                errorsByType: errorStats,
                channelsNeedingRetry: retryableChannels
            }
        };

        console.log(`\n✅ Сессия завершена: ${sessionId}`);
        console.log(`📊 Вступили: ${successfulJoins}, Заявки: ${inviteRequestsSent}, Уже участники: ${alreadyJoined}, Ошибок: ${failedJoins}`);
        console.log(`⏱️ Длительность: ${formatJoinDuration(duration)}`);

        return sessionResult;
    }

    /**
     * Массовое вступление в каналы
     */
    async bulkJoinChannels(_options: IBulkJoinOptions): Promise<IJoinSessionResult[]> {
        // Реализация будет добавлена при необходимости
        throw new Error('Массовое вступление пока не реализовано');
    }

    /**
     * Проверка доступа к каналу
     */
    async checkChannelAccess(_channelUsername: string): Promise<IChannelAccessInfo> {
        console.log(`   🔍 Проверяю доступ к каналу @${_channelUsername}...`);

        try {
            // Добавляем таймаут для getEntity
            const channelEntity = await Promise.race([
                this.p_client.getEntity(_channelUsername),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout getting entity')), 10000)
                )
            ]) as any;

            console.log(`   ✅ Канал найден: @${_channelUsername}`);

            if ('megagroup' in channelEntity || 'broadcast' in channelEntity) {
                const channel = channelEntity as Api.Channel;

                const accessInfo = {
                    channelUsername: _channelUsername,
                    channelTitle: channel.title,
                    isPrivate: !channel.username,
                    requiresApproval: channel.joinRequest || false,
                    isJoinable: !channel.left,
                    memberCount: channel.participantsCount,
                    hasJoinRequest: channel.joinRequest || false
                };

                console.log(`   📋 Информация: ${channel.title}, приватный: ${accessInfo.isPrivate}, можно вступить: ${accessInfo.isJoinable}`);
                return accessInfo;
            }

            console.log(`   ⚠️ Неподдерживаемый тип канала @${_channelUsername}`);
            return {
                channelUsername: _channelUsername,
                isPrivate: true,
                requiresApproval: false,
                isJoinable: false,
                hasJoinRequest: false
            };

        } catch (error: any) {
            console.log(`   ❌ Ошибка доступа к @${_channelUsername}: ${error.message}`);
            return {
                channelUsername: _channelUsername,
                isPrivate: true,
                requiresApproval: false,
                isJoinable: false,
                hasJoinRequest: false
            };
        }
    }

    /**
     * Вступление по готовому peer (InputPeer/entity), а не по username.
     * Нужно для авто-join в ЧАТ ОБСУЖДЕНИЯ: его peer (discussionMessage.peerId)
     * уже есть в руках в момент CHAT_GUEST_SEND_FORBIDDEN — повторный resolve не нужен.
     * Возвращает структурированный результат, чтобы вызывающий код реагировал на лимиты.
     */
    async joinByPeer(_peerOrId: any): Promise<{ ok: boolean; alreadyMember?: boolean; reason?: string; retryAfter?: number; accessHash?: bigint }> {
        try {
            // Резолвим в полноценный entity (надёжнее для JoinChannel, чем сырой Peer).
            // Группа только что встречалась через GetDiscussionMessage → берётся из кэша сессии.
            const entity: any = await this.p_client.getEntity(_peerOrId);
            await this.p_client.invoke(new Api.channels.JoinChannel({ channel: entity }));
            this.p_dailyJoinCount++;
            this.p_hourlyJoinCount++;
            // access_hash нужен для выхода в отдельном процессе (revert-скрипт)
            const accessHash = entity?.accessHash ? BigInt(entity.accessHash.toString()) : undefined;
            return { ok: true, accessHash };
        } catch (error: any) {
            const code = error?.errorMessage as string | undefined;
            if (code === 'USER_ALREADY_PARTICIPANT') {
                return { ok: true, alreadyMember: true };
            }
            if (code === 'CHANNELS_TOO_MUCH') {
                return { ok: false, reason: 'CHANNELS_TOO_MUCH' };
            }
            if (code === 'FLOOD_WAIT' || error?.constructor?.name === 'FloodWaitError') {
                return { ok: false, reason: 'FLOOD_WAIT', retryAfter: error?.seconds || 60 };
            }
            if (code === 'INVITE_REQUEST_SENT') {
                // Группа требует одобрения — заявка отправлена, но писать сейчас нельзя
                return { ok: false, reason: 'INVITE_REQUEST_SENT' };
            }
            return { ok: false, reason: code || 'OTHER' };
        }
    }

    /**
     * Выход по готовому peer (для reaper'а — у нас есть entity/InputPeer группы).
     */
    async leaveByPeer(_peerOrId: any): Promise<boolean> {
        try {
            const entity = await this.p_client.getEntity(_peerOrId);
            await this.p_client.invoke(new Api.channels.LeaveChannel({ channel: entity }));
            return true;
        } catch (error) {
            console.error('❌ Ошибка выхода из группы по peer:', error);
            return false;
        }
    }

    /**
     * Выход из группы по id + access_hash (для revert-скрипта в отдельном процессе,
     * где entity-кэш пуст и резолв по голому id невозможен).
     */
    async leaveByIdHash(_groupId: number, _accessHash: bigint): Promise<boolean> {
        try {
            const bigInt = (await import('big-integer')).default;
            const channel = new Api.InputChannel({
                channelId: bigInt(_groupId.toString()),
                accessHash: bigInt(_accessHash.toString()),
            });
            await this.p_client.invoke(new Api.channels.LeaveChannel({ channel }));
            return true;
        } catch (error) {
            console.error(`❌ Ошибка выхода из группы ${_groupId} по id+hash:`, error);
            return false;
        }
    }

    /**
     * Выход из канала
     */
    async leaveChannel(_channelUsername: string): Promise<boolean> {
        try {
            const channelEntity = await this.p_client.getEntity(_channelUsername);

            await this.p_client.invoke(new Api.channels.LeaveChannel({
                channel: channelEntity
            }));

            console.log(`✅ Покинул канал @${_channelUsername}`);
            return true;

        } catch (error) {
            console.error(`❌ Ошибка выхода из канала @${_channelUsername}:`, error);
            return false;
        }
    }

    /**
     * Проверка членства в канале
     */
    private async p_checkMembershipAsync(_channelUsername: string): Promise<boolean> {
        console.log(`   👤 Проверяю членство в @${_channelUsername}...`);

        try {
            const channelEntity = await Promise.race([
                this.p_client.getEntity(_channelUsername),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout getting entity for membership')), 8000)
                )
            ]) as any;

            await Promise.race([
                this.p_client.invoke(new Api.channels.GetParticipant({
                    channel: channelEntity,
                    participant: new Api.InputPeerSelf()
                })),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout checking membership')), 8000)
                )
            ]);

            console.log(`   ✅ Уже состою в @${_channelUsername}`);
            return true;
        } catch (error: any) {
            if (error.errorMessage === 'USER_NOT_PARTICIPANT') {
                console.log(`   🚫 Не являюсь участником @${_channelUsername}`);
                return false;
            }
            console.log(`   ❌ Ошибка проверки членства @${_channelUsername}: ${error.message}`);
            // Для других ошибок считаем что не состоим в канале
            return false;
        }
    }

    /**
     * Выполнение вступления в канал
     */
    private async p_performJoinAsync(_channelUsername: string): Promise<{type: 'joined' | 'request_sent'}> {
        console.log(`   🚪 Выполняю вступление в @${_channelUsername}...`);

        try {
            const channelEntity = await Promise.race([
                this.p_client.getEntity(_channelUsername),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout getting entity for join')), 10000)
                )
            ]) as any;

            await Promise.race([
                this.p_client.invoke(new Api.channels.JoinChannel({
                    channel: channelEntity
                })),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout joining channel')), 15000)
                )
            ]);

            console.log(`   🎉 Успешно вступил в @${_channelUsername}!`);
            return { type: 'joined' };
        } catch (error: any) {
            // Специальная обработка INVITE_REQUEST_SENT как успеха
            if (error.errorMessage === 'INVITE_REQUEST_SENT') {
                console.log(`   📝 Заявка отправлена в @${_channelUsername}`);
                return { type: 'request_sent' };
            }

            console.log(`   💥 Ошибка вступления в @${_channelUsername}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Маппинг ошибок Telegram в коды
     */
    private p_mapTelegramErrorToCode(_error: any): string {
        if (_error.errorMessage) {
            switch (_error.errorMessage) {
                // Ошибки блокировки/лимитов
                case 'FLOOD_WAIT': return 'FLOOD_WAIT';
                case 'CHANNELS_TOO_MUCH': return 'JOIN_LIMIT_REACHED';

                // Ошибки доступа
                case 'USER_BANNED_IN_CHANNEL': return 'BANNED';
                case 'CHANNEL_PRIVATE': return 'PRIVATE_CHANNEL';
                case 'USERNAME_NOT_OCCUPIED': return 'CHANNEL_NOT_FOUND';
                case 'USERNAME_INVALID': return 'INVALID_USERNAME';

                // Состояние участия
                case 'USER_ALREADY_PARTICIPANT': return 'ALREADY_MEMBER';
                case 'USER_NOT_PARTICIPANT': return 'NOT_MEMBER';

                // Требования канала
                case 'INVITE_REQUEST_SENT': return 'REQUEST_SENT'; // Это успех, не ошибка!
                case 'JOIN_AS_NEEDED': return 'REQUIRES_APPROVAL';

                // Технические ошибки
                case 'PEER_ID_INVALID': return 'INVALID_PEER';
                case 'INPUT_USER_DEACTIVATED': return 'USER_DEACTIVATED';
                case 'AUTH_KEY_UNREGISTERED': return 'AUTH_ERROR';

                default:
                    console.log(`⚠️ Неизвестная ошибка Telegram: ${_error.errorMessage}`);
                    return 'OTHER';
            }
        }
        return 'OTHER';
    }

    /**
     * Получение активных сессий
     */
    getActiveSessions(): IJoinSession[] {
        return Array.from(this.p_activeSessions.values());
    }

    /**
     * Остановка активной сессии
     */
    stopSession(_sessionId: string): boolean {
        const session = this.p_activeSessions.get(_sessionId);
        if (session) {
            session.isActive = false;
            console.log(`⏹️ Сессия ${_sessionId} остановлена`);
            return true;
        }
        return false;
    }

    /**
     * Получение текущих лимитов
     */
    getCurrentLimits(): { daily: number; hourly: number } {
        this.p_resetCountersIfNeeded();
        return {
            daily: this.p_dailyJoinCount,
            hourly: this.p_hourlyJoinCount
        };
    }

    /**
     * Сброс счетчиков если прошел день/час
     */
    private p_resetCountersIfNeeded(): void {
        const now = new Date();

        // Сброс дневного счетчика
        if (now.getDate() !== this.p_lastResetDate.getDate()) {
            this.p_dailyJoinCount = 0;
            this.p_lastResetDate = now;
        }

        // Сброс часового счетчика
        if (now.getHours() !== this.p_lastResetDate.getHours()) {
            this.p_hourlyJoinCount = 0;
        }
    }
} 
 
 
 
 