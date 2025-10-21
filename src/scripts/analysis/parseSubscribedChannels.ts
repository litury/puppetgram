/**
 * Анализ подписанных каналов
 * Получает список всех каналов на которые подписан аккаунт из локального кеша
 * Не тратит API лимиты, работает с данными из сессии
 *
 * Запуск: npm run parse:subscribed-channels
 */

import { GramClient } from '../../telegram/adapters/gramClient';
import { EnvAccountsParser, Account } from '../../shared/utils/envAccountsParser';
import { SpamChecker } from '../../shared/services/spamChecker';
import { Api } from 'telegram';
import prompts from 'prompts';

interface ChannelInfo {
    id: string;
    username?: string;
    title: string;
    participantsCount?: number;
    isPublic: boolean;
    isBroadcast: boolean;
    isGigagroup?: boolean;
    canComment: boolean;
    hasDiscussionGroup: boolean;
    linkedChatId?: string;
    lastMessageDate?: Date;
    lastPostId?: number;
    canCommentToLastPost?: boolean;
    spamStatus?: 'clean' | 'spammed' | 'unknown';
}

interface ChannelStats {
    totalChannels: number;
    publicChannels: number;
    privateChannels: number;
    broadcastChannels: number;
    gigagroups: number;
    commentableChannels: number;
    channelsWithUsernames: number;
    channelsWithDiscussionGroups: number;
}

class SubscribedChannelsParser {
    private gramClient!: GramClient;
    private channels: ChannelInfo[] = [];
    private selectedAccountName: string = '';
    private spamChecker: SpamChecker;

    constructor() {
        console.log('🔍 Парсер подписанных каналов запущен');
        console.log('📊 Анализирует локальный кеш подписанных каналов');
        console.log('⚡ Быстро и без расходования API лимитов');
        this.spamChecker = new SpamChecker();
    }

    async start(): Promise<void> {
        try {
            // Выбор аккаунта
            await this.selectAccount();

            // Выбор режима тестирования
            const testMode = await this.selectTestMode();

            // Инициализация
            await this.initialize();

            // Получение каналов из кеша
            await this.parseSubscribedChannels();

            // Тестирование комментирования к постам (если выбрано)
            if (testMode.enabled) {
                // Сначала проверяем аккаунт на спам
                await this.checkAccountSpamStatus();

                // СНАЧАЛА отписываемся от всех заведомо неподходящих каналов
                if (testMode.autoUnsubscribe) {
                    await this.unsubscribeFromNonCommentableChannels();
                }

                // ЗАТЕМ тестируем только потенциально рабочие каналы
                await this.testCommentingOnPosts(testMode.maxChannels, testMode.autoUnsubscribe);
            }

            // Анализ и вывод статистики
            this.displayResults();

            console.log('\n✅ Анализ завершен успешно!');

        } catch (error) {
            console.error('❌ Ошибка при анализе каналов:', error);
        } finally {
            await this.cleanup();
        }
    }

    private async selectTestMode(): Promise<{enabled: boolean, maxChannels: number, autoUnsubscribe: boolean}> {
        const response = await prompts({
            type: 'select',
            name: 'testMode',
            message: 'Выберите режим анализа:',
            choices: [
                {
                    title: 'Быстрый анализ (только метаданные)',
                    value: 'fast',
                    description: 'Анализ структуры каналов без API запросов'
                },
                {
                    title: 'Тест выборочно (настраиваемое количество)',
                    value: 'sample',
                    description: 'Протестировать часть каналов отобранных по метаданным'
                },
                {
                    title: 'Полный тест (все отобранные каналы)',
                    value: 'full',
                    description: 'Реальная проверка ВСЕХ каналов отобранных по метаданным'
                }
            ]
        });

        if (response.testMode === 'fast') {
            console.log('🚀 Быстрый режим - только анализ метаданных');
            return { enabled: false, maxChannels: 0, autoUnsubscribe: false };
        } else if (response.testMode === 'sample') {
            const channelCount = await prompts({
                type: 'number',
                name: 'count',
                message: 'Сколько каналов протестировать?',
                initial: 10,
                min: 1,
                max: 50
            });

            console.log(`🧪 Включен режим выборочного тестирования - ${channelCount.count} каналов`);
            console.log('⚠️ Будут отправляться и удаляться тестовые комментарии к постам');

            const autoUnsubscribe = await this.askAutoUnsubscribe();
            return { enabled: true, maxChannels: channelCount.count || 10, autoUnsubscribe };
        } else {
            console.log('🧪 Включен режим ПОЛНОГО тестирования');
            console.log('⚠️ Будут протестированы ВСЕ каналы отобранные по метаданным');
            console.log('⚠️ Это может занять время в зависимости от количества каналов!');

            const confirm = await prompts({
                type: 'confirm',
                name: 'confirmed',
                message: 'Вы уверены что хотите протестировать ВСЕ отобранные каналы?',
                initial: false
            });

            if (!confirm.confirmed) {
                console.log('❌ Отменено пользователем');
                process.exit(0);
            }

            const autoUnsubscribe = await this.askAutoUnsubscribe();
            return { enabled: true, maxChannels: 9999, autoUnsubscribe };
        }
    }

