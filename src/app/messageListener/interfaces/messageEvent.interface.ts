/**
 * Информация об отправителе сообщения
 */
export interface IMessageSender {
  id: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  isBot: boolean;
}

/**
 * Информация о сообщении
 */
export interface IMessageData {
  id: number;
  text?: string;
  date: Date;
  sender: IMessageSender;
  chatId: number;
  isPrivate: boolean;
  isGroup: boolean;
  isChannel: boolean;
  hasMedia: boolean;
  mediaType?: string;
}

/**
 * Событие нового сообщения
 */
export interface INewMessageEvent {
  message: IMessageData;
  timestamp: Date;
}
