// Usage: npm run inspect -- <Harkins seat-map URL> [watch name]
// Opens one seat map in a visible browser and prints what MovieBot reads,
// using the named watch's seat rules (or the first watch in watches.json).
import { chromium } from 'playwright';
import { loadConfig } from './config.mjs';
import { allowedRowsFor, findTicketPlan } from './lib.mjs';
import { inspectSession } from './harkins.mjs';

const [url, watchName] = process.argv.slice(2);
if (!url) {
  console.error('Usage: npm run inspect -- <Harkins seat-map URL> [watch name]');
  process.exit(1);
}

const config = await loadConfig();
const watch = config.watches.find((item) => item.name === watchName) || config.watches[0];
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
try {
  const result = await inspectSession(context, { url }, { excludeAccessible: watch?.excludeAccessible !== false });
  let plan = null;
  let rows = [];
  if (result.confidence === 'high' && watch) {
    const allowed = allowedRowsFor(result.seats, watch, result.rowOrder);
    rows = [...allowed];
    plan = findTicketPlan(result.seats.filter((seat) => allowed.has(seat.row)), watch);
  }
  console.log(JSON.stringify({ ...result, seats: undefined, watch: watch?.name, allowedRows: rows, plan }, null, 2));
} finally {
  await browser.close();
}
