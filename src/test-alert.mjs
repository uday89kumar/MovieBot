import { sendGitHubAlert } from './github-alert.mjs';
import { sendTelegram, telegramConfigured } from './telegram.mjs';

const text = 'MovieBot is set up. Real alerts arrive here when a watch in watches.json finds seats.';

let ok = true;
if (telegramConfigured()) {
  const sent = await sendTelegram(`✅ <b>MovieBot test</b>\n\n${text}`);
  console.log(sent ? 'Telegram test message sent.' : 'Telegram test message FAILED (check the bot token and chat ID).');
  ok &&= sent;
} else {
  console.warn('Telegram secrets are not set: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.');
  ok = false;
}

const issueSent = await sendGitHubAlert({ title: '✅ MovieBot test notification', body: `## Test successful\n\n${text}` })
  .catch((error) => {
    console.error(error.message);
    return false;
  });
ok &&= issueSent;

if (!ok) process.exitCode = 1;