    private async askAutoUnsubscribe(): Promise<boolean> {
        const response = await prompts({
            type: 'confirm',
            name: 'autoUnsubscribe',
            message: 'Автоматически отписываться от каналов где комментирование недоступно?',
            initial: false
        });

        if (response.autoUnsubscribe) {
            console.log('🗑️ Включена автоматическая отписка от неактивных каналов');
        }

        return response.autoUnsubscribe || false;
    }



    private async selectAccount(): Promise<void> {
        console.log('\n👥 Выбор аккаунта для анализа...');

        const accountsParser = new EnvAccountsParser();
        const accounts = accountsParser.getAvailableAccounts();

        if (accounts.length === 0) {
            throw new Error('Не найдено аккаунтов в .env файле');
        }

        console.log(`📋 Найдено аккаунтов: ${accounts.length}`);

        const choices = accounts.map((account: Account, index: number) => ({
            title: `${account.name} (${account.username || 'без username'})`,
            value: account.name,
            description: `Сессия: ${account.sessionKey}`
        }));

        const response = await prompts({
            type: 'select',
            name: 'selectedAccount',
            message: 'Выберите аккаунт для анализа подписанных каналов:',
            choices: choices,
            initial: 0
        });

        if (!response.selectedAccount) {
            throw new Error('Не выбран аккаунт');
        }

        this.selectedAccountName = response.selectedAccount;
        console.log(`✅ Выбран аккаунт: ${this.selectedAccountName}`);

        // Устанавливаем сессию выбранного аккаунта
        const selectedAccount = accounts.find((acc: Account) => acc.name === this.selectedAccountName);
        if (!selectedAccount) {
            throw new Error(`Аккаунт ${this.selectedAccountName} не найден`);
        }

        process.env.SESSION_STRING = selectedAccount.sessionValue;
        console.log(`🔑 Установлена сессия для аккаунта: ${this.selectedAccountName}`);
    }

    private async initialize(): Promise<void> {
        console.log('\n📱 Подключение к Telegram...');

        this.gramClient = new GramClient();
        await this.gramClient.connect();

        console.log('✅ Подключение установлено');
    }

