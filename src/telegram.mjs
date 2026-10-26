// Telegram's limit is 4096 characters per message; stay under it with margin.
const MAX_MESSAGE_CHARS = 3900;

export function telegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/**
 * Split HTML text on blank lines so no message exceeds Telegram's limit and
 * no tag is cut in half (each alert block is self-contained).
 */
export function chunkMessage(text, limit = MAX_MESSAGE_CHARS) {
  const chunks = [];
  let current = '';
  for (const block of text.split('\n\n')) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    current = block.length <= limit ? block : block.slice(0, limit);
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Send an HTML-formatted message. silent=true delivers without sound.
 * Returns true when every chunk was accepted. The token is never logged.
 */
export async function sendTelegram(html, { silent = false } = {}) {
  if (!telegramConfigured()) {
    console.warn('Telegram is not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID); skipping Telegram.');
    return false;
  }
  const endpoint = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  for (const chunk of chunkMessage(html)) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: chunk,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        disable_notification: silent,
      }),
    }).catch((error) => ({ ok: false, status: 0, text: async () => error.message }));
    if (!response.ok) {
      console.error(`Telegram send failed (${response.status}): ${await response.text()}`);
      return false;
    }
  }
  return true;
}
