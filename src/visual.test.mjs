import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySeat, histogramSimilarity, legendLooksValid, legendRole } from './visual.mjs';

// Colour mixes measured on a live Harkins seat map (Oct 2026): gold lounger,
// dark-grey unavailable, blue accessible, on a navy background.
const references = [
  { role: 'accessible', histogram: { '51,102,153': 0.76, '0,51,51': 0.05, '102,102,153': 0.04, '153,153,204': 0.04 } },
  { role: 'accessible', histogram: { '51,102,153': 0.48, '51,51,102': 0.22, '0,51,51': 0.18, '0,0,51': 0.06 } },
  { role: 'available', histogram: { '204,153,51': 0.50, '51,51,51': 0.13, '102,102,51': 0.10, '0,51,51': 0.10 } },
  { role: 'unavailable', histogram: { '51,51,51': 0.72, '0,51,51': 0.28 } },
];

test('labels legend entries by their text', () => {
  assert.equal(legendRole('Ultimate Lounger', 'ultimate-lounger'), 'available');
  assert.equal(legendRole('Unavailable', 'seating-unavailable'), 'unavailable');
  assert.equal(legendRole('Wheelchair', 'seating-accessible'), 'accessible');
  assert.equal(legendRole('Accessible Companion', 'companion-seat'), 'accessible');
  assert.equal(legendRole('Selected'), null);
});

test('histogram similarity is the shared share of colour', () => {
  assert.equal(histogramSimilarity({ a: 0.5, b: 0.5 }, { a: 0.5, b: 0.5 }), 1);
  assert.equal(histogramSimilarity({ a: 1 }, { b: 1 }), 0);
  assert.ok(Math.abs(histogramSimilarity({ a: 0.7, b: 0.3 }, { a: 0.4, c: 0.6 }) - 0.4) < 1e-9);
});

test('classifies live seat colour mixes', () => {
  assert.equal(classifySeat({ '204,153,51': 0.92, '153,102,51': 0.05, '0,0,51': 0.02, '51,51,51': 0.01 }, references), 'available');
  assert.equal(classifySeat({ '51,51,51': 0.57, '0,51,51': 0.43 }, references), 'unavailable');
  assert.equal(classifySeat({ '51,102,153': 0.87, '0,51,51': 0.06, '51,51,102': 0.05 }, references), 'accessible');
});

test('ambiguous or unfamiliar colours are unknown', () => {
  // Half gold, half grey: no clear winner.
  assert.equal(classifySeat({ '204,153,51': 0.4, '51,51,51': 0.6 }, references), 'unknown');
  // A colour no legend icon uses.
  assert.equal(classifySeat({ '255,0,255': 1 }, references), 'unknown');
});

test('legend must have distinct available and unavailable icons', () => {
  assert.equal(legendLooksValid(references), true);
  assert.equal(legendLooksValid(references.filter((ref) => ref.role !== 'unavailable')), false);
  assert.equal(legendLooksValid([
    { role: 'available', histogram: { '51,51,51': 0.7, '0,51,51': 0.3 } },
    { role: 'unavailable', histogram: { '51,51,51': 0.72, '0,51,51': 0.28 } },
  ]), false);
});
