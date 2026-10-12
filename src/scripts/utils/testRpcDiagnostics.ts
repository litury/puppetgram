import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Api, TelegramClient, errors } from "telegram";
import { Logger } from "telegram/extensions";
import { MTProtoSender } from "telegram/network/MTProtoSender";
import { RequestState } from "telegram/network/RequestState";
import { StringSession } from "telegram/sessions";
import { installRpcDiagnostics, RpcDiagnosticEvent } from "../../telegram/diagnostics/rpcDiagnostics";
import { createRpcDiagnosticSink } from "../../telegram/diagnostics/rpcDiagnosticSink";

function makeSender(respond: (state: RequestState) => void): MTProtoSender {
  return { userDisconnected: false, addStateToQueue: respond } as unknown as MTProtoSender;
}

function makeClient(sender: MTProtoSender): TelegramClient {
  const client = new TelegramClient(new StringSession(""), 1, "SECRET_API_HASH", {
    requestRetries: 3,
    baseLogger: new Logger("none" as any),
  });
  client._sender = sender;
  client._connectedDeferred.resolve();
  return client;
}

async function testActualGramJsRetries(): Promise<void> {
  const events: RpcDiagnosticEvent[] = [];
  const request = new Api.contacts.ResolveUsername({ username: "SECRET_TARGET" });
  const response = { chats: [], users: [], privatePayload: "SECRET_RESPONSE" };
  let attempts = 0;
  const client = makeClient(makeSender((state) => {
    attempts++;
    if (attempts === 1) state.reject(new errors.FloodWaitError({ capture: 0, request }));
    else state.resolve(response);
  }));
  installRpcDiagnostics(client, "Ю4", (event) => events.push(event));
  installRpcDiagnostics(client, "wrong-account", () => assert.fail("Duplicate installation"));
  assert.equal(await client.invoke(request), response);
  assert.equal(attempts, 2);
  const queued = events.filter((event) => event.event === "rpc_attempt");
  const results = events.filter((event) => event.event === "rpc_result");
  assert.deepEqual(queued.map((event) => event.attempt), [1, 2]);
  assert.equal(queued[0].requestId, queued[1].requestId);
  assert.equal(results[0].errorType, "flood_wait");
  assert.equal(results[0].waitSeconds, 0);
  assert.equal(results[0].rpcCode, 420);
  assert.equal(results[1].success, true);
  assert.ok(events.every((event) => event.account === "Ю4"));
  assert.ok(!JSON.stringify(events).includes("SECRET"));
}

async function testErrorsAndIsolation(): Promise<void> {
  const events: RpcDiagnosticEvent[] = [];
  const request = new Api.contacts.ResolveUsername({ username: "SECRET_TARGET" });
  const flood = new errors.FloodWaitError({ capture: 86400, request });
  const client = makeClient(makeSender((state) => state.reject(flood)));
  installRpcDiagnostics(client, "Ю2", (event) => events.push(event));
  await assert.rejects(client.invoke(request), (error) => error === flood);
  assert.equal(events.filter((event) => event.event === "rpc_attempt").length, 1);
  assert.equal(events.at(-1)?.waitSeconds, 86400);
  const slowmode = new errors.SlowModeWaitError({ capture: 10, request });
  client._sender = makeSender((state) => state.reject(slowmode));
  await assert.rejects(client.invoke(request), (error) => error === slowmode);
  assert.equal(events.at(-1)?.errorType, "slowmode_wait");
  const rpcError = new errors.RPCError("SECRET_ERROR_MESSAGE", request, 400);
  client._sender = makeSender((state) => state.reject(rpcError));
  await assert.rejects(client.invoke(request), (error) => error === rpcError);
  assert.equal(events.at(-1)?.rpcCode, 400);
  assert.ok(!JSON.stringify(events).includes("SECRET"));
  const other = makeClient(makeSender((state) => state.resolve({ users: [], chats: [] })));
  installRpcDiagnostics(other, "Ю8", (event) => events.push(event));
  await other.invoke(request);
  assert.equal(events.at(-1)?.account, "Ю8");
  assert.notEqual(events[0].clientId, events.at(-1)?.clientId);
}