    private async parseSubscribedChannels(): Promise<void> {
        console.log('\n🔄 Получение ПОЛНОГО списка подписанных каналов...');
        console.log('⚠️ Внимание: При большом количестве каналов возможны FloodWait задержки');

        let dialogCount = 0;
        let channelCount = 0;

        try {
            console.log('🔄 Загружаю ВСЕ диалоги без ограничений...');

            // Убираем лимит чтобы получить ВСЕ каналы
            for await (const dialog of this.gramClient.getClient().iterDialogs()) {
                dialogCount++;

                // Показываем прогресс обработки диалогов
                if (dialogCount % 100 === 0) {
                    console.log(`   📋 Обработано диалогов: ${dialogCount}`);
                }

                // Фильтруем только каналы
                if (this.isChannel(dialog)) {
                    const channelInfo = await this.extractChannelInfo(dialog);
                    this.channels.push(channelInfo);
                    channelCount++;

                    // Показываем прогресс каждые 25 каналов
                    if (channelCount % 25 === 0) {
                        console.log(`   📺 Найдено каналов: ${channelCount}`);
                    }

                    // Добавляем небольшую задержку каждые 100 каналов для безопасности
                    if (channelCount % 100 === 0) {
                        console.log(`   ⏳ Пауза для избежания лимитов (найдено ${channelCount} каналов)...`);
                        await new Promise(resolve => setTimeout(resolve, 3000)); // 3 секунды пауза
                    }
                }
            }

            console.log(`\n📊 ИТОГО обработано диалогов: ${dialogCount}`);
            console.log(`📺 ИТОГО найдено каналов: ${channelCount}`);

            // Дополнительная статистика для отладки
            const nonCommentableChannels = this.channels.filter(ch => !ch.canComment);
            console.log(`🚫 Каналов без группы обсуждений: ${nonCommentableChannels.length}`);
            console.log(`💬 Каналов с возможностью комментирования: ${channelCount - nonCommentableChannels.length}`);

        } catch (error) {
            console.error('❌ Ошибка при получении диалогов:', error);
            console.log(`💡 Последние данные: обработано ${dialogCount} диалогов, найдено ${channelCount} каналов`);
            console.log('💡 Попробуйте запустить скрипт позже, если была FloodWait ошибка');
            throw error;
        }
    }

    private isChannel(dialog: any): boolean {
        const entity = dialog.entity;

        // Проверяем что это канал (не группа, не личный чат)
        return entity &&
               entity.className === 'Channel' &&
               entity.broadcast === true; // broadcast = true означает канал
    }

    private async extractChannelInfo(dialog: any): Promise<ChannelInfo> {
        const entity = dialog.entity;

        // Детальная проверка наличия группы обсуждений
        const hasLinkedChatId = !!(entity.linkedChatId && entity.linkedChatId.toString() !== '0');
        const hasLinkField = !!(entity.hasLink);
        const hasDiscussionGroup = hasLinkedChatId || hasLinkField;
        const linkedChatId = entity.linkedChatId ? entity.linkedChatId.toString() : undefined;

        // Расширенная проверка возможности комментирования
        const basicChecks = !entity.noforwards &&
                           !entity.restrictedReason &&
                           !entity.left &&
                           !entity.forbidden &&
                           !entity.restricted;

        // Дополнительные проверки для каналов
        const channelSpecificChecks = entity.broadcast && // Это канал
                                     !entity.megagroup && // Не мегагруппа
                                     !entity.gigagroup; // Не гигагруппа

        // Проверяем права администратора/создателя
        const hasAdminRights = entity.adminRights || entity.creator;

        // Итоговая проверка возможности комментирования
        const canComment = hasDiscussionGroup &&
                          basicChecks &&
                          channelSpecificChecks;

        // Логирование для отладки с возможностью тестирования
        if (entity.username || hasDiscussionGroup) {
            console.log(`   🔍 ${entity.title || 'Без названия'}:`);
            console.log(`      - hasLinkedChatId: ${hasLinkedChatId} (${linkedChatId})`);
            console.log(`      - hasLink: ${hasLinkField}`);
            console.log(`      - hasDiscussionGroup: ${hasDiscussionGroup}`);
            console.log(`      - basicChecks: ${basicChecks}`);
            console.log(`      - channelSpecificChecks: ${channelSpecificChecks}`);
            console.log(`      - canComment (без тестирования): ${canComment}`);


            console.log(`      ---`);
        }

        return {
            id: entity.id.toString(),
            username: entity.username || undefined,
            title: dialog.title || entity.title || 'Без названия',
            participantsCount: entity.participantsCount || undefined,
            isPublic: !!entity.username,
            isBroadcast: entity.broadcast || false,
            isGigagroup: entity.gigagroup || false,
            canComment: canComment,
            hasDiscussionGroup: hasDiscussionGroup,
            linkedChatId: linkedChatId,
            lastMessageDate: dialog.date ? new Date(dialog.date * 1000) : undefined,
            lastPostId: undefined,
            canCommentToLastPost: undefined,
            spamStatus: 'unknown'
        };
    }

