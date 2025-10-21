/**
 * Автоматизированный скрипт для передачи канала целевого канала
 * Автоматически находит текущего владельца и передает следующему в очереди
 */

import prompts from 'prompts';
import * as dotenv from 'dotenv';
import { ChannelOwnershipRotatorService } from '../../app/ownershipRotator/services/channelOwnershipRotatorService';
import { IOwnershipTransferRequest } from '../../app/ownershipRotator/interfaces/IChannelOwnershipRotator';
import { EnvAccountsParser, Account } from '../../shared/utils/envAccountsParser';

// Загружаем переменные окружения
dotenv.config();

// Получаем пароль для сессии
const getPasswordForSessionKey = (sessionKey: string): string | null => {
    const env = process.env;
    
    // Маппинг SESSION_STRING к PASSWORD
    const passwordMap: { [key: string]: string } = {
        'SESSION_STRING_1': env.PASSWORD_1 || '',
        'SESSION_STRING_2': env.PASSWORD_2 || '',
        'SESSION_STRING_3': env.PASSWORD_3 || '',
        'SESSION_STRING_4': env.PASSWORD_4 || '',
        'SESSION_STRING_5': env.PASSWORD_5 || '',
        'SESSION_STRING_6': env.PASSWORD_6 || '',
        'SESSION_STRING_7': env.PASSWORD_7 || ''
    };
    
    return passwordMap[sessionKey] || null;
};

// Получаем username для сессии (все хранятся с @)
const getUsernameForSessionKey = (sessionKey: string): string | null => {
    const env = process.env;
    
    const usernameMap: { [key: string]: string } = {
        'SESSION_STRING_1': env.USERNAME_1 || '',
        'SESSION_STRING_2': env.USERNAME_2 || '',
        'SESSION_STRING_3': env.USERNAME_3 || '',
        'SESSION_STRING_4': env.USERNAME_4 || '',
        'SESSION_STRING_5': env.USERNAME_5 || '',
        'SESSION_STRING_6': env.USERNAME_6 || '',
        'SESSION_STRING_7': env.USERNAME_7 || ''
    };
    
    return usernameMap[sessionKey] || null;
};

// Автоматический поиск владельца канала целевого канала
async function findDivatozOwner(availableAccounts: Account[]) {
    console.log('🔍 Поиск текущего владельца канала целевого канала...');
    
    const { GramClient } = await import('../../telegram/adapters/gramClient');
    const { CommentPosterService } = await import('../../app/commentPoster');
    
    for (const account of availableAccounts) {
        console.log(`🔎 Проверяю ${account.name}...`);
        
        try {
            // Временно устанавливаем SESSION_STRING для этого аккаунта
            const originalSession = process.env.SESSION_STRING;
            process.env.SESSION_STRING = account.sessionValue;
            
            const gramClient = new GramClient();
            await gramClient.connect();
            
            const commentPoster = new CommentPosterService(gramClient.getClient());
            const userChannels = await commentPoster.getUserChannelsAsync();
            
            const targetChannel = userChannels.find(channel =>
                channel.username?.toLowerCase() === (process.env.TARGET_CHANNEL || '').toLowerCase()
            );

            await gramClient.disconnect();

            // Восстанавливаем оригинальную сессию
            process.env.SESSION_STRING = originalSession;

            if (targetChannel) {
                console.log(`✅ Найден на ${account.name}: ${targetChannel.title}`);
                return account;
            } else {
                console.log(`❌ Не найден на ${account.name}`);
            }
            
        } catch (error) {
            console.log(`⚠️ Ошибка проверки ${account.name}: ${error}`);
            continue;
        }
    }
    
    return null;
}

// Получение следующего аккаунта в очереди ротации
function getNextAccount(currentAccount: Account, availableAccounts: Account[]): Account | null {
    const currentIndex = availableAccounts.findIndex(acc => acc.sessionKey === currentAccount.sessionKey);
    if (currentIndex === -1) return null;
    
    const nextIndex = (currentIndex + 1) % availableAccounts.length;
    return availableAccounts[nextIndex];
}