async function testOtherSendersAndFailures(): Promise<void> {
  const events: RpcDiagnosticEvent[] = [];
  const request = new Api.contacts.ResolveUsername({ username: "SECRET_TARGET" });
  const response = { users: [], chats: [] };
  const sender = makeSender((state) => state.resolve(response));
  const client = makeClient(sender);
  const exported = makeSender((state) => state.resolve(response));
  client.getSender = async () => exported;
  installRpcDiagnostics(client, "Ю1", (event) => events.push(event));
  await client.invoke(request, 2);
  await client.invokeWithSender(request, exported);
  await client.invoke(request);
  assert.equal(events.filter((event) => event.event === "rpc_attempt").length, 3);
  const localError = new Error("SECRET_TRANSPORT_DETAILS");
  client._sender = makeSender(() => { throw localError; });
  await assert.rejects(client.invoke(request), (error) => error === localError);
  assert.equal(events.at(-1)?.errorType, "local_or_transport_error");
  const brokenSink = makeClient(makeSender((state) => state.resolve(response)));
  installRpcDiagnostics(brokenSink, "Ю5", () => { throw new Error("Disk full"); });
  assert.equal(await brokenSink.invoke(request), response);
  const unavailable = makeClient({ userDisconnected: false } as MTProtoSender);
  installRpcDiagnostics(unavailable, "Ю6", (event) => events.push(event));
  await assert.rejects(unavailable.invoke(request));
  assert.ok(events.some((event) => event.event === "rpc_diagnostics_unavailable"));
}

async function testExhaustedRetriesAndConcurrency(): Promise<void> {
  const events: RpcDiagnosticEvent[] = [];
  const request = new Api.contacts.ResolveUsername({ username: "SECRET_TARGET" });
  const exhausted = makeClient(makeSender((state) => {
    state.reject(new errors.FloodWaitError({ capture: 0, request }));
  }));
  installRpcDiagnostics(exhausted, "Ю3", (event) => events.push(event));
  await assert.rejects(exhausted.invoke(request), /Request was unsuccessful 3 time/);
  assert.deepEqual(events.filter((event) => event.event === "rpc_attempt").map((event) => event.attempt), [1, 2, 3]);
  assert.equal(events.filter((event) => event.errorType === "flood_wait").length, 3);
  const concurrent = makeClient(makeSender((state) => {
    queueMicrotask(() => state.resolve({ users: [], chats: [] }));
  }));
  installRpcDiagnostics(concurrent, "Ю7", (event) => events.push(event));
  await Promise.all([concurrent.invoke(request), concurrent.invoke(request)]);
  const attempts = events.filter((event) => event.account === "Ю7" && event.event === "rpc_attempt");
  assert.equal(attempts.length, 2);
  assert.notEqual(attempts[0].requestId, attempts[1].requestId);
  assert.ok(attempts.every((event) => event.attempt === 1));
}

function testArchive(): void {
  const directory = mkdtempSync(join(tmpdir(), "rpc-diagnostics-"));
  try {
    const events: RpcDiagnosticEvent[] = [];
    const warnings: string[] = [];
    const options = {
      directory, maxBytes: 100, archiveCount: 2,
      emit: (event: RpcDiagnosticEvent) => { events.push(event); },
      warn: (reason: string) => { warnings.push(reason); },
    };
    const first = createRpcDiagnosticSink(options);
    first({ event: "before_restart" });
    const restarted = createRpcDiagnosticSink(options);
    restarted({ event: "after_restart" });
    const file = join(directory, "telegram-api.jsonl");
    assert.ok(readFileSync(file, "utf8").includes("before_restart"));
    assert.ok(readFileSync(file, "utf8").includes("after_restart"));
    assert.equal(statSync(file).mode & 0o777, 0o600);
    for (let index = 0; index < 30; index++) restarted({ event: "rpc_attempt", index });
    assert.deepEqual(readdirSync(directory).sort(), ["telegram-api.jsonl", "telegram-api.jsonl.1", "telegram-api.jsonl.2"]);
    assert.ok(readFileSync(file, "utf8").includes('"index":29'));
    for (const name of readdirSync(directory)) {
      for (const line of readFileSync(join(directory, name), "utf8").trim().split("\n")) JSON.parse(line);
    }
    assert.equal(warnings.length, 0);
    const blockedDirectory = join(directory, "not-a-directory");
    writeFileSync(blockedDirectory, "blocked");
    const broken = createRpcDiagnosticSink({ ...options, directory: blockedDirectory });
    broken({ event: "disk_failure" });
    broken({ event: "still_running" });
    assert.deepEqual(warnings, ["archive_write_failed"]);
    assert.equal(events.at(-1)?.event, "still_running");
    const stdoutOnly = createRpcDiagnosticSink({ ...options, directory: undefined });
    stdoutOnly({ event: "stdout_only" });
    assert.equal(warnings.at(-1), "archive_not_configured");
    assert.equal(events.at(-1)?.event, "stdout_only");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  await testActualGramJsRetries();
  await testErrorsAndIsolation();
  await testOtherSendersAndFailures();
  await testExhaustedRetriesAndConcurrency();
  testArchive();
  console.log("RPC diagnostics tests passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