    /**
     * Проверяет спам-статус текущего аккаунта
     */
    private async checkAccountSpamStatus(): Promise<void> {
        console.log('\n🛡️ ПРОВЕРКА СПАМ-СТАТУСА АККАУНТА');
        console.log('═══════════════════════════════════');

        try {
            const spamCheckResult = await this.spamChecker.checkAccountSpamStatus(
                this.gramClient.getClient(),
                this.selectedAccountName
            );

            if (spamCheckResult.isSpammed) {
                console.log('❌ АККАУНТ ЗАСПАМЛЕН - комментирование может быть ограничено');
                if (spamCheckResult.rawResponse) {
                    console.log(`📋 Ответ бота: ${spamCheckResult.rawResponse}`);
                }
                console.log('💡 Рекомендация: используйте другой аккаунт или подождите');
            } else {
                console.log('✅ АККАУНТ ЧИСТЫЙ - комментирование доступно');
                console.log(`📋 Можно отправлять сообщения: ${spamCheckResult.canSendMessages ? 'ДА' : 'НЕТ'}`);
            }

            // Обновляем спам-статус для всех каналов с группами обсуждений
            const spamStatus = spamCheckResult.isSpammed ? 'spammed' : 'clean';
            this.channels.forEach(channel => {
                if (channel.hasDiscussionGroup) {
                    channel.spamStatus = spamStatus;
                }
            });

        } catch (error: any) {
            console.log(`⚠️ Не удалось проверить спам-статус: ${error.message}`);
            console.log('🔄 Продолжаем тестирование без проверки спама');
        }
    }

    /**
     * Тестирует возможность комментирования к последним постам каналов
     */
    private async testCommentingOnPosts(maxChannels: number = 5, autoUnsubscribe: boolean = false): Promise<void> {
        console.log('\n🧪 ТЕСТИРОВАНИЕ КОММЕНТИРОВАНИЯ К ПОСТАМ');
        console.log('═══════════════════════════════════════');

        // Берем каналы которые по метаданным можно комментировать
        const commentableChannels = this.channels.filter(ch => ch.canComment);
        console.log(`📊 Найдено каналов доступных для комментирования (по метаданным): ${commentableChannels.length}`);

        if (commentableChannels.length === 0) {
            console.log('❌ Нет каналов доступных для комментирования по метаданным');
            return;
        }

        let testedCount = 0;

        // Ограничиваем количество тестируемых каналов
        const channelsToTest = maxChannels >= 9999 ? commentableChannels : commentableChannels.slice(0, maxChannels);

        console.log(`🎯 Будет протестировано каналов: ${channelsToTest.length} из ${commentableChannels.length}`);

        for (const channel of channelsToTest) {
            console.log(`\n📺 Тестирую: ${channel.title} (${channel.username || channel.id})`);

            // Показываем предупреждение если аккаунт заспамлен
            if (channel.spamStatus === 'spammed') {
                console.log('   ⚠️ ВНИМАНИЕ: Аккаунт заспамлен - тест может провалиться');
            }

            try {
                // Получаем последний пост канала
                const lastPost = await this.getLastChannelPost(channel.id);

                if (!lastPost) {
                    console.log('   ⚠️ Не удалось получить последний пост');
                    continue;
                }

                channel.lastPostId = lastPost.id;
                console.log(`   📄 Найден пост ID: ${lastPost.id}`);

                // Тестируем комментирование к этому посту
                const canComment = await this.testCommentToPost(channel.id, lastPost.id);
                channel.canCommentToLastPost = canComment;

                console.log(`   ${canComment ? '✅' : '❌'} Комментирование: ${canComment ? 'ВОЗМОЖНО' : 'НЕДОСТУПНО'}`);

                // Автоотписка если комментирование недоступно
                if (!canComment && autoUnsubscribe) {
                    await this.unsubscribeFromChannel(channel);
                }

                testedCount++;

                // Пауза между тестами
                await new Promise(resolve => setTimeout(resolve, 3000));

            } catch (error: any) {
                console.log(`   ❌ Ошибка при тестировании: ${error.message}`);
            }
        }

        console.log(`\n📊 Протестировано каналов: ${testedCount}/${commentableChannels.length}`);

        if (testedCount < commentableChannels.length && maxChannels < 9999) {
            console.log(`💡 Для тестирования всех каналов запустите в режиме "Полный тест"`);
            console.log(`⚠️ Осталось непротестированных: ${commentableChannels.length - testedCount} каналов`);
        }
    }

