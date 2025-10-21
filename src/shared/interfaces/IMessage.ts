export interface IMessage {
  id: number;
  message: string;
  date: Date;
  // Метрики для анализа лучших постов
  views?: number;              // Количество просмотров (для каналов)
  forwards?: number;           // Количество пересылок
  reactions?: any;             // Реакции к сообщению
  replies?: any;              // Ответы/комментарии
  editDate?: Date;            // Дата последнего редактирования
  postAuthor?: string;        // Автор поста (для каналов)
  mediaGroupId?: string;      // ID группы медиа (альбомы)
  authorSignature?: string;   // Подпись автора
  // Дополнительные поля для анализа
  fromId?: any;               // ID отправителя
  peerId?: any;               // ID чата/канала
  hasMedia?: boolean;         // Есть ли медиа вложения
  messageLength?: number;     // Длина текста сообщения
  engagement?: number;        // Вычисляемый показатель вовлеченности
}
