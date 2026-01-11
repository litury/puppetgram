/**
 * Reporter Module - публичный API
 *
 * @example
 * import { ReporterService, IReportStats } from '../../app/reporter';
 *
 * const reporter = new ReporterService();
 * await reporter.sendReport(stats);
 */

export { ReporterService } from './services/reporterService';
export { IReportStats, IAccountStats, IReporterConfig, IFloodWaitInfo } from './interfaces/IReporter';