    /**
     * Получает последний пост канала
     */
    private async getLastChannelPost(channelId: string): Promise<any> {
        try {
            const messages = await this.gramClient.getClient().getMessages(channelId, {
                limit: 1
            });

            return messages.length > 0 ? messages[0] : null;
        } catch (error) {
            console.log(`      ⚠️ Не удалось получить посты канала: ${error}`);
            return null;
        }
    }

    /**
     * Тестирует отправку комментария к конкретному посту через группу обсуждений
     */
    private async testCommentToPost(channelId: string, postId: number): Promise<boolean> {
        try {
            const testComment = "•"; // Минимальный тестовый комментарий

            // Получаем информацию о группе обсуждений для этого поста
            const result = await this.gramClient.getClient().invoke(
                new Api.messages.GetDiscussionMessage({
                    peer: channelId,
                    msgId: postId,
                })
            );

            if (!result.messages || result.messages.length === 0) {
                console.log(`      ❌ Нет группы обсуждений для поста ${postId}`);
                return false;
            }

            const discussionMessage = result.messages[0];
            const discussionPeer = discussionMessage.peerId || channelId; // Fallback к каналу

            if (!discussionPeer) {
                console.log(`      ❌ Не удалось определить peer группы обсуждений`);
                return false;
            }

            console.log(`      🔍 Найдена группа обсуждений для поста ${postId}`);

            // Отправляем комментарий в группу обсуждений
            const sentComment = await this.gramClient.getClient().sendMessage(discussionPeer, {
                message: testComment,
                replyTo: discussionMessage.id
            });

            console.log(`      ✅ Тестовый комментарий отправлен в группу обсуждений`);

            // Немедленно удаляем комментарий из группы обсуждений
            if (sentComment && sentComment.id) {
                await this.gramClient.getClient().deleteMessages(discussionPeer, [sentComment.id], {
                    revoke: true
                });
                console.log(`      🗑️ Тестовый комментарий удален из группы обсуждений`);
            }

            return true;

        } catch (error: any) {
            console.log(`      ❌ Не удалось отправить комментарий: ${error.message}`);
            return false;
        }
    }

    /**
     * Отписывается от канала
     */
    private async unsubscribeFromChannel(channel: ChannelInfo): Promise<void> {
        try {
            console.log(`   🗑️ Отписываюсь от канала: ${channel.title}`);

            // Используем API для отписки от канала
            await this.gramClient.getClient().invoke(
                new Api.channels.LeaveChannel({
                    channel: channel.username || channel.id
                })
            );

            console.log(`   ✅ Успешно отписался от канала: ${channel.title}`);

            // Помечаем в данных что отписались
            channel.spamStatus = 'unsubscribed' as any;

        } catch (error: any) {
            console.log(`   ❌ Не удалось отписаться от канала ${channel.title}: ${error.message}`);
        }
    }

