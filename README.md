# puppetgram

Автоматизация Telegram с AI: управление аккаунтами, комментирование, фильтрация контента.

**Stack:** TypeScript · GramJS · DeepSeek · OpenAI

![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)
![Node.js](https://img.shields.io/badge/Node.js-16+-green)
![License](https://img.shields.io/badge/license-MIT-orange)

---

## Возможности

### Профильная система
- **profile:setup** - Генерация SESSION_STRING через интерактивный ввод
- **profile:update** - Установка имени, username, фото, bio
- Проверка заморозки аккаунта перед операциями
- Двойная проверка через @SpamBot для защиты от спама

### Автоматическое комментирование
- AI-генерация комментариев через DeepSeek/OpenAI
- Ротация аккаунтов с лимитом 100 комментариев/аккаунт
- Детект shadowban - автоматическое переключение при бане
- Проверка через @SpamBot для точной диагностики

### Управление сессиями
- Конвертация SQLite сессий (Telethon/Pyrogram) в GramJS StringSession
- Прослушивание входящих сообщений в реальном времени
- Генерация и проверка TData сессий
- Настройка двухфакторной аутентификации

### Работа с каналами
- Массовая подписка на каналы
- Упрощенный перенос владения каналом
- Объединение списков каналов из разных источников

### AI-фильтрация
- Интерактивная AI-фильтрация каналов
- Автоматическая фильтрация с отпиской
- Фильтрация групп и чатов
- Поиск релевантных каналов через AI

### Анализ и парсинг
- Детальный анализ отдельного канала
- Поиск похожих каналов
- Анализ всех диалогов аккаунта
- Парсинг подписанных каналов
- Парсинг рекомендаций каналов с ротацией аккаунтов
- Анализ топовых постов

### Внешние интеграции
- PostMyPost API для планирования постов
- Планирование постов в Twitter
- Управление проектами PostMyPost

## Требования

- Node.js v16 или выше
- TypeScript v5.7 или выше
- Telegram API credentials ([my.telegram.org](https://my.telegram.org))
- DeepSeek API key (опционально, для AI-функций)
- OpenAI API key (опционально, альтернатива DeepSeek)

## Установка

```bash
npm install
cp .env.example .env
# Отредактируйте .env файл - заполните API_ID, API_HASH и другие параметры
```

## Быстрый старт

```bash
# Установка
npm install
cp .env.example .env

# Заполните .env файл вашими данными
# Затем используйте любую команду из списка ниже
```

<details>
<summary>Доступные команды</summary>

### Управление аккаунтами
- `npm run session:generate` - Генерация сессии
- `npm run session:convert-sqlite` - Конвертация SQLite сессий
- `npm run session:convert-tdata` - Конвертация TData сессий
- `npm run session:check-tdata` - Проверка TData сессий
- `npm run profile:setup` - Создание профильного аккаунта
- `npm run profile:update` - Обновление профиля
- `npm run account:set-username` - Установка username
- `npm run account:setup-2fa` - Настройка 2FA
- `npm run message:listen` - Прослушивание сообщений

### Комментирование
- `npm run comment:profile` - Автокомментирование с ротацией
- `npm run comment:auto` - Простое автокомментирование
- `npm run comment:post-ai` - AI-комментарии
- `npm run comment:check` - Проверка комментариев

### Работа с каналами
- `npm run channel:join` - Подписка на каналы
- `npm run channel:transfer` - Передача прав
- `npm run channel:merge` - Объединение списков

### Анализ и парсинг
- `npm run parse:channel` - Анализ канала
- `npm run parse:similar` - Поиск похожих каналов
- `npm run parse:sources` - Парсинг рекомендаций каналов
- `npm run parse:dialogs` - Анализ диалогов
- `npm run parse:subscribed-channels` - Парсинг подписок
- `npm run analyze:posts` - Анализ топовых постов

### AI-фильтрация
- `npm run filter:auto` - Автофильтрация каналов
- `npm run filter:groups` - Фильтрация групп
- `npm run filter:ai` - Интерактивная фильтрация
- `npm run find:similar` - Поиск похожих каналов

### Интеграции
- `npm run test:postmypost` - Тест API PostMyPost
- `npm run integration:twitter` - Планирование постов Twitter
- `npm run integration:postmypost` - Управление проектами

</details>

## Конфигурация

См. [.env.example](./.env.example) для примера настройки.

Ключевые параметры:
- `API_ID` и `API_HASH` - Telegram API credentials
- `SESSION_STRING_N` - основные аккаунты
- `SESSION_STRING_PROFILE_N` - профильные аккаунты для комментирования
- `SESSION_STRING_PARSER_N` - аккаунты для парсинга рекомендаций
- `MAX_COMMENTS_PER_ACCOUNT` - лимит комментариев (по умолчанию: 100)
- `DEEPSEEK_API_KEY` - для AI-генерации комментариев
- `TARGET_CHANNEL` - username канала для комментирования
- `POSTMYPOST_ACCESS_TOKEN` - для интеграций

## Архитектура

Основные компоненты:
- **GramJS Client** - взаимодействие с Telegram API
- **AI Service** - интеграция с LLM провайдерами (DeepSeek/OpenAI)
- **Account Manager** - управление множественными аккаунтами
- **Account Rotator** - ротация с защитой от лимитов
- **Sources Parser** - парсинг рекомендаций с ротацией аккаунтов
- **Spam Checker** - проверка статуса через @SpamBot
- **Content Analyzer** - анализ и классификация контента
- **Filter Agents** - специализированные агенты для фильтрации

Безопасность:
- Все сессионные данные хранятся локально
- Поддержка двухфакторной аутентификации
- Защита от FloodWait лимитов Telegram
- Контроль rate limits для внешних API
- Детект shadowban с автоматической ротацией

## Мониторинг и логирование

Система автоматически создает:
- Логи выполнения в консоли
- Отчеты в формате JSON в папке `./exports/`
- Файлы состояния для ротации аккаунтов

## Документация

- [Пошаговые инструкции](./user_manuals/how-to/) - детальные руководства по каждому скрипту
- [Глоссарий](./glossary.md) - определения терминов и понятий
- [Устранение неполадок](./user_manuals/troubleshooting/) - решение частых проблем
- [Архитектурная документация](./tech-doc/) - техническая документация системы

## Поддержка и развитие

Данный комплекс активно развивается. Документация обновляется по мере добавления новых функций и компонентов системы.

Для получения помощи обратитесь к соответствующим разделам документации или изучите логи выполнения скриптов для диагностики проблем.

