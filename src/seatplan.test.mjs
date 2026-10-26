import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSeatPlan, extractShowtimeInfo } from './seatplan.mjs';

// Shaped like the live GetSeatPlan response: rows with physicalName and seats
// carrying numeric status codes and a uiColumnIndex position.
function seatPlan(rowsSpec, openSeats) {
  const rows = [{ physicalName: null, seats: [] }];
  rowsSpec.forEach(([name, statuses], rowIndex) => {
    rows.push({
      physicalName: name,
      seats: statuses.map((status, index) => ({
        id: index + 1,
        status,
        originalStatus: status,
        position: { areaNumber: 1, columnIndex: statuses.length - index, rowIndex: rowIndex + 1, uiColumnIndex: index + 2 },
      })),
    });
  });
  const counted = rowsSpec.flatMap(([, statuses]) => statuses).filter((status) => [0, 3, 7].includes(status)).length;
  return {
    url: 'https://ticketingservice.harkins.com/api/Theatre/GetSeatPlan/cinemaid/0000000002/sessionId/1',
    json: { success: true, data: { openSeats: openSeats ?? counted, rows } },
  };
}

const showtime = {
  url: 'https://ticketingservice.harkins.com/api/Theatre/GetTheatreShowtime/harkinsid/16/sessionid/1',
  json: {
    data: {
      movie: { value: [{ title: 'Clayface' }] },
      theatre: { value: [{ name: 'Arizona Mills 18 w/ IMAX' }] },
      showtime: {
        value: [{
          sessionId: '1',
          showtime: '2026-10-25T19:20:00',
          showtimeAttributes: ['CINÉ XL', 'Atmos'],
          conceptAttributesNames: ['CINÉXL'],
          seatsAvailable: 10,
          allowTicketSales: true,
        }],
      },
    },
  },
};

test('reads open, sold, blocked and accessible seats', () => {
  const result = extractSeatPlan([seatPlan([['A', [0, 0, 1, 2]], ['B', [3, 7, 0, 0]]])]);
  assert.equal(result.confidence, 'high');
  assert.deepEqual(result.rowOrder, ['A', 'B']);
  const open = result.seats.filter((seat) => seat.status === 'available').map((seat) => `${seat.row}${seat.number}`);
  assert.deepEqual(open, ['A1', 'A2', 'B3', 'B4']);
  assert.equal(result.seats.find((seat) => seat.row === 'B' && seat.number === 1).accessible, true);
});

test('accessible seats count as open when allowed', () => {
  const result = extractSeatPlan([seatPlan([['A', [3, 7, 0, 1]]])], { excludeAccessible: false });
  assert.equal(result.seats.filter((seat) => seat.status === 'available').length, 3);
});

test('fails closed when the open-seat count disagrees', () => {
  const result = extractSeatPlan([seatPlan([['A', [0, 0, 1, 1]]], 3)]);
  assert.equal(result.confidence, 'low');
  assert.equal(result.seats.length, 0);
});

test('fails closed on an unknown status code', () => {
  const result = extractSeatPlan([seatPlan([['A', [0, 0, 5, 1]]], 2)]);
  assert.equal(result.confidence, 'low');
});

test('reports none when no seat plan was captured', () => {
  assert.equal(extractSeatPlan([showtime]).confidence, 'none');
});

test('reads showtime format, time and names', () => {
  const info = extractShowtimeInfo([showtime]);
  assert.equal(info.date, '2026-10-25');
  assert.equal(info.minutes, 19 * 60 + 20);
  assert.equal(info.movieTitle, 'Clayface');
  assert.equal(info.theatreName, 'Arizona Mills 18 w/ IMAX');
  assert.ok(info.attributes.includes('CINÉ XL'));
  assert.equal(extractShowtimeInfo([]), null);
});