    /**
     * Отписывается от всех каналов которые не подходят для комментирования
     */
    private async unsubscribeFromNonCommentableChannels(): Promise<void> {
        console.log('\n🧹 МАССОВАЯ ОТПИСКА ОТ НЕПОДХОДЯЩИХ КАНАЛОВ');
        console.log('═══════════════════════════════════════════════');

        // Группируем каналы по причинам отписки
        const noMetadataChannels = this.channels.filter(channel =>
            (channel.spamStatus as any) !== 'unsubscribed' && !channel.canComment
        );

        const failedTestChannels = this.channels.filter(channel =>
            (channel.spamStatus as any) !== 'unsubscribed' &&
            channel.canComment &&
            channel.canCommentToLastPost === false
        );

        const totalToUnsubscribe = noMetadataChannels.length + failedTestChannels.length;

        console.log(`📊 СТАТИСТИКА ОТПИСКИ:`);
        console.log(`   📺 Всего каналов загружено: ${this.channels.length}`);
        console.log(`   🚫 Без группы обсуждений (по метаданным): ${noMetadataChannels.length}`);
        console.log(`   ❌ Протестированы и не работают: ${failedTestChannels.length}`);
        console.log(`   📊 ИТОГО для отписки: ${totalToUnsubscribe}`);

        if (totalToUnsubscribe > 0) {
            console.log(`   📋 После отписки останется каналов: ${this.channels.length - totalToUnsubscribe}`);
        }

        if (totalToUnsubscribe === 0) {
            console.log('✅ Нет каналов для отписки');
            return;
        }

        // Подтверждение массовой отписки
        const confirmUnsubscribe = await prompts({
            type: 'confirm',
            name: 'proceed',
            message: `Отписаться от ${totalToUnsubscribe} каналов?`,
            initial: true
        });

        if (!confirmUnsubscribe.proceed) {
            console.log('⏸️ Отписка отменена пользователем');
            return;
        }

        let unsubscribedCount = 0;
        let errorCount = 0;

        // Сначала отписываемся от каналов без групп обсуждений (приоритет)
        if (noMetadataChannels.length > 0) {
            console.log(`\n🔄 Отписка от ${noMetadataChannels.length} каналов без групп обсуждений...`);

            for (let index = 0; index < noMetadataChannels.length; index++) {
                const channel = noMetadataChannels[index];
                try {
                    console.log(`[${index + 1}/${noMetadataChannels.length}] 🗑️ ${channel.title || channel.username}`);

                    await this.gramClient.getClient().invoke(
                        new Api.channels.LeaveChannel({
                            channel: channel.username || channel.id
                        })
                    );

                    channel.spamStatus = 'unsubscribed' as any;
                    unsubscribedCount++;
                    console.log(`   ✅ Отписался успешно`);

                    // Короткая пауза для избежания флуда
                    await new Promise(resolve => setTimeout(resolve, 800));

                } catch (error: any) {
                    console.log(`   ❌ Ошибка отписки: ${error.message}`);
                    errorCount++;
                }
            }
        }

        // Затем отписываемся от протестированных нерабочих каналов
        if (failedTestChannels.length > 0) {
            console.log(`\n🔄 Отписка от ${failedTestChannels.length} протестированных нерабочих каналов...`);

            for (let index = 0; index < failedTestChannels.length; index++) {
                const channel = failedTestChannels[index];
                try {
                    console.log(`[${index + 1}/${failedTestChannels.length}] 🗑️ ${channel.title || channel.username}`);

                    await this.gramClient.getClient().invoke(
                        new Api.channels.LeaveChannel({
                            channel: channel.username || channel.id
                        })
                    );

                    channel.spamStatus = 'unsubscribed' as any;
                    unsubscribedCount++;
                    console.log(`   ✅ Отписался успешно`);

                    // Короткая пауза для избежания флуда
                    await new Promise(resolve => setTimeout(resolve, 800));

                } catch (error: any) {
                    console.log(`   ❌ Ошибка отписки: ${error.message}`);
                    errorCount++;
                }
            }
        }

        console.log(`\n📊 РЕЗУЛЬТАТ МАССОВОЙ ОТПИСКИ:`);
        console.log(`   ✅ Успешно отписался: ${unsubscribedCount} каналов`);
        console.log(`   ❌ Ошибок отписки: ${errorCount} каналов`);
        console.log(`   🎯 Оставлены только потенциально рабочие каналы для тестирования`);
    }

