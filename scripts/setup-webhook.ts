/**
 * Setup Telegram Bot Webhook
 *
 * Usage:
 *   bun run scripts/setup-webhook.ts [webhook_url]
 *
 * Examples:
 *   bun run scripts/setup-webhook.ts https://local-tuna-server.ru.tuna.am/telegram/webhook
 *   bun run scripts/setup-webhook.ts --delete  (to remove webhook and use polling)
 *   bun run scripts/setup-webhook.ts --info    (to check current webhook status)
 */

const BOT_TOKEN = process.env.AUTH_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('AUTH_BOT_TOKEN is not set in environment');
  process.exit(1);
}

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function callApi<T>(method: string, params: Record<string, any> = {}): Promise<T> {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await res.json() as { ok: boolean; result: T; description?: string };

  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description}`);
  }

  return data.result;
}

async function getWebhookInfo() {
  const info = await callApi<{
    url: string;
    has_custom_certificate: boolean;
    pending_update_count: number;
    last_error_date?: number;
    last_error_message?: string;
  }>('getWebhookInfo');

  console.log('\n📡 Current Webhook Status:');
  console.log(`   URL: ${info.url || '(not set - using polling)'}`);
  console.log(`   Pending updates: ${info.pending_update_count}`);

  if (info.last_error_message) {
    const errorDate = info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : 'unknown';
    console.log(`   Last error: ${info.last_error_message} (${errorDate})`);
  }

  return info;
}

async function deleteWebhook() {
  await callApi('deleteWebhook', { drop_pending_updates: false });
  console.log('\n✅ Webhook deleted. Bot will use long polling now.');
}

async function setWebhook(url: string) {
  await callApi('setWebhook', {
    url,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
  });

  console.log(`\n✅ Webhook set successfully!`);
  console.log(`   URL: ${url}`);
}

async function main() {
  const arg = process.argv[2];

  if (!arg) {
    console.log('Usage:');
    console.log('  bun run scripts/setup-webhook.ts <webhook_url>');
    console.log('  bun run scripts/setup-webhook.ts --delete');
    console.log('  bun run scripts/setup-webhook.ts --info');
    console.log('\nExample:');
    console.log('  bun run scripts/setup-webhook.ts https://local-tuna-server.ru.tuna.am/telegram/webhook');
    await getWebhookInfo();
    process.exit(0);
  }

  if (arg === '--info') {
    await getWebhookInfo();
    process.exit(0);
  }

  if (arg === '--delete') {
    await deleteWebhook();
    await getWebhookInfo();
    process.exit(0);
  }

  // Set webhook
  if (!arg.startsWith('https://')) {
    console.error('Webhook URL must start with https://');
    process.exit(1);
  }

  await setWebhook(arg);
  await getWebhookInfo();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
