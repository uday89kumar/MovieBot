// Runs before Chrome is installed: decides whether this workflow run has any
// work, so idle or paused runs finish in seconds. Needs no npm packages.
import fs from 'node:fs/promises';
import { activeWatches, loadConfig } from './config.mjs';
import { dateInTimeZone } from './lib.mjs';
import { loadState } from './github-state.mjs';

async function decide() {
  const config = await loadConfig();
  const today = dateInTimeZone(config.timeZone);
  const watches = activeWatches(config, today);
  if (!watches.length) return { run: false, reason: 'no active watches' };
  const { state } = await loadState();
  if (state.block.pausedUntil && Date.parse(state.block.pausedUntil) > Date.now()) {
    return { run: false, reason: `paused after a Harkins block until ${state.block.pausedUntil}` };
  }
  return { run: true, reason: `${watches.length} active watch(es)` };
}

const result = await decide();
console.log(`Precheck: ${result.run ? 'run' : 'skip'} (${result.reason}).`);
if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `run=${result.run}\n`);