    private displayResults(): void {
        console.log('\n═══ РЕЗУЛЬТАТЫ АНАЛИЗА ═══');

        const stats = this.calculateStats();

        console.log(`\n📊 Общая статистика:`);
        console.log(`   📺 Всего каналов: ${stats.totalChannels}`);
        console.log(`   🌐 Публичных: ${stats.publicChannels}`);
        console.log(`   🔒 Приватных: ${stats.privateChannels}`);
        console.log(`   📡 Broadcast каналов: ${stats.broadcastChannels}`);
        console.log(`   🏢 Гигагрупп: ${stats.gigagroups}`);
        console.log(`   💬 Доступно для комментирования: ${stats.commentableChannels}`);
        console.log(`   💭 С группами обсуждений: ${stats.channelsWithDiscussionGroups}`);
        console.log(`   @ С username: ${stats.channelsWithUsernames}`);

        // Статистика отписки
        const unsubscribedChannels = this.channels.filter(ch => (ch.spamStatus as any) === 'unsubscribed');
        if (unsubscribedChannels.length > 0) {
            console.log(`\n🗑️ Статистика отписки:`);
            console.log(`   📤 Отписались от каналов: ${unsubscribedChannels.length}`);
            console.log(`   📊 Остались подписанными: ${stats.totalChannels - unsubscribedChannels.length}`);
        }

        // Топ-10 каналов по количеству подписчиков
        const topChannels = this.channels
            .filter(ch => ch.participantsCount)
            .sort((a, b) => (b.participantsCount || 0) - (a.participantsCount || 0))
            .slice(0, 10);

        if (topChannels.length > 0) {
            console.log(`\n🏆 Топ-10 каналов по подписчикам:`);
            topChannels.forEach((channel, index) => {
                const username = channel.username ? `@${channel.username}` : 'приватный';
                console.log(`   ${index + 1}. ${channel.title} (${username}) - ${channel.participantsCount} подписчиков`);
            });
        }

        // Каналы доступные для комментирования
        const commentableChannels = this.channels.filter(ch => ch.canComment);
        const testedChannels = this.channels.filter(ch => ch.canCommentToLastPost !== undefined);
        const reallyCommentableChannels = this.channels.filter(ch => ch.canCommentToLastPost === true);
        const unsubscribedFromTesting = this.channels.filter(ch => (ch.spamStatus as any) === 'unsubscribed');

        console.log(`\n💬 Каналы доступные для комментирования (по метаданным): ${commentableChannels.length}`);

        if (testedChannels.length > 0) {
            console.log(`🧪 Протестировано реально: ${testedChannels.length}`);
            console.log(`✅ Подтверждено работающих: ${reallyCommentableChannels.length}`);

            if (unsubscribedFromTesting.length > 0) {
                console.log(`🗑️ Автоматически отписался: ${unsubscribedFromTesting.length} каналов`);
            }
        }

        console.log(`\n📋 Список каналов с результатами проверки:`);
        const displayChannels = testedChannels.length > 0 ? testedChannels : commentableChannels;

        displayChannels.slice(0, 20).forEach(channel => {
            const username = channel.username ? `@${channel.username}` : channel.id;
            let status = '';
            let spamWarning = '';

            if (channel.canCommentToLastPost === true) {
                status = '✅ Тестировано - РАБОТАЕТ';
            } else if (channel.canCommentToLastPost === false) {
                status = '❌ Тестировано - НЕ РАБОТАЕТ';
            } else if (channel.canComment) {
                status = '🔍 По метаданным - возможно';
            } else {
                status = '❌ По метаданным - невозможно';
            }

            // Добавляем предупреждение о спаме и статус отписки
            if ((channel.spamStatus as any) === 'unsubscribed') {
                spamWarning = ' 🗑️ ОТПИСАЛСЯ';
            } else if (channel.spamStatus === 'spammed') {
                spamWarning = ' 🚫 СПАМ';
            } else if (channel.spamStatus === 'clean') {
                spamWarning = ' ✅ ЧИСТЫЙ';
            }

            console.log(`   📺 ${channel.title} (${username}) - ${status}${spamWarning}`);
        });

        if (displayChannels.length > 20) {
            console.log(`   ... и еще ${displayChannels.length - 20} каналов`);
        }
    }

    private calculateStats(): ChannelStats {
        return {
            totalChannels: this.channels.length,
            publicChannels: this.channels.filter(ch => ch.isPublic).length,
            privateChannels: this.channels.filter(ch => !ch.isPublic).length,
            broadcastChannels: this.channels.filter(ch => ch.isBroadcast).length,
            gigagroups: this.channels.filter(ch => ch.isGigagroup).length,
            commentableChannels: this.channels.filter(ch => ch.canComment).length,
            channelsWithUsernames: this.channels.filter(ch => ch.username).length,
            channelsWithDiscussionGroups: this.channels.filter(ch => ch.hasDiscussionGroup).length
        };
    }


    private async cleanup(): Promise<void> {
        try {
            await this.gramClient.disconnect();
            console.log('👋 Отключение от Telegram');
        } catch (error) {
            console.warn('⚠️ Ошибка при отключении:', error);
        }
    }
}

// Запуск скрипта
async function main() {
    const parser = new SubscribedChannelsParser();
    await parser.start();
}

main().catch(error => {
    console.error('💥 Критическая ошибка:', error);
    process.exit(1);
});