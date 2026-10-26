import fs from 'node:fs/promises';
import path from 'node:path';
import { formatClock, parseClockMinutes } from './lib.mjs';
import { extractSeatPlan, extractShowtimeInfo } from './seatplan.mjs';
import { extractVisualSeats } from './visual.mjs';

const BLOCK_PATTERNS = /captcha|access denied|temporarily blocked|verify you are human|unusual traffic|request unsuccessful/i;

export class BlockedError extends Error {
  constructor(url) {
    super(`Harkins showed a block/CAPTCHA page at ${url}; stopping without any bypass attempt.`);
    this.name = 'BlockedError';
    this.url = url;
  }
}

export function movieDayUrl(movieSlug, date) {
  return `https://harkins.com/movies/${movieSlug}/${date}`;
}

export function sessionUrl({ theatreId, movieId, sessionId, date }) {
  return `https://harkins.com/ticketing/theatre/${theatreId}/movie/${movieId}/session/${sessionId}/date/${date}`;
}

async function dismissCommonDialogs(page) {
  // Only cookie/consent banners; the most privacy-preserving choice comes first.
  const labels = [/reject all/i, /decline/i, /necessary only/i, /accept all/i, /accept cookies/i, /^accept$/i];
  for (const label of labels) {
    const button = page.getByRole('button', { name: label }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click({ timeout: 2_000 }).catch(() => {});
      break;
    }
  }
}

export async function saveDebug(page, name, extra = {}) {
  await fs.mkdir('debug', { recursive: true });
  const safe = name.replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 150);
  await page.screenshot({ path: path.join('debug', `${safe}.png`), fullPage: true }).catch(() => {});
  const html = await page.content().catch(() => '');
  await fs.writeFile(path.join('debug', `${safe}.html`), html).catch(() => {});
  await fs.writeFile(path.join('debug', `${safe}.json`), JSON.stringify(extra, null, 2)).catch(() => {});
}

async function throwIfBlocked(page, url, debugName) {
  const bodyText = await page.locator('body').innerText({ timeout: 10_000 }).catch(() => '');
  if (BLOCK_PATTERNS.test(bodyText)) {
    await saveDebug(page, `blocked-${debugName}`, { url, bodyText: bodyText.slice(0, 2000) });
    throw new BlockedError(url);
  }
  return bodyText;
}

/**
 * Read every showtime on a movie's page for one date, across all theatres.
 * Each format block is a [data-testid="movie-showtime-category"] whose label
 * is an <h3> ("Digital") or a logo image's alt text ("Ciné XL"); each theatre
 * block links to /theatres/<slug>/<date>.
 *
 * Returns { ok, showtimes }. ok is false when the page did not render at all,
 * which counts toward the "bot may be broken" check. Zero showtimes with a
 * rendered page is normal (e.g. a movie that has not opened yet).
 */
