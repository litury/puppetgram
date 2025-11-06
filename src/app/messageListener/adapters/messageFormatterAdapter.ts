import { IMessageData } from "../interfaces/messageEvent.interface";

/**
 * Адаптер для форматирования сообщений в читаемый вид
 */
export class MessageFormatterAdapter {
  /**
   * Форматирует сообщение для вывода в консоль
   */
  static formatMessage(message: IMessageData): string {
    const timestamp = this.formatTimestamp(message.date);
    const separator = "─".repeat(60);

    let output = `\n${separator}\n`;
    output += `[${timestamp}] 📩 Новое сообщение\n`;
    output += separator + "\n";

    // Отправитель
    const senderInfo = this.formatSender(message.sender);
    output += `От: ${senderInfo}\n`;
    output += `ID: ${message.sender.id}\n`;

    // Тип чата
    const chatType = this.getChatType(message);
    output += `Тип: ${chatType}\n`;

    // Текст сообщения
    if (message.text) {
      output += `\nТекст:\n${message.text}\n`;
    }

    // Медиа
    if (message.hasMedia && message.mediaType) {
      output += `\nМедиа: ${message.mediaType}\n`;
    }

    output += separator + "\n";

    return output;
  }

  /**
   * Форматирует отправителя
   */
  private static formatSender(sender: any): string {
    const parts: string[] = [];

    if (sender.username) {
      parts.push(`@${sender.username}`);
    }

    if (sender.firstName || sender.lastName) {
      const fullName = [sender.firstName, sender.lastName]
        .filter(Boolean)
        .join(" ");
      parts.push(fullName);
    } else if (sender.phone) {
      parts.push(sender.phone);
    }

    if (sender.isBot) {
      parts.push("[BOT]");
    }

    return parts.length > 0 ? parts.join(" - ") : `User ${sender.id}`;
  }

  /**
   * Определяет тип чата
   */
  private static getChatType(message: IMessageData): string {
    if (message.isPrivate) {
      return "Личное сообщение";
    } else if (message.isGroup) {
      return "Группа";
    } else if (message.isChannel) {
      return "Канал";
    }
    return "Неизвестно";
  }

  /**
   * Форматирует timestamp
   */
  private static formatTimestamp(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, "0");

    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  /**
   * Форматирует краткую статистику
   */
  static formatStats(totalMessages: number, startTime: Date): string {
    const elapsed = Date.now() - startTime.getTime();
    const elapsedMinutes = Math.floor(elapsed / 60000);
    const elapsedSeconds = Math.floor((elapsed % 60000) / 1000);

    return (
      `\n📊 Статистика:\n` +
      `  Получено сообщений: ${totalMessages}\n` +
      `  Время работы: ${elapsedMinutes}м ${elapsedSeconds}с\n`
    );
  }
}
