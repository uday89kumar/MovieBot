import fs from 'node:fs/promises';
import { addDays, daysBetween, formatKey, parseClockMinutes, parseRowSpec, showtimeInWindow } from './lib.mjs';

export const DEFAULTS = {
  timeZone: 'America/Phoenix',
  maxShowtimePagesPerRun: 10,
  maxSeatMapsPerRun: 8,
  blockPauseHours: 2,
  brokenAfterRuns: 3,
  maxDaysAhead: 45,
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function fail(watchName, message) {
  throw new Error(`watches.json${watchName ? ` (watch "${watchName}")` : ''}: ${message}`);
}

function parseTime(watchName, label, value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const minutes = parseClockMinutes(value);
  if (minutes === null) fail(watchName, `${label} "${value}" is not a time like "2:00 PM".`);
  return minutes;
}

function normalizeFormats(watchName, value) {
  if (value === undefined || value === null || value === 'any') return null;
  const list = Array.isArray(value) ? value : [value];
  if (!list.length || list.some((item) => typeof item !== 'string' || !formatKey(item))) {
    fail(watchName, 'format must be "any", a format name such as "IMAX 70mm", or a list of names.');
  }
  if (list.some((item) => item.toLowerCase() === 'any')) return null;
  return list.map((label) => ({ label, key: formatKey(label) }));
}

export function normalizeWatch(raw, index) {
  const name = typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim() : `watch ${index + 1}`;
  if (!raw || typeof raw !== 'object') fail(name, 'each watch must be an object.');

  const movie = String(raw.movie || '').trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(movie)) {
    fail(name, 'movie must be the slug from the Harkins address, e.g. "the-odyssey" from harkins.com/movies/the-odyssey.');
  }

  const theatre = String(raw.theatre ?? '').trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(theatre)) {
    fail(name, 'theatre must be a slug such as "arizona-mills-w-imax" or a numeric theatre ID. Run "npm run find-ids -- <movie>" to list them.');
  }

  if (!DATE_PATTERN.test(String(raw.until || ''))) fail(name, 'until is required, as YYYY-MM-DD.');
  if (raw.from !== undefined && !DATE_PATTERN.test(String(raw.from))) fail(name, 'from must be YYYY-MM-DD.');

  const tickets = Number(raw.tickets ?? 2);
  const minGroup = Number(raw.minGroup ?? Math.min(2, tickets));
  if (!Number.isInteger(tickets) || tickets < 1 || tickets > 20) fail(name, 'tickets must be a whole number from 1 to 20.');
  if (!Number.isInteger(minGroup) || minGroup < 1 || minGroup > tickets) {
    fail(name, 'minGroup must be a whole number from 1 up to tickets.');
  }

  let rows = null;
  if (raw.rows !== undefined && raw.rows !== null && raw.rows !== '') {
    try {
      rows = parseRowSpec(raw.rows);
    } catch (error) {
      fail(name, error.message);
    }
  }
  const depth = raw.depth ?? [0.35, 0.75];
  if (!Array.isArray(depth) || depth.length !== 2 || !depth.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    || depth[0] > depth[1]) {
    fail(name, 'depth must be two numbers between 0 (front) and 1 (back), e.g. [0.35, 0.75].');
  }

  const middlePercent = Number(raw.middlePercent ?? 50);
  if (!Number.isFinite(middlePercent) || middlePercent < 1 || middlePercent > 100) {
    fail(name, 'middlePercent must be between 1 and 100.');
  }

  const showtimes = raw.showtimes || {};
  const earliest = parseTime(name, 'showtimes.earliest', showtimes.earliest, 0);
  const latest = parseTime(name, 'showtimes.latest', showtimes.latest, 24 * 60 - 1);
  if (earliest > latest) fail(name, 'showtimes.earliest is later than showtimes.latest.');

  return {
    name,
    enabled: raw.enabled !== false,
    movie,
    theatre,
    formats: normalizeFormats(name, raw.format),
    from: raw.from || null,
    until: raw.until,
    earliest,
    latest,
    tickets,
    minGroup,
    together: raw.together === true,
    rows,
    depth,
    middlePercent,
    excludeAccessible: raw.excludeAccessible !== false,
  };
}

export function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.watches)) {
    fail(null, 'the file must contain a "watches" list.');
  }
  const settings = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (raw[key] !== undefined) settings[key] = raw[key];
  }
  const watches = raw.watches.map(normalizeWatch);
  const names = new Set();
  for (const watch of watches) {
    if (names.has(watch.name)) fail(watch.name, 'watch names must be unique.');
    names.add(watch.name);
  }
  return { ...settings, watches };
}

export async function loadConfig(file = process.env.WATCHES_FILE || 'watches.json') {
  const text = await fs.readFile(file, 'utf8');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error.message}`);
  }
  return normalizeConfig(raw);
}

export function activeWatches(config, today) {
  return config.watches.filter((watch) => watch.enabled && watch.until >= today);
}

/**
 * Dates a watch covers from today, limited to maxDaysAhead so a far-off
 * "until" does not explode the number of pages checked.
 */
export function watchDates(watch, today, maxDaysAhead = DEFAULTS.maxDaysAhead) {
  const start = watch.from && watch.from > today ? watch.from : today;
  const lastAllowed = addDays(today, maxDaysAhead - 1);
  const end = watch.until < lastAllowed ? watch.until : lastAllowed;
  if (end < start) return [];
  return Array.from({ length: daysBetween(start, end) + 1 }, (_, offset) => addDays(start, offset));
}

export function theatreMatches(watch, showtime) {
  return watch.theatre === String(showtime.theatreId) || watch.theatre === showtime.theatreSlug;
}

export function formatMatches(watch, formatLabel) {
  if (!watch.formats) return true;
  const key = formatKey(formatLabel);
  return watch.formats.some((format) => format.key === key);
}

/**
 * Whether a showtime from the showtimes page belongs to this watch:
 * right theatre, format, date range and time of day.
 */
export function showtimeWanted(watch, showtime, today) {
  const firstDate = watch.from && watch.from > today ? watch.from : today;
  return showtime.date >= firstDate
    && showtime.date <= watch.until
    && theatreMatches(watch, showtime)
    && formatMatches(watch, showtime.format)
    && showtimeInWindow(showtime.minutes, watch.earliest, watch.latest);
}

/**
 * Seat-page double-check: the showtime's own attribute list must mention the
 * requested format ("Digital" appears there as "Digital Projection", so a
 * containing match is accepted). The exact label was already matched on the
 * showtimes page.
 */
export function attributesMatch(watch, attributes = []) {
  if (!watch.formats) return true;
  const keys = attributes.map(formatKey).filter(Boolean);
  return watch.formats.some((format) => keys.some((key) => key.includes(format.key)));
}
