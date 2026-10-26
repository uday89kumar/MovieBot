import test from 'node:test';
import assert from 'node:assert/strict';
import { checkIntervalMinutes, selectDue } from './schedule.mjs';

const today = '2026-10-25';
const now = new Date('2026-10-25T20:00:00Z');
const ago = (minutes) => new Date(now.getTime() - minutes * 60_000).toISOString();

test('check interval grows with distance', () => {
  assert.equal(checkIntervalMinutes(today, '2026-10-25'), 15);
  assert.equal(checkIntervalMinutes(today, '2026-10-28'), 15);
  assert.equal(checkIntervalMinutes(today, '2026-10-29'), 60);
  assert.equal(checkIntervalMinutes(today, '2026-11-08'), 60);
  assert.equal(checkIntervalMinutes(today, '2026-11-09'), 240);
});

test('never-checked items come first, soonest first', () => {
  const items = [
    { id: 'old', date: '2026-10-26', checkedAt: ago(120) },
    { id: 'new-late', date: '2026-11-20' },
    { id: 'new-soon', date: '2026-10-26', minutes: 600 },
  ];
  assert.deepEqual(selectDue(items, { today, now, limit: 3 }).map((item) => item.id), ['new-soon', 'new-late', 'old']);
});

test('items not yet due are skipped', () => {
  const items = [
    { id: 'near-fresh', date: '2026-10-26', checkedAt: ago(5) },
    { id: 'far-fresh', date: '2026-11-20', checkedAt: ago(120) },
    { id: 'near-due', date: '2026-10-26', checkedAt: ago(14) },
  ];
  assert.deepEqual(selectDue(items, { today, now, limit: 10 }).map((item) => item.id), ['near-due']);
});

test('most overdue first and the cap is respected', () => {
  const items = [
    { id: 'a', date: '2026-10-26', checkedAt: ago(30) },
    { id: 'b', date: '2026-10-26', checkedAt: ago(90) },
    { id: 'c', date: '2026-11-01', checkedAt: ago(70) },
  ];
  assert.deepEqual(selectDue(items, { today, now, limit: 2 }).map((item) => item.id), ['b', 'a']);
});
