import test from 'node:test';
import assert from 'node:assert/strict';
import { describePlan, seatAlertIssue, seatAlertTelegram } from './notify.mjs';
import { chunkMessage } from './telegram.mjs';

const alert = {
  watchName: 'Odyssey <70mm> & friends',
  url: 'https://harkins.com/ticketing/theatre/16/movie/HO1/session/9/date/2026-10-30',
  movieTitle: 'The Odyssey',
  format: 'IMAX 70mm',
  theatreName: 'Arizona Mills 18 w/ IMAX',
  date: '2026-10-30',
  minutes: 19 * 60 + 20,
  seatText: 'J12–J15 (4) + K10–K11 (2)',
};

test('describes a seat plan', () => {
  const plan = { blocks: [{ seats: ['J12', 'J13', 'J14', 'J15'] }, { seats: ['K10', 'K11'] }, { seats: ['L4'] }] };
  assert.equal(describePlan(plan), 'J12–J15 (4) + K10–K11 (2) + L4');
});

test('telegram alert is escaped HTML with a link', () => {
  const html = seatAlertTelegram([alert]);
  assert.match(html, /<b>The Odyssey<\/b> · IMAX 70mm/);
  assert.match(html, /Fri, Oct 30, 7:20 PM: J12–J15 \(4\) \+ K10–K11 \(2\)/);
  assert.match(html, /<a href="https:\/\/harkins\.com\/ticketing\/[^"]+">Open seat map<\/a>/);
  assert.match(html, /Odyssey &lt;70mm&gt; &amp; friends/);
});

test('issue alert has a title and seat-map link', () => {
  const issue = seatAlertIssue([alert]);
  assert.equal(issue.title, '🎟️ The Odyssey IMAX 70mm: Fri, Oct 30 7:20 PM');
  assert.match(issue.body, /\[Open the Harkins seat map\]\(https:\/\/harkins\.com/);
  assert.equal(seatAlertIssue([alert, { ...alert, date: '2026-10-31' }]).title, '🎟️ Seats available: 2 showtimes');
});

test('long messages are split between alert blocks', () => {
  const blocks = Array.from({ length: 30 }, (_, index) => `block ${index} ${'x'.repeat(200)}`);
  const chunks = chunkMessage(blocks.join('\n\n'), 1000);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 1000));
  assert.equal(chunks.join('\n\n'), blocks.join('\n\n'));
});
