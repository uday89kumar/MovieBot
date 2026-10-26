// Fallback used only when the seat-plan JSON cannot be verified. It calibrates
// against the page's own seat legend (e.g. "Ultimate Lounger", "Unavailable",
// "Wheelchair", "Accessible Companion"), so it works for any icon colours, and
// labels each seat by the legend icon whose colour mix it shares most.
// Ambiguous seats are unknown.
//
// Colours are compared as coarse histograms (each channel rounded to one of
// six levels). Measured on a live map (Oct 2026): open seats gold, taken seats
// dark grey, accessible blue, all on a navy background.

const MIN_SIMILARITY = 0.3;
const MIN_MARGIN_RATIO = 1.5;
const MAX_LEGEND_OVERLAP = 0.5;

export function legendRole(label = '', testId = '') {
  const text = `${label} ${testId}`.toLowerCase();
  if (/selected|your seat/.test(text)) return null;
  if (/wheelchair|accessible|companion/.test(text)) return 'accessible';
  if (/unavailable|sold|taken|reserved/.test(text)) return 'unavailable';
  return 'available';
}

/**
 * Histogram intersection: the share of colour two images have in common,
 * from 0 (nothing alike) to 1 (identical colour mix).
 */
export function histogramSimilarity(a = {}, b = {}) {
  let shared = 0;
  for (const [bin, share] of Object.entries(a)) shared += Math.min(share, b[bin] || 0);
  return shared;
}

/**
 * The legend must contain at least one available seat type and an
 * unavailable icon, and the two must look clearly different.
 */
export function legendLooksValid(references) {
  const available = references.filter((ref) => ref.role === 'available');
  const unavailable = references.filter((ref) => ref.role === 'unavailable');
  if (!available.length || !unavailable.length) return false;
  return available.every((a) => unavailable.every((u) =>
    histogramSimilarity(a.histogram, u.histogram) <= MAX_LEGEND_OVERLAP));
}

export function classifySeat(histogram, references) {
  const bestByRole = new Map();
  for (const ref of references) {
    const similarity = histogramSimilarity(histogram, ref.histogram);
    if (similarity > (bestByRole.get(ref.role) ?? -1)) bestByRole.set(ref.role, similarity);
  }
  const ranked = [...bestByRole.entries()].sort((a, b) => b[1] - a[1]);
  const [best, rival] = ranked;
  if (!best || best[1] < MIN_SIMILARITY) return 'unknown';
  if (rival && best[1] < rival[1] * MIN_MARGIN_RATIO) return 'unknown';
  return best[0];
}

async function analyzeScreenshot(page, buffer, crops = null) {
  const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
  return page.evaluate(async ({ source, requestedCrops }) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const level = (value) => Math.round(value / 51) * 51;
    const colourHistogram = (crop) => {
      const x0 = crop ? clamp(Math.floor(crop.x), 0, canvas.width) : 0;
      const y0 = crop ? clamp(Math.floor(crop.y), 0, canvas.height) : 0;
      const x1 = crop ? clamp(Math.ceil(crop.x + crop.width), 0, canvas.width) : canvas.width;
      const y1 = crop ? clamp(Math.ceil(crop.y + crop.height), 0, canvas.height) : canvas.height;
      const bins = {};
      let count = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const offset = (y * canvas.width + x) * 4;
          if (pixels[offset + 3] < 32) continue;
          count += 1;
          const bin = `${level(pixels[offset])},${level(pixels[offset + 1])},${level(pixels[offset + 2])}`;
          bins[bin] = (bins[bin] || 0) + 1;
        }
      }
      for (const bin of Object.keys(bins)) bins[bin] /= count;
      return bins;
    };

    return (requestedCrops || [null]).map(colourHistogram);
  }, { source: dataUrl, requestedCrops: crops });
}

