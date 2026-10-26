import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  activeWatches,
  attributesMatch,
  loadConfig,
  normalizeConfig,
  showtimeWanted,
  watchDates,
} from './config.mjs';

const base = {
  name: 'test',
  movie: 'the-odyssey',
  theatre: 'arizona-mills-w-imax',
  format: 'IMAX 70mm',
  until: '2026-11-10',
  showtimes: { earliest: '2:00 PM', latest: '11:00 PM' },
  tickets: 6,
  minGroup: 2,
};

const watchOf = (overrides = {}) => normalizeConfig({ watches: [{ ...base, ...overrides }] }).watches[0];

test('the shipped watches.json is valid', async () => {
  const config = await loadConfig(new URL('../watches.json', import.meta.url));
  assert.ok(config.watches.length >= 1);
});

test('normalizes a watch with defaults', () => {
  const watch = watchOf();
  assert.equal(watch.earliest, 14 * 60);
  assert.equal(watch.latest, 23 * 60);
  assert.deepEqual(watch.depth, [0.35, 0.75]);
  assert.equal(watch.middlePercent, 50);
  assert.equal(watch.excludeAccessible, true);
  assert.equal(watch.enabled, true);
  assert.deepEqual(watch.formats.map((format) => format.key), ['imax70mm']);
});

test('"any" format matches everything', () => {
  assert.equal(watchOf({ format: 'any' }).formats, null);
  assert.equal(watchOf({ format: undefined }).formats, null);
});

test('rejects bad config with a clear message', () => {
  assert.throws(() => watchOf({ movie: 'The Odyssey!' }), /movie must be the slug/);
  assert.throws(() => watchOf({ until: 'next week' }), /until is required/);
  assert.throws(() => watchOf({ minGroup: 7 }), /minGroup/);
  assert.throws(() => watchOf({ rows: 'M-G' }), /backwards/);
  assert.throws(() => watchOf({ depth: [0.8, 0.2] }), /depth/);
  assert.throws(() => watchOf({ showtimes: { earliest: 'noonish' } }), /not a time/);
  assert.throws(() => normalizeConfig({ watches: [base, base] }), /unique/);
  assert.throws(() => normalizeConfig({}), /"watches" list/);
});

test('active watches skip disabled and expired ones', () => {
  const config = normalizeConfig({
    watches: [
      { ...base, name: 'on' },
      { ...base, name: 'off', enabled: false },
      { ...base, name: 'old', until: '2026-01-01' },
    ],
  });
  assert.deepEqual(activeWatches(config, '2026-10-25').map((watch) => watch.name), ['on']);
});

test('watch dates run from today or "from" to "until", capped', () => {
  assert.equal(watchDates(watchOf({ until: '2026-10-27' }), '2026-10-25').length, 3);
  assert.deepEqual(watchDates(watchOf({ from: '2026-11-09', until: '2026-11-10' }), '2026-10-25'), ['2026-11-09', '2026-11-10']);
  assert.equal(watchDates(watchOf({ until: '2027-06-01' }), '2026-10-25', 45).length, 45);
});

test('showtimeWanted checks theatre, format, date and time', () => {
  const watch = watchOf();
  const showtime = {
    theatreId: '16', theatreSlug: 'arizona-mills-w-imax', format: 'IMAX 70MM', date: '2026-10-30', minutes: 19 * 60,
  };
  assert.equal(showtimeWanted(watch, showtime, '2026-10-25'), true);
  assert.equal(showtimeWanted(watchOf({ theatre: '16' }), showtime, '2026-10-25'), true);
  assert.equal(showtimeWanted(watch, { ...showtime, theatreSlug: 'chandler-fashion', theatreId: '10' }, '2026-10-25'), false);
  assert.equal(showtimeWanted(watch, { ...showtime, format: 'Digital' }, '2026-10-25'), false);
  assert.equal(showtimeWanted(watch, { ...showtime, minutes: 11 * 60 }, '2026-10-25'), false);
  assert.equal(showtimeWanted(watch, { ...showtime, date: '2026-11-11' }, '2026-10-25'), false);
});

test('seat-page format double-check uses the showtime attributes', () => {
  assert.equal(attributesMatch(watchOf({ format: 'Ciné XL' }), ['CINÉ XL', 'Atmos']), true);
  assert.equal(attributesMatch(watchOf({ format: 'Digital' }), ['Digital Projection']), true);
  assert.equal(attributesMatch(watchOf(), ['CINÉ XL', 'Digital Projection']), false);
  assert.equal(attributesMatch(watchOf({ format: 'any' }), []), true);
});

test('loadConfig reports invalid JSON', async () => {
  const file = new URL('./.tmp-bad-watches.json', import.meta.url);
  await fs.writeFile(file, '{ "watches": [ }');
  try {
    await assert.rejects(loadConfig(file), /not valid JSON/);
  } finally {
    await fs.rm(file, { force: true });
  }
});
