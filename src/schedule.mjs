import { daysBetween } from './lib.mjs';

// GitHub cron runs drift by a few minutes; treat an item as due slightly early
// so a 15-minute tier is not skipped every other run.
const DUE_SLACK_MINUTES = 3;

/**
 * How often something dated `date` should be re-checked:
 * within 3 days every run (15 min), 4–14 days hourly, further out every 4 hours.
 */
export function checkIntervalMinutes(today, date) {
  const daysAway = daysBetween(today, date);
  if (daysAway <= 3) return 15;
  if (daysAway <= 14) return 60;
  return 240;
}

/**
 * Pick up to `limit` items to check this run. Items never checked come first
 * (soonest date first), then due items ordered by how overdue they are.
 * Each item needs { date, minutes?, checkedAt? } where checkedAt is ISO time.
 */
export function selectDue(items, { today, now = new Date(), limit }) {
  const nowMs = now.getTime();
  const neverChecked = [];
  const due = [];
  for (const item of items) {
    if (!item.checkedAt) {
      neverChecked.push(item);
      continue;
    }
    const interval = checkIntervalMinutes(today, item.date);
    const elapsed = (nowMs - Date.parse(item.checkedAt)) / 60_000;
    if (elapsed >= interval - DUE_SLACK_MINUTES) due.push({ item, overdue: elapsed / interval });
  }
  const bySoonest = (a, b) => a.date.localeCompare(b.date) || (a.minutes ?? 0) - (b.minutes ?? 0);
  neverChecked.sort(bySoonest);
  due.sort((a, b) => b.overdue - a.overdue || bySoonest(a.item, b.item));
  return [...neverChecked, ...due.map((entry) => entry.item)].slice(0, Math.max(0, limit));
}