async function legendReferences(page) {
  const legend = page.locator('[data-testid="seating-options"]').first();
  const items = (await legend.isVisible().catch(() => false))
    ? await legend.locator('[data-testid], img[alt]').all()
    : [];
  const references = [];
  for (const item of items) {
    if (!(await item.isVisible().catch(() => false))) continue;
    const testId = (await item.getAttribute('data-testid').catch(() => null)) || '';
    if (testId === 'seating-options') continue;
    const label = await item.evaluate((element) =>
      `${element.getAttribute('alt') || ''} ${element.parentElement?.innerText || ''}`.trim()).catch(() => '');
    const role = legendRole(label, testId);
    if (!role) continue;
    const buffer = await item.screenshot({ animations: 'disabled' }).catch(() => null);
    if (!buffer) continue;
    references.push({ role, label: label.slice(0, 40), histogram: (await analyzeScreenshot(page, buffer))[0] });
  }

  // Some auditoriums draw a custom "unavailable" image outside the legend box.
  if (!references.some((ref) => ref.role === 'unavailable')) {
    const custom = page.locator('img[alt*="unavailable" i]').first();
    if (await custom.isVisible().catch(() => false)) {
      const buffer = await custom.screenshot({ animations: 'disabled' }).catch(() => null);
      if (buffer) references.push({ role: 'unavailable', label: 'unavailable image', histogram: (await analyzeScreenshot(page, buffer))[0] });
    }
  }
  return references;
}

export async function extractVisualSeats(page, { excludeAccessible = true } = {}) {
  const map = page.locator('[data-testid="auditorium-container"]').first();
  if (!(await map.isVisible().catch(() => false))) {
    return { seats: [], confidence: 'none', diagnostics: { reason: 'Rendered auditorium container was not visible.' } };
  }

  const references = await legendReferences(page);
  if (!legendLooksValid(references)) {
    return {
      seats: [],
      confidence: 'none',
      diagnostics: { reason: 'Seat legend was missing or its icons were not clearly different.', references },
    };
  }

  const mapBox = await map.boundingBox();
  const mapBuffer = await map.screenshot({ animations: 'disabled' });
  if (!mapBox || mapBox.width <= 0 || mapBox.height <= 0) {
    return { seats: [], confidence: 'none', diagnostics: { reason: 'Seat-map geometry was unavailable.' } };
  }

  const records = await page.locator('[data-testid="auditorium-container"] button[id]').evaluateAll((buttons) =>
    buttons.map((button) => {
      const match = String(button.id || '').match(/^([A-Z]+)(\d{1,3})$/i);
      if (!match) return null;
      const rect = button.getBoundingClientRect();
      return {
        row: match[1].toUpperCase(),
        number: Number(match[2]),
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        width: rect.width,
        height: rect.height,
        left: rect.left,
        top: rect.top,
      };
    }).filter(Boolean));

  const imageDimensions = await page.evaluate(async (source) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  }, `data:image/png;base64,${mapBuffer.toString('base64')}`);
  const scaleX = imageDimensions.width / mapBox.width;
  const scaleY = imageDimensions.height / mapBox.height;
  const crops = records.map((record) => ({
    x: (record.left - mapBox.x) * scaleX,
    y: (record.top - mapBox.y) * scaleY,
    width: record.width * scaleX,
    height: record.height * scaleY,
  }));
  const histograms = await analyzeScreenshot(page, mapBuffer, crops);

  const seats = [];
  const counts = { available: 0, unavailable: 0, accessible: 0, unknown: 0 };
  const samples = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const histogram = histograms[index];
    const visualStatus = classifySeat(histogram, references);
    counts[visualStatus] += 1;
    if (samples.length < 20) samples.push({ seat: `${record.row}${record.number}`, visualStatus, histogram });

    let status = visualStatus === 'available' ? 'available' : 'unavailable';
    if (visualStatus === 'accessible' && !excludeAccessible) status = 'available';
    seats.push({
      row: record.row,
      number: record.number,
      x: record.x,
      y: record.y,
      width: record.width,
      height: record.height,
      status,
      accessible: visualStatus === 'accessible',
      evidence: [`Rendered icon=${visualStatus}`],
    });
  }

  const known = counts.available + counts.unavailable + counts.accessible;
  const knownRatio = records.length ? known / records.length : 0;
  const highConfidence = records.length >= 3 && knownRatio >= 0.9;

  return {
    seats: highConfidence ? seats : [],
    confidence: highConfidence ? 'high' : known ? 'low' : 'none',
    diagnostics: {
      method: 'rendered-seat-icons',
      recordCount: records.length,
      counts,
      knownRatio,
      references,
      samples,
    },
  };
}
