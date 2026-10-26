import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actualShowDate,
  addDays,
  allowedRowsFor,
  findAvailableRuns,
  findTicketPlan,
  formatKey,
  parseClockMinutes,
  parseRowSpec,
  showtimeInWindow,
  ticketPatterns,
} from './lib.mjs';

function row(rowName, availableNumbers = [], count = 16, y = 100) {
  const available = new Set(availableNumbers);
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return {
      row: rowName,
      number,
      x: number * 30,
      y,
      width: 20,
      height: 20,
      status: available.has(number) ? 'available' : 'unavailable',
      evidence: [],
    };
  });
}

const sixRule = { tickets: 6, minGroup: 2, middlePercent: 50 };
const patternFor = (seats, rule = sixRule) => findTicketPlan(seats, rule)?.pattern;

test('parses 12-hour times', () => {
  assert.equal(parseClockMinutes('2:15 PM'), 14 * 60 + 15);
  assert.equal(parseClockMinutes('12:00 AM'), 0);
  assert.equal(parseClockMinutes('12:00 PM'), 12 * 60);
  assert.equal(parseClockMinutes('soon'), null);
});

test('adds days across month ends', () => {
  assert.equal(addDays('2026-10-30', 3), '2026-11-02');
});

test('normalizes format names', () => {
  assert.equal(formatKey('CINÉ XL'), formatKey('Cine XL'));
  assert.equal(formatKey('CINÉXL'), 'cinexl');
  assert.equal(formatKey('IMAX 70mm'), 'imax70mm');
});

test('expands row specs', () => {
  assert.deepEqual([...parseRowSpec('G-J')], ['G', 'H', 'I', 'J']);
  assert.deepEqual([...parseRowSpec('a, c, F-G')], ['A', 'C', 'F', 'G']);
  assert.throws(() => parseRowSpec('M-G'));
  assert.throws(() => parseRowSpec('G-'));
});

test('depth picks the middle rows of any room', () => {
  const seats = 'ABCDEFGHIJK'.split('').flatMap((name, index) => row(name, [], 4, index * 40));
  assert.deepEqual([...allowedRowsFor(seats, { depth: [0.35, 0.75] })], ['E', 'F', 'G', 'H']);
  assert.deepEqual([...allowedRowsFor(seats, { depth: [0, 1] })].length, 11);
});

test('depth follows the seat data row order when given', () => {
  const seats = ['A', 'B', 'C', 'D'].flatMap((name) => row(name, [], 4, 100));
  assert.deepEqual([...allowedRowsFor(seats, { depth: [0.5, 1] }, ['D', 'C', 'B', 'A'])], ['B', 'A']);
});

test('explicit rows override depth', () => {
  const seats = ['A', 'B', 'C'].flatMap((name, index) => row(name, [], 4, index * 40));
  assert.deepEqual([...allowedRowsFor(seats, { rows: new Set(['A']), depth: [0.9, 1] })], ['A']);
});

test('showtime window includes both ends', () => {
  assert.equal(showtimeInWindow(14 * 60, 14 * 60, 23 * 60), true);
  assert.equal(showtimeInWindow(23 * 60, 14 * 60, 23 * 60), true);
  assert.equal(showtimeInWindow(13 * 60 + 59, 14 * 60, 23 * 60), false);
  assert.equal(showtimeInWindow(23 * 60 + 1, 14 * 60, 23 * 60), false);
});

test('showtime window can run past midnight', () => {
  const earliest = 17 * 60;
  const latest = 3 * 60;
  assert.equal(showtimeInWindow(19 * 60, earliest, latest), true);
  assert.equal(showtimeInWindow(30, earliest, latest), true);
  assert.equal(showtimeInWindow(3 * 60, earliest, latest), true);
  assert.equal(showtimeInWindow(14 * 60, earliest, latest), false);
  assert.equal(showtimeInWindow(4 * 60, earliest, latest), false);
});

test('after-midnight shows belong to the next calendar day', () => {
  assert.equal(actualShowDate('2026-12-17', 30), '2026-12-18');
  assert.equal(actualShowDate('2026-12-17', 19 * 60), '2026-12-17');
});

