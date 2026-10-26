import { escapeHtml, formatClock, formatDate } from './lib.mjs';
import { sendGitHubAlert } from './github-alert.mjs';
import { sendTelegram, telegramConfigured } from './telegram.mjs';

export function describePlan(plan) {
  return plan.blocks
    .map((block) => (block.seats.length === 1
      ? `${block.seats[0]}`
      : `${block.seats[0]}–${block.seats.at(-1)} (${block.seats.length})`))
    .join(' + ');
}

function sortAlerts(alerts) {
  return [...alerts].sort((a, b) => a.date.localeCompare(b.date) || a.minutes - b.minutes);
}

export function seatAlertTelegram(alerts) {
  const blocks = sortAlerts(alerts).map((alert) => [
    `<b>${escapeHtml(alert.movieTitle)}</b> · ${escapeHtml(alert.format)} · ${escapeHtml(alert.theatreName)}`,
    `${escapeHtml(formatDate(alert.date))}, ${escapeHtml(formatClock(alert.minutes))}: ${escapeHtml(alert.seatText)}`,
    `<a href="${escapeHtml(alert.url)}">Open seat map</a> · <i>${escapeHtml(alert.watchName)}</i>`,
  ].join('\n'));
  return [`🎟️ <b>Seats available</b> (${alerts.length})`, ...blocks, 'Availability can change any moment.'].join('\n\n');
}

export function seatAlertIssue(alerts) {
  const sorted = sortAlerts(alerts);
  const title = sorted.length === 1
    ? `🎟️ ${sorted[0].movieTitle} ${sorted[0].format}: ${formatDate(sorted[0].date)} ${formatClock(sorted[0].minutes)}`
    : `🎟️ Seats available: ${sorted.length} showtimes`;
  const lines = ['## Seats available', ''];
  for (const alert of sorted) {
    lines.push(
      `### ${alert.movieTitle} · ${alert.format} · ${alert.theatreName}`,
      '',
      `- **When:** ${formatDate(alert.date)}, ${formatClock(alert.minutes)}`,
      `- **Seats:** ${alert.seatText}`,
      `- **Watch:** ${alert.watchName}`,
      `- [Open the Harkins seat map](${alert.url})`,
      '',
    );
  }
  lines.push('> Availability can change any moment.');
  return { title, body: lines.join('\n') };
}

/**
 * Seat alerts go to Telegram (with sound) and to a GitHub issue.
 * Returns true if at least one channel delivered it.
 */
export async function sendSeatAlerts(alerts) {
  if (!alerts.length) return true;
  const telegramSent = await sendTelegram(seatAlertTelegram(alerts));
  let issueSent = false;
  try {
    issueSent = await sendGitHubAlert(seatAlertIssue(alerts));
  } catch (error) {
    console.error(error.message);
  }
  return telegramSent || issueSent;
}

/**
 * Status messages ("blocked", "may be broken") are silent on Telegram. They
 * only fall back to a GitHub issue when Telegram is not set up.
 */
export async function sendStatus(title, text) {
  const html = `<b>${escapeHtml(title)}</b>\n\n${escapeHtml(text)}`;
  if (telegramConfigured()) return sendTelegram(html, { silent: true });
  try {
    return await sendGitHubAlert({ title, body: text });
  } catch (error) {
    console.error(error.message);
    return false;
  }
}
