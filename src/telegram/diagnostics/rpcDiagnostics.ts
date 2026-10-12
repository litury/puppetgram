import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { TelegramClient, errors } from "telegram";
import { MTProtoSender } from "telegram/network/MTProtoSender";
import { RequestState } from "telegram/network/RequestState";

export type RpcDiagnosticEvent = Record<string, string | number | boolean>;
export type RpcDiagnosticSink = (event: RpcDiagnosticEvent) => void;

const installedClients = new WeakSet<TelegramClient>();

export function installRpcDiagnostics(
  client: TelegramClient,
  account: string,
  sink: RpcDiagnosticSink,
): void {
  if (installedClients.has(client)) return;
  installedClients.add(client);
  const clientId = randomUUID();
  const senders = new WeakSet<MTProtoSender>();
  const requests = new WeakMap<RequestState, { requestId: number; attempt: number }>();
  let requestSequence = 0;

  const emit = (event: RpcDiagnosticEvent): void => {
    try {
      sink({ schemaVersion: 1, time: new Date().toISOString(), account, clientId, ...event });
    } catch {}
  };

  const attach = (sender?: MTProtoSender): void => {
    if (!sender || senders.has(sender)) return;
    senders.add(sender);
    if (typeof sender.addStateToQueue !== "function") {
      emit({ event: "rpc_diagnostics_unavailable", reason: "unsupported_sender" });
      return;
    }
    const enqueue = sender.addStateToQueue;
    sender.addStateToQueue = function (state: RequestState): void {
      const method = state.request?.className;
      if (state.request?.classType !== "request" ||
          typeof method !== "string" || !/^[a-z]+\.[A-Za-z]+$/.test(method) || !state.promise) {
        return enqueue.call(this, state);
      }
      const previous = requests.get(state);
      const request = {
        requestId: previous?.requestId ?? ++requestSequence,
        attempt: (previous?.attempt ?? 0) + 1,
      };
      requests.set(state, request);
      const started = performance.now();
      const fields = { method, ...request };
      emit({ event: "rpc_attempt", ...fields });
      let settled = false;
      const finish = (success: boolean, error?: unknown): void => {
        if (settled) return;
        settled = true;
        const result: RpcDiagnosticEvent = {
          event: "rpc_result", ...fields, success,
          durationMs: Math.round(performance.now() - started),
        };
        if (!success) {
          const failure = error as { code?: unknown; seconds?: unknown } | undefined;
          result.errorType = error instanceof errors.SlowModeWaitError ? "slowmode_wait"
            : error instanceof errors.FloodWaitError || error instanceof errors.FloodTestPhoneWaitError ? "flood_wait"
            : error instanceof errors.RPCError ? "rpc_error" : "local_or_transport_error";
          if (typeof failure?.code === "number" && Number.isFinite(failure.code)) result.rpcCode = failure.code;
          if (typeof failure?.seconds === "number" && Number.isFinite(failure.seconds) && failure.seconds >= 0) {
            result.waitSeconds = failure.seconds;
          }
        }
        emit(result);
      };
      void state.promise.then(() => finish(true), (error: unknown) => finish(false, error));
      try {
        return enqueue.call(this, state);
      } catch (error) {
        finish(false, error);
        throw error;
      }
    };
  };

  const invoke = client.invoke;
  client.invoke = function (this: TelegramClient, request, dcId) {
    attach(this._sender);
    return invoke.call(this, request, dcId);
  } as TelegramClient["invoke"];
  const getSender = client.getSender;
  client.getSender = async function (dcId) {
    const sender = await getSender.call(this, dcId);
    attach(sender);
    return sender;
  };
  const invokeWithSender = client.invokeWithSender;
  client.invokeWithSender = function (this: TelegramClient, request, sender) {
    attach(sender ?? this._sender);
    return invokeWithSender.call(this, request, sender);
  } as TelegramClient["invokeWithSender"];
  emit({ event: "rpc_diagnostics_started", gramjsVersion: client.__version__, coverage: "invoke_queue_attempts" });
}