test('finds physically adjacent seats', () => {
  const runs = findAvailableRuns(row('G', [7, 8, 9], 16), 3, 50);
  assert.deepEqual(runs[0].seats, ['G7', 'G8', 'G9']);
});

test('does not bridge a large aisle', () => {
  const xs = [30, 60, 90, 200, 230, 260];
  const seats = xs.map((x, index) => ({
    row: 'M', number: index + 1, x, y: 100, width: 20, height: 20,
    status: [3, 4, 5].includes(index + 1) ? 'available' : 'unavailable', evidence: [],
  }));
  assert.equal(findAvailableRuns(seats, 3, 100).length, 0);
});

test('works with seat-plan grid units (gap of 1)', () => {
  const seats = [1, 2, 3, 4, 5, 6, 7, 8].map((number) => ({
    row: 'G', number, x: number, y: 7, width: 1, height: 1,
    status: [3, 4, 5].includes(number) ? 'available' : 'unavailable', evidence: [],
  }));
  assert.deepEqual(findAvailableRuns(seats, 3, 100)[0].seats, ['G3', 'G4', 'G5']);
});

test('ignores adjacent seats in the outer quarter of a row', () => {
  assert.equal(findAvailableRuns(row('H', [1, 2, 3], 12), 3, 50).length, 0);
});

test('rejects a group crossing the middle boundary', () => {
  assert.equal(findAvailableRuns(row('K', [2, 3, 4], 12), 3, 50).length, 0);
});

test('lists the six-ticket patterns', () => {
  assert.deepEqual(ticketPatterns(6, 2), [[6], [4, 2], [3, 3], [2, 2, 2]]);
});

test('accepts six adjacent middle seats', () => {
  assert.deepEqual(patternFor(row('G', [6, 7, 8, 9, 10, 11])), [6]);
});

test('accepts four plus two adjacent seats', () => {
  assert.deepEqual(patternFor([...row('G', [6, 7, 8, 9]), ...row('H', [7, 8], 16, 140)]), [4, 2]);
});

test('accepts three plus three adjacent seats', () => {
  assert.deepEqual(patternFor([...row('J', [6, 7, 8]), ...row('K', [9, 10, 11], 16, 140)]), [3, 3]);
});

test('accepts two plus two plus two adjacent seats', () => {
  const seats = [...row('G', [6, 7]), ...row('H', [8, 9], 16, 140), ...row('M', [10, 11], 16, 180)];
  assert.deepEqual(patternFor(seats), [2, 2, 2]);
});

test('can take four from a five-seat run plus a pair', () => {
  assert.deepEqual(patternFor([...row('G', [5, 6, 7, 8, 9]), ...row('H', [10, 11], 16, 140)]), [4, 2]);
});

test('rejects fewer than six usable tickets', () => {
  assert.equal(patternFor([...row('G', [6, 7, 8]), ...row('H', [9, 10], 16, 140)]), undefined);
});

test('rejects six tickets when any required seat is isolated', () => {
  assert.equal(patternFor(row('G', [6, 7, 8, 10, 12, 14])), undefined);
});

test('rejects qualifying-sized blocks outside the middle 50 percent', () => {
  assert.equal(patternFor(row('G', [1, 2, 3, 4, 5, 6])), undefined);
});

test('together requires one unbroken block', () => {
  const split = [...row('G', [6, 7, 8]), ...row('H', [7, 8, 9], 16, 140)];
  assert.equal(patternFor(split, { ...sixRule, together: true }), undefined);
  assert.deepEqual(patternFor(row('G', [5, 6, 7, 8, 9, 10, 11]), { ...sixRule, together: true }), [6]);
});

test('minGroup 1 allows single seats', () => {
  const seats = row('G', [6, 8, 10]);
  assert.deepEqual(patternFor(seats, { tickets: 3, minGroup: 1, middlePercent: 50 }), [1, 1, 1]);
});

test('picks the centered seats from a longer run', () => {
  const plan = findTicketPlan(row('G', [5, 6, 7, 8, 9, 10]), { tickets: 2, minGroup: 2, middlePercent: 100 });
  assert.deepEqual(plan.blocks[0].seats, ['G7', 'G8']);
});
