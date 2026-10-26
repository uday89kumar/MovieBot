import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, parseState, pruneState, serializeState } from './github-state.mjs';

test('state survives a round trip through the issue body', () => {
  const state = emptyState();
  state.sessions['https://x/session/1'] = { checkedAt: '2026-10-25T00:00:00Z', date: '2026-10-26', alerts: { w: 'G:G5,G6' } };
  state.block.pausedUntil = '2026-10-25T02:00:00Z';
  const parsed = parseState(serializeState(state));
  assert.deepEqual(parsed.sessions, state.sessions);
  assert.equal(parsed.block.pausedUntil, state.block.pausedUntil);
});

test('older or unreadable state starts fresh', () => {
  assert.deepEqual(parseState('<!-- MOVIEBOT_STATE -->\n```json\n{"version":4,"sessions":{"a":1}}\n```'), emptyState());
  assert.deepEqual(parseState('nothing here'), emptyState());
  assert.deepEqual(parseState('<!-- MOVIEBOT_STATE -->\n```json\n{oops\n```'), emptyState());
});

test('prune drops past dates', () => {
  const state = emptyState();
  state.pages['m|2026-10-24'] = { checkedAt: 'x', showtimes: [] };
  state.pages['m|2026-10-25'] = { checkedAt: 'x', showtimes: [] };
  state.sessions.old = { date: '2026-10-24' };
  state.sessions.today = { date: '2026-10-25' };
  pruneState(state, '2026-10-25');
  assert.deepEqual(Object.keys(state.pages), ['m|2026-10-25']);
  assert.deepEqual(Object.keys(state.sessions), ['today']);
});

test('prune trims the furthest pages when the state is too large', () => {
  const state = emptyState();
  const filler = 'x'.repeat(5_000);
  for (let day = 1; day <= 20; day += 1) {
    const date = `2026-11-${String(day).padStart(2, '0')}`;
    state.pages[`m|${date}`] = { checkedAt: 'x', showtimes: [{ note: filler }] };
  }
  pruneState(state, '2026-10-25');
  assert.ok(JSON.stringify(state).length <= 60_000);
  assert.ok(state.pages['m|2026-11-01']);
  assert.equal(state.pages['m|2026-11-20'], undefined);
});
