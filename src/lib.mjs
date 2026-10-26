export function parseClockMinutes(text) {
  if (!text) return null;
  const match = String(text).match(/\b(1[0-2]|0?[1-9]):([0-5]\d)\s*([AP])\.?M\.?\b/i);
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === 'P') hour += 12;
  return hour * 60 + Number(match[2]);
}

export function formatClock(minutes) {
  const hour24 = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

export function formatDate(yyyyMmDd) {
  const [year, month, day] = yyyyMmDd.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function dateInTimeZone(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function minutesInTimeZone(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

export function addDays(yyyyMmDd, days) {
  const [year, month, day] = yyyyMmDd.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(fromYyyyMmDd, toYyyyMmDd) {
  const toUtc = (value) => {
    const [year, month, day] = value.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(toYyyyMmDd) - toUtc(fromYyyyMmDd)) / 86_400_000);
}

/**
 * Normalize a format label so "CINÉ XL", "Cine XL" and "CINÉXL" compare equal.
 */
export function formatKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Expand a row spec such as "G-M" or "A,C,F-H" into a set of row names.
 * Ranges work on single letters; multi-letter rows (AA) can be listed explicitly.
 */
export function parseRowSpec(value) {
  const rows = new Set();
  for (const part of String(value || '').split(',')) {
    const token = part.trim().toUpperCase();
    if (!token) continue;
    const range = token.match(/^([A-Z])\s*-\s*([A-Z])$/);
    if (range) {
      const start = range[1].charCodeAt(0);
      const end = range[2].charCodeAt(0);
      if (end < start) throw new Error(`Row range "${token}" runs backwards.`);
      for (let code = start; code <= end; code += 1) rows.add(String.fromCharCode(code));
    } else if (/^[A-Z]{1,3}$/.test(token)) {
      rows.add(token);
    } else {
      throw new Error(`Cannot understand row "${token}". Use letters such as "G-M" or "A,C,F-H".`);
    }
  }
  return rows;
}

/**
 * Rows ordered front (nearest the screen) to back. Uses the order supplied by
 * the seat data when present, otherwise the rendered vertical position.
 */
export function rowOrderFromSeats(seats, explicitOrder = null) {
  const present = new Set(seats.map((seat) => seat.row));
  if (explicitOrder?.length) return explicitOrder.filter((row) => present.has(row));
  const byRow = new Map();
  for (const seat of seats) {
    if (!byRow.has(seat.row)) byRow.set(seat.row, []);
    byRow.get(seat.row).push(seat.y);
  }
  return [...byRow.entries()]
    .map(([row, ys]) => ({ row, y: median(ys) }))
    .sort((a, b) => a.y - b.y)
    .map((item) => item.row);
}

/**
 * Choose which rows a watch accepts: explicit row letters win; otherwise a
 * depth band, where 0 is the front row and 1 the back row.
 */
export function allowedRowsFor(seats, { rows = null, depth = [0.35, 0.75] }, explicitOrder = null) {
  if (rows?.size) return new Set([...rows]);
  const order = rowOrderFromSeats(seats, explicitOrder);
  const allowed = new Set();
  order.forEach((row, index) => {
    const center = (index + 0.5) / order.length;
    if (center >= depth[0] && center <= depth[1]) allowed.add(row);
  });
  return allowed;
}

export function median(numbers) {
  const values = numbers.filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

function mergeSeat(existing, incoming) {
  if (!existing) return incoming;
  const status =
    existing.status === 'unavailable' || incoming.status === 'unavailable'
      ? 'unavailable'
      : existing.status === 'available' || incoming.status === 'available'
        ? 'available'
        : 'unknown';
  const existingArea = existing.width * existing.height;
  const incomingArea = incoming.width * incoming.height;
  const geometry = incomingArea > 0 && (existingArea <= 0 || incomingArea < existingArea) ? incoming : existing;
  return { ...geometry, status, evidence: [...new Set([...(existing.evidence || []), ...(incoming.evidence || [])])] };
}

export function dedupeSeats(seats) {
  const map = new Map();
  for (const seat of seats) {
    const key = `${seat.row}${seat.number}`;
    map.set(key, mergeSeat(map.get(key), seat));
  }
  return [...map.values()];
}

/**
 * Return maximal runs of physically adjacent, consecutively numbered available
 * seats whose centers are inside the requested middle portion of each row.
 * Physical spacing is checked so consecutive numbers across a large aisle do not count.
 */
export function findAvailableRuns(rawSeats, minBlockSize = 2, middlePercent = 50) {
  const seats = dedupeSeats(rawSeats);
  const rows = new Map();
  for (const seat of seats) {
    if (!rows.has(seat.row)) rows.set(seat.row, []);
    rows.get(seat.row).push(seat);
  }

  const runs = [];
  for (const [row, rowSeats] of rows.entries()) {
    const positioned = rowSeats
      .filter((seat) => Number.isFinite(seat.x) && Number.isFinite(seat.y) && seat.width > 0 && seat.height > 0)
      .sort((a, b) => a.x - b.x);
    if (positioned.length < minBlockSize) continue;

    const allGaps = [];
    for (let index = 1; index < positioned.length; index += 1) {
      const gap = positioned[index].x - positioned[index - 1].x;
      if (gap > 0) allGaps.push(gap);
    }
    const typicalGap = median(allGaps);
    if (!typicalGap) continue;
    const maxAdjacentGap = typicalGap * 1.72;

    // Keep only seats whose horizontal centers fall inside the requested central
    // portion of the complete row. For 50%, this removes the outer 25% on each side.
    const boundedMiddlePercent = Math.min(100, Math.max(1, Number(middlePercent) || 50));
    const outerFraction = (1 - boundedMiddlePercent / 100) / 2;
    const firstCenter = positioned[0].x;
    const lastCenter = positioned.at(-1).x;
    const rowSpan = lastCenter - firstCenter;
    const middleStart = firstCenter + rowSpan * outerFraction;
    const middleEnd = lastCenter - rowSpan * outerFraction;

    const available = positioned.filter((seat) =>
      seat.status === 'available' && seat.x >= middleStart && seat.x <= middleEnd);

    let run = [];
    const flush = () => {
      if (run.length >= minBlockSize) {
        runs.push({
          row,
          seatObjects: [...run],
          seats: run.map((seat) => `${seat.row}${seat.number}`),
          first: run[0].number,
          last: run.at(-1).number,
          length: run.length,
          centerX: (run[0].x + run.at(-1).x) / 2,
        });
      }
      run = [];
    };

    for (const seat of available) {
      if (!run.length) {
        run = [seat];
        continue;
      }
      const previous = run.at(-1);
      const numberIsConsecutive = Math.abs(seat.number - previous.number) === 1;
      const physicallyAdjacent = seat.x - previous.x <= maxAdjacentGap;
      const sameVerticalBand = Math.abs(seat.y - previous.y) <= Math.max(seat.height, previous.height) * 0.8;
      if (numberIsConsecutive && physicallyAdjacent && sameVerticalBand) run.push(seat);
      else {
        flush();
        run = [seat];
      }
    }
    flush();
  }

  return runs.sort((a, b) => a.row.localeCompare(b.row) || a.first - b.first);
}

function centeredBlock(run, size) {
  const surplus = run.seatObjects.length - size;
  const start = Math.max(0, Math.floor(surplus / 2));
  const selected = run.seatObjects.slice(start, start + size);
  return {
    row: run.row,
    seats: selected.map((seat) => `${seat.row}${seat.number}`),
    first: selected[0].number,
    last: selected.at(-1).number,
    length: selected.length,
  };
}

function assignPatternToRuns(runs, pattern, index = 0, used = new Set(), selected = []) {
  if (index >= pattern.length) return selected;
  const size = pattern[index];

  // Prefer a tighter fit; centeredBlock then chooses the middle seats within that run.
  const candidates = runs
    .map((run, runIndex) => ({ run, runIndex }))
    .filter(({ run, runIndex }) => !used.has(runIndex) && run.length >= size)
    .sort((a, b) => (a.run.length - size) - (b.run.length - size)
      || a.run.row.localeCompare(b.run.row)
      || a.run.first - b.run.first);

  for (const { run, runIndex } of candidates) {
    used.add(runIndex);
    const result = assignPatternToRuns(
      runs,
      pattern,
      index + 1,
      used,
      [...selected, centeredBlock(run, size)],
    );
    if (result) return result;
    used.delete(runIndex);
  }
  return null;
}

export function ticketPatterns(totalTickets, minBlockSize, maxPart = totalTickets) {
  if (totalTickets === 0) return [[]];
  const patterns = [];
  for (let size = Math.min(totalTickets, maxPart); size >= minBlockSize; size -= 1) {
    const remaining = totalTickets - size;
    if (remaining > 0 && remaining < minBlockSize) continue;
    for (const rest of ticketPatterns(remaining, minBlockSize, size)) {
      patterns.push([size, ...rest]);
    }
  }
  return patterns;
}

/**
 * Find the requested number of tickets using adjacent blocks no smaller than
 * minBlockSize. For six tickets with a minimum block of two, the accepted
 * patterns are: 6, 4+2, 3+3, or 2+2+2. With together, only one block is accepted.
 */
export function findTicketPlan(rawSeats, { tickets = 6, minGroup = 2, middlePercent = 50, together = false } = {}) {
  const smallestBlock = together ? tickets : Math.min(minGroup, tickets);
  const runs = findAvailableRuns(rawSeats, smallestBlock, middlePercent);
  const patterns = together ? [[tickets]] : ticketPatterns(tickets, smallestBlock);

  for (const pattern of patterns) {
    const blocks = assignPatternToRuns(runs, pattern);
    if (blocks) {
      return {
        totalTickets: tickets,
        pattern,
        blocks: blocks.sort((a, b) => a.row.localeCompare(b.row) || a.first - b.first),
      };
    }
  }
  return null;
}

/**
 * Both ends are included. A window whose latest time is earlier than its
 * earliest (e.g. 5:00 PM to 3:00 AM) runs past midnight.
 */
export function showtimeInWindow(minutes, earliest = 0, latest = 24 * 60 - 1) {
  if (!Number.isFinite(minutes)) return false;
  if (earliest <= latest) return minutes >= earliest && minutes <= latest;
  return minutes >= earliest || minutes <= latest;
}

// Harkins lists after-midnight shows (e.g. 12:30 AM) under the previous
// evening's date; anything starting before this hour is treated that way.
export const LATE_NIGHT_END_MINUTES = 4 * 60;

/**
 * Calendar date a listed showtime actually starts on.
 */
export function actualShowDate(listedDate, minutes) {
  return minutes < LATE_NIGHT_END_MINUTES ? addDays(listedDate, 1) : listedDate;
}

export function groupsFingerprint(groups) {
  return groups.map((group) => `${group.row}:${group.seats.join(',')}`).sort().join('|');
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function jitter(minMs, maxMs, random = Math.random) {
  return Math.round(minMs + random() * (maxMs - minMs));
}