async function main() {
    console.log('🚀 Автоматическая передача канала целевого канала');

    const parser = new EnvAccountsParser();
    const availableAccounts = parser.getAvailableAccounts();

    if (availableAccounts.length === 0) {
        console.error('❌ Аккаунты не найдены');
        return;
    }

    try {
        // 1. Автоматический поиск текущего владельца целевого канала
        const currentOwner = await findDivatozOwner(availableAccounts);
        
        if (!currentOwner) {
            console.log('❌ Канал целевого канала не найден ни на одном аккаунте!');
            return;
        }
        
        // 2. Выбор режима передачи
        const modeResponse = await prompts({
            type: 'select',
            name: 'mode',
            message: '🔄 Режим передачи:',
            choices: [
                { title: 'Автоматически следующему в очереди', value: 'auto' },
                { title: 'Выбрать получателя вручную', value: 'manual' }
            ]
        });

        if (!modeResponse.mode) {
            console.log('❌ Операция отменена');
            return;
        }

        let senderAccount = currentOwner;
        let receiverAccount;

        if (modeResponse.mode === 'auto') {
            // Автоматический выбор следующего
            receiverAccount = getNextAccount(currentOwner, availableAccounts);
            
            if (!receiverAccount) {
                console.log('❌ Не удалось определить следующий аккаунт');
                return;
            }
            
            console.log(`\n📋 АВТОМАТИЧЕСКАЯ ПЕРЕДАЧА:`);
            console.log(`👤 Текущий владелец: ${currentOwner.name}`);
            console.log(`👥 Следующий владелец: ${receiverAccount.name}`);
        } else {
            // Ручной выбор отправителя и получателя
            const senderResponse = await prompts({
                type: 'select',
                name: 'sender',
                message: '👤 Отправитель (владелец канала):',
                choices: availableAccounts.map(account => ({
                    title: account.name,
                    value: account,
                    description: account.name === currentOwner.name ? '✅ Владелец целевого канала' : ''
                }))
            });

            if (!senderResponse.sender) {
                console.log('❌ Операция отменена');
                return;
            }

            senderAccount = senderResponse.sender as Account;

            const receiverResponse = await prompts({
                type: 'select',
                name: 'receiver',
                message: '👥 Получатель:',
                choices: availableAccounts
                    .filter(account => account.sessionKey !== senderAccount.sessionKey)
                    .map(account => ({
                        title: account.name,
                        value: account,
                        description: getPasswordForSessionKey(account.sessionKey) ? '🔐' : '❌ Нет пароля'
                    }))
            });

            if (!receiverResponse.receiver) {
                console.log('❌ Операция отменена');
                return;
            }

            receiverAccount = receiverResponse.receiver as Account;
            
            console.log(`\n📋 РУЧНАЯ ПЕРЕДАЧА:`);
            console.log(`👤 Отправитель: ${senderAccount.name}`);
            console.log(`👥 Получатель: ${receiverAccount.name}`);
        }
        
        // 3. Подтверждение передачи
        const confirmResponse = await prompts({
            type: 'confirm',
            name: 'confirm',
            message: `Передать целевого канала с ${senderAccount.name} на ${receiverAccount.name}?`,
            initial: true
        });
        
        if (!confirmResponse.confirm) {
            console.log('❌ Операция отменена');
            return;
        }
        
        // 4. Получение учетных данных
        const senderPassword = getPasswordForSessionKey(senderAccount.sessionKey);
        const receiverUsername = getUsernameForSessionKey(receiverAccount.sessionKey);
        
        if (!senderPassword) {
            console.log(`❌ Пароль не найден для аккаунта ${senderAccount.name}`);
            return;
        }
        
        if (!receiverUsername) {
            console.log(`❌ Username не найден для аккаунта ${receiverAccount.name}`);
            return;
        }
        
        // 5. Выполнение передачи
        console.log(`\n🔄 Передача целевого канала → ${receiverUsername}...`);
        
        const transferRequest: IOwnershipTransferRequest = {
            sessionString: senderAccount.sessionValue!,
            channelIdentifier: process.env.TARGET_CHANNEL || '',
            targetUserIdentifier: receiverUsername.replace('@', ''),
            password: senderPassword
        };

        const ownershipService = new ChannelOwnershipRotatorService();
        const result = await ownershipService.transferOwnershipAsync(transferRequest);

        if (result.success) {
            console.log(`\n✅ КАНАЛ УСПЕШНО ПЕРЕДАН!`);
            console.log(`📺 Канал: ${result.channelTitle || process.env.TARGET_CHANNEL}`);
            console.log(`👤 Новый владелец: ${receiverAccount.name} (${receiverUsername})`);
        } else {
            console.log(`\n❌ Не удалось передать канал`);
            
            // Понятные сообщения об ошибках
            if (result.error?.includes('USERNAME_INVALID')) {
                console.log('❓ Проверьте username получателя');
            } else if (result.error?.includes('CHAT_ADMIN_REQUIRED')) {
                console.log('⚠️ У отправителя нет прав владельца канала');
            } else if (result.error?.includes('PASSWORD_HASH_INVALID')) {
                console.log('🔐 Неверный пароль 2FA');
            } else if (result.error?.includes('USER_NOT_PARTICIPANT')) {
                console.log('👤 Получатель должен быть участником канала');
            } else if (result.error?.includes('CHANNELS_ADMIN_PUBLIC_TOO_MUCH')) {
                console.log('📊 У получателя слишком много публичных каналов');
            } else {
                console.log(`💬 ${result.error}`);
            }
        }

    } catch (error: any) {
        console.error(`❌ Ошибка: ${error.message}`);
    }
}

// Запуск скрипта
main().catch(console.error);