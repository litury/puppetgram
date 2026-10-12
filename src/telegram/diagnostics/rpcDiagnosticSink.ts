import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "../../shared/utils/logger";
import { RpcDiagnosticEvent, RpcDiagnosticSink } from "./rpcDiagnostics";

export function createRpcDiagnosticSink(options: {
  directory?: string;
  emit: RpcDiagnosticSink;
  warn: (reason: string) => void;
  maxBytes?: number;
  archiveCount?: number;
}): RpcDiagnosticSink {
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
  const archiveCount = options.archiveCount ?? 9;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 ||
      !Number.isSafeInteger(archiveCount) || archiveCount < 1) {
    throw new Error("Invalid RPC diagnostic rotation settings");
  }
  const file = options.directory ? join(options.directory, "telegram-api.jsonl") : undefined;
  let initialized = false;
  let fileBytes = 0;
  let retryAt = 0;
  const warn = (reason: string): void => {
    try { options.warn(reason); } catch {}
  };
  if (!file) warn("archive_not_configured");

  return (event: RpcDiagnosticEvent): void => {
    try { options.emit(event); } catch {}
    if (!file || Date.now() < retryAt) return;
    try {
      if (!initialized) {
        mkdirSync(options.directory!, { recursive: true, mode: 0o700 });
        fileBytes = existsSync(file) ? statSync(file).size : 0;
        initialized = true;
      }
      const line = JSON.stringify(event) + "\n";
      const bytes = Buffer.byteLength(line);
      if (fileBytes > 0 && fileBytes + bytes > maxBytes) {
        for (let index = archiveCount - 1; index >= 1; index--) {
          const source = `${file}.${index}`;
          if (existsSync(source)) renameSync(source, `${file}.${index + 1}`);
        }
        if (existsSync(file)) renameSync(file, `${file}.1`);
        fileBytes = 0;
      }
      appendFileSync(file, line, { mode: 0o600 });
      fileBytes += bytes;
    } catch {
      initialized = false;
      retryAt = Date.now() + 60_000;
      warn("archive_write_failed");
    }
  };
}

let sharedSink: RpcDiagnosticSink | undefined;

export function getRpcDiagnosticSink(): RpcDiagnosticSink {
  if (!sharedSink) {
    const log = createLogger("TelegramRpcDiagnostics");
    sharedSink = createRpcDiagnosticSink({
      directory: process.env.TELEGRAM_API_DIAGNOSTICS_DIR || undefined,
      emit: (event) => log.info("Telegram RPC diagnostic", event),
      warn: (reason) => log.warn("Архив диагностики Telegram недоступен; события остаются в stdout", { reason }),
    });
  }
  return sharedSink;
}
