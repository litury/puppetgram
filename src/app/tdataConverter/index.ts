/**
 * Главный экспорт модуля tdataSessionConverter
 * Конвертация TData в Session String для GramJS
 * Следует стандартам компании согласно project-structure.mdc
 */

// Экспорт интерфейсов
export * from './interfaces';

// Экспорт сервисов
export * from './services';

// Экспорт вспомогательных функций
export * from './parts';

// Главный сервис (для удобства)
export { TdataSessionConverterService } from './services/tdataSessionConverterService'; 