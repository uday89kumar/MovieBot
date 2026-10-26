// Parses the JSON the Harkins seat page loads from ticketingservice.harkins.com:
//   /api/Theatre/GetSeatPlan/...         -> data.rows[].seats[] with numeric status codes
//   /api/Theatre/GetTheatreShowtime/...  -> data.showtime.value[0] with format attributes and start time
//
// Status codes, confirmed against the API's own openSeats count (Oct 2026):
//   0 open, 1 sold, 2 blocked/house, 3 wheelchair (open), 7 companion (open).
// Any other code is treated as unavailable and makes the openSeats cross-check
// fail, so the run falls back to the rendered seat icons instead of guessing.

const OPEN = 0;
const ACCESSIBLE_OPEN = new Set([3, 7]);
const UNAVAILABLE = new Set([1, 2]);

function seatPlanPayloads(captures) {
  return captures
    .filter((capture) => /GetSeatPlan/i.test(capture.url) && capture.json?.success !== false)
    .map((capture) => capture.json?.data)
    .filter((data) => Array.isArray(data?.rows));
}

function showtimePayloads(captures) {
  return captures
    .filter((capture) => /GetTheatreShowtime/i.test(capture.url))
    .map((capture) => capture.json?.data)
    .filter((data) => data?.showtime?.value?.[0]);
}

/**
 * Returns { seats, rowOrder, confidence, diagnostics }.
 * Fails closed: confidence is 'high' only when the counted open seats equal
 * the plan's own openSeats figure and no unknown status codes appear.
 */
export function extractSeatPlan(captures, { excludeAccessible = true } = {}) {
  const plans = seatPlanPayloads(captures);
  if (!plans.length) {
    return { seats: [], rowOrder: [], confidence: 'none', diagnostics: { reason: 'No GetSeatPlan payload was captured.' } };
  }
  const plan = plans.at(-1);

  const seats = [];
  const rowOrder = [];
  const statusCounts = {};
  let openCount = 0;
  let unknownCodes = 0;
  for (const row of plan.rows) {
    const rowName = String(row?.physicalName || '').trim().toUpperCase();
    if (!rowName || !Array.isArray(row.seats) || !row.seats.length) continue;
    rowOrder.push(rowName);
    for (const seat of row.seats) {
      const number = Number(seat?.id);
      const x = Number(seat?.position?.uiColumnIndex);
      const y = Number(seat?.position?.rowIndex);
      const code = Number(seat?.status);
      if (!Number.isInteger(number) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      statusCounts[code] = (statusCounts[code] || 0) + 1;

      let status;
      let accessible = false;
      if (code === OPEN) status = 'available';
      else if (ACCESSIBLE_OPEN.has(code)) {
        accessible = true;
        status = excludeAccessible ? 'unavailable' : 'available';
      } else {
        status = 'unavailable';
        if (!UNAVAILABLE.has(code)) unknownCodes += 1;
      }
      if (code === OPEN || ACCESSIBLE_OPEN.has(code)) openCount += 1;

      seats.push({
        row: rowName,
        number,
        x,
        y,
        width: 1,
        height: 1,
        status,
        accessible,
        evidence: [`seat plan status=${code}`],
      });
    }
  }

  const reportedOpen = Number(plan.openSeats);
  const countsAgree = Number.isFinite(reportedOpen) && reportedOpen === openCount;
  const highConfidence = seats.length >= 3 && countsAgree && unknownCodes === 0;

  return {
    seats: highConfidence ? seats : [],
    rowOrder,
    confidence: highConfidence ? 'high' : seats.length ? 'low' : 'none',
    diagnostics: {
      seatCount: seats.length,
      openCounted: openCount,
      openReported: Number.isFinite(reportedOpen) ? reportedOpen : null,
      unknownCodes,
      statusCounts,
    },
  };
}

/**
 * Format attributes and start time for the session, or null if not captured.
 */
export function extractShowtimeInfo(captures) {
  const data = showtimePayloads(captures).at(-1);
  if (!data) return null;
  const showtime = data.showtime.value[0];
  const local = String(showtime.showtime || '').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  return {
    sessionId: String(showtime.sessionId || ''),
    movieTitle: String(data.movie?.value?.[0]?.title || '').trim() || null,
    theatreName: String(data.theatre?.value?.[0]?.name || '').trim() || null,
    date: local?.[1] || null,
    minutes: local ? Number(local[2]) * 60 + Number(local[3]) : null,
    attributes: [
      ...(Array.isArray(showtime.showtimeAttributes) ? showtime.showtimeAttributes : []),
      ...(Array.isArray(showtime.conceptAttributesNames) ? showtime.conceptAttributesNames : []),
    ].map(String),
    seatsAvailable: Number.isFinite(Number(showtime.seatsAvailable)) ? Number(showtime.seatsAvailable) : null,
    allowTicketSales: showtime.allowTicketSales !== false,
  };
}