export async function discoverShowtimes(context, { movieSlug, date }) {
  const page = await context.newPage();
  const url = movieDayUrl(movieSlug, date);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await dismissCommonDialogs(page);
    await page.waitForSelector('a[href*="/ticketing/theatre/"], [data-testid="movie-showtime-category"]', { timeout: 15_000 })
      .catch(() => {});
    const bodyText = await throwIfBlocked(page, url, `discovery-${movieSlug}-${date}`);
    if (/page not found|not in the script/i.test(bodyText)) {
      await saveDebug(page, `not-found-${movieSlug}-${date}`, { url });
      return { ok: false, reason: `Movie page not found: ${url}`, showtimes: [] };
    }

    const raw = await page.evaluate(() => {
      const results = [];
      for (const anchor of document.querySelectorAll('a[href*="/ticketing/theatre/"]')) {
        const href = anchor.getAttribute('href') || '';
        const match = href.match(/\/ticketing\/theatre\/(\d+)\/movie\/([A-Za-z0-9]+)\/session\/(\d+)\/date\/(\d{4}-\d{2}-\d{2})/);
        if (!match) continue;
        const category = anchor.closest('[data-testid="movie-showtime-category"]');
        const heading = category?.querySelector('h1,h2,h3,h4')?.innerText?.trim();
        const logo = category?.querySelector('img[alt]')?.getAttribute('alt')?.trim();
        let theatreSlug = null;
        let theatreName = null;
        for (let node = category || anchor; node && !theatreSlug; node = node.parentElement) {
          const links = [...(node.querySelectorAll?.('a[href^="/theatres/"], a[href*="harkins.com/theatres/"]') || [])];
          if (links.length) {
            theatreSlug = (links[0].getAttribute('href').match(/\/theatres\/([^/?#]+)/) || [])[1] || null;
            theatreName = links.map((link) => (link.innerText || '').trim()).find(Boolean) || null;
          }
        }
        results.push({
          theatreId: match[1],
          movieId: match[2],
          sessionId: match[3],
          date: match[4],
          timeText: (anchor.innerText || '').trim(),
          format: heading || logo || '',
          theatreSlug,
          theatreName,
          past: /\bdisabled\b/.test(anchor.className || '') || anchor.getAttribute('aria-disabled') === 'true',
        });
      }
      return results;
    });

    const unique = new Map();
    for (const item of raw) {
      const minutes = parseClockMinutes(item.timeText);
      if (minutes === null || !item.format) continue;
      unique.set(item.sessionId, { ...item, minutes, url: sessionUrl(item) });
    }
    const showtimes = [...unique.values()];
    console.log(`${movieSlug} ${date}: ${showtimes.length} showtime(s) across all theatres.`);
    return { ok: bodyText.trim().length > 0, showtimes };
  } finally {
    await page.close();
  }
}

/**
 * Open one seat page and read availability. Never clicks a seat.
 * Seat-plan JSON is the primary source; rendered icons are the fallback.
 * Throws BlockedError on a CAPTCHA/block page.
 */
export async function inspectSession(context, session, { excludeAccessible = true } = {}) {
  const page = await context.newPage();
  const debugName = `session-${session.sessionId || session.url.match(/session\/(\d+)/)?.[1] || Date.now()}`;
  const captures = [];
  const pendingCaptures = [];

  // Any Playwright route disables the browser HTTP cache, so each visit sees live data.
  await page.route('**/*', (route) => route.continue());

  page.on('response', (response) => {
    const url = response.url();
    if (!/ticketingservice\.harkins\.com\/api\/Theatre\/(GetSeatPlan|GetTheatreShowtime)/i.test(url)) return;
    const capture = response.body()
      .then((body) => {
        if (body.length > 5_000_000) return;
        try {
          captures.push({ url, status: response.status(), json: JSON.parse(body.toString('utf8')) });
        } catch {
          // Not JSON; the rendered-icon fallback remains available.
        }
      })
      .catch(() => {});
    pendingCaptures.push(capture);
  });

  try {
    await page.goto(session.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await dismissCommonDialogs(page);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1_500);
    await Promise.allSettled(pendingCaptures);
    const bodyText = await throwIfBlocked(page, session.url, debugName);

    const info = extractShowtimeInfo(captures);
    let extraction = extractSeatPlan(captures, { excludeAccessible });
    let method = 'seat-plan-json';

    if (extraction.confidence !== 'high') {
      const visual = await extractVisualSeats(page, { excludeAccessible });
      if (visual.confidence === 'high') {
        extraction = { ...visual, rowOrder: null };
        method = 'rendered-seat-icons';
      } else {
        extraction = {
          seats: [],
          rowOrder: null,
          confidence: visual.confidence === 'low' || extraction.confidence === 'low' ? 'low' : 'none',
          diagnostics: { seatPlan: extraction.diagnostics, visual: visual.diagnostics },
        };
      }
    }

    const availableCount = extraction.seats.filter((seat) => seat.status === 'available').length;
    if (extraction.confidence !== 'high') {
      await saveDebug(page, `${debugName}-unverified`, {
        url: session.url,
        info,
        diagnostics: extraction.diagnostics,
        bodyText: bodyText.slice(0, 3000),
      });
    }

    const when = info?.date && info.minutes !== null ? `${info.date} ${formatClock(info.minutes)}` : session.url;
    console.log(`${when} ${session.format || ''}: ${method}, ${extraction.confidence} confidence, `
      + `${availableCount} open seat(s).`);
    return {
      url: session.url,
      info,
      seats: extraction.seats,
      rowOrder: extraction.rowOrder,
      confidence: extraction.confidence,
      method,
      diagnostics: extraction.diagnostics,
    };
  } catch (error) {
    if (error instanceof BlockedError) throw error;
    await saveDebug(page, `${debugName}-error`, { url: session.url, error: error.stack || String(error) });
    return { url: session.url, error: error.message, seats: [], confidence: 'none' };
  } finally {
    await page.close();
  }
}
