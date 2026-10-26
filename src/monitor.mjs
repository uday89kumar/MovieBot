import { chromium } from 'playwright';
import {
  activeWatches,
  attributesMatch,
  loadConfig,
  showtimeWanted,
  watchDates,
} from './config.mjs';
import {
  allowedRowsFor,
  dateInTimeZone,
  findTicketPlan,
  formatClock,
  formatDate,
  groupsFingerprint,
  jitter,
  minutesInTimeZone,
  sleep,
} from './lib.mjs';
import { BlockedError, discoverShowtimes, inspectSession } from './harkins.mjs';
import { loadState, pruneState, saveState } from './github-state.mjs';
import { selectDue } from './schedule.mjs';
import { describePlan, sendSeatAlerts, sendStatus } from './notify.mjs';

function isPast(showtime, today, nowMinutes) {
  return showtime.date < today || (showtime.date === today && showtime.minutes <= nowMinutes);
}

function titleFromSlug(slug) {
  return slug.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function compactShowtime(showtime) {
  const { url, sessionId, theatreId, theatreSlug, theatreName, movieId, format, date, minutes } = showtime;
  return { url, sessionId, theatreId, theatreSlug, theatreName, movieId, format, date, minutes };
}

async function handleBlock(state, config, now, error) {
  console.warn(error.message);
  const pausedUntil = new Date(now.getTime() + config.blockPauseHours * 3_600_000);
  state.block.pausedUntil = pausedUntil.toISOString();
  if (!state.block.active) {
    const sent = await sendStatus(
      'MovieBot blocked: check manually',
      `Harkins showed a CAPTCHA or block page, so MovieBot paused all checks until `
        + `${pausedUntil.toISOString().slice(11, 16)} UTC. It will not try to get around it. `
        + `Check the seat maps yourself in the meantime: ${error.url}`,
    );
    // Remember the alert only once it went out, so a failed send is retried.
    state.block.active = sent;
  }
}

async function updateHealth(state, config, watches, health) {
  for (const watch of watches) {
    const result = health.get(watch.name);
    if (!result.pagesTried && !result.seatsTried) continue;
    const pagesBad = result.pagesTried && !result.pagesOk;
    const seatsBad = result.seatsTried && !result.seatsOk;
    const entry = (state.health[watch.name] ||= { badRuns: 0, alerted: false });
    if (!pagesBad && !seatsBad) {
      entry.badRuns = 0;
      entry.alerted = false;
      continue;
    }
    entry.badRuns += 1;
    if (entry.badRuns >= config.brokenAfterRuns && !entry.alerted) {
      entry.alerted = await sendStatus(
        'MovieBot may be broken',
        `Watch "${watch.name}" has had ${entry.badRuns} runs in a row where Harkins pages could not be read. `
          + 'Check the latest workflow run and its debug files on GitHub. '
          + 'A wrong movie or theatre slug in watches.json also causes this.',
      );
    }
  }
  for (const name of Object.keys(state.health)) {
    if (!watches.some((watch) => watch.name === name)) delete state.health[name];
  }
}

async function run(config, watches, state, { now, today, nowMinutes }) {
  if (!watches.length) {
    console.log('No active watches (all disabled or past their "until" date). Nothing to do.');
    return;
  }
  if (state.block.pausedUntil && Date.parse(state.block.pausedUntil) > now.getTime()) {
    console.log(`Paused after a Harkins block until ${state.block.pausedUntil}. Skipping this run.`);
    return;
  }

  // Per watch: did any showtime page / seat map load properly this run?
  const health = new Map(watches.map((watch) =>
    [watch.name, { pagesTried: false, pagesOk: false, seatsTried: false, seatsOk: false }]));
  const markHealth = (affected, kind, ok) => {
    for (const watch of affected) {
      const entry = health.get(watch.name);
      entry[`${kind}Tried`] = true;
      if (ok) entry[`${kind}Ok`] = true;
    }
  };

  // 1. Showtime pages that are due (one page per movie and date covers every theatre).
  const pageItems = new Map();
  for (const watch of watches) {
    for (const date of watchDates(watch, today, config.maxDaysAhead)) {
      const key = `${watch.movie}|${date}`;
      if (!pageItems.has(key)) pageItems.set(key, { key, movie: watch.movie, date, checkedAt: state.pages[key]?.checkedAt });
    }
  }
  const pagesToCheck = selectDue([...pageItems.values()], { today, now, limit: config.maxShowtimePagesPerRun });
  console.log(`${pagesToCheck.length} of ${pageItems.size} showtime page(s) due this run.`);

  const alerts = [];
  let blockedError = null;
  let loadedAnyPage = false;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
    locale: 'en-US',
    timezoneId: config.timeZone,
    serviceWorkers: 'block',
  });

  try {
    for (const [index, item] of pagesToCheck.entries()) {
      if (index) await sleep(jitter(2_000, 6_000));
      const affected = watches.filter((watch) => watch.movie === item.movie);
      let result;
      try {
        result = await discoverShowtimes(context, { movieSlug: item.movie, date: item.date });
      } catch (error) {
        if (error instanceof BlockedError) {
          blockedError = error;
          break;
        }
        console.error(`Showtimes page failed for ${item.key}: ${error.message}`);
        markHealth(affected, 'pages', false);
        continue;
      }
      loadedAnyPage = true;
      markHealth(affected, 'pages', result.ok);
      if (!result.ok) {
        console.warn(result.reason || `Showtimes page for ${item.key} did not render.`);
        continue;
      }
      const wanted = result.showtimes.filter((showtime) =>
        !showtime.past && affected.some((watch) => showtimeWanted(watch, showtime, today)));
      state.pages[item.key] = { checkedAt: now.toISOString(), showtimes: wanted.map(compactShowtime) };
    }

    // 2. Seat maps that are due, from every cached showtime some watch still wants.
    const candidates = [];
    if (!blockedError) {
      for (const [key, page] of Object.entries(state.pages)) {
        const movie = key.split('|')[0];
        for (const showtime of page.showtimes || []) {
          if (isPast(showtime, today, nowMinutes)) continue;
          const matching = watches.filter((watch) => watch.movie === movie && showtimeWanted(watch, showtime, today));
          if (!matching.length) continue;
          candidates.push({ ...showtime, movie, watches: matching, checkedAt: state.sessions[showtime.url]?.checkedAt });
        }
      }
    }
    const sessionsToCheck = selectDue(candidates, { today, now, limit: config.maxSeatMapsPerRun });
    console.log(`${sessionsToCheck.length} of ${candidates.length} seat map(s) due this run.`);

    for (const [index, session] of sessionsToCheck.entries()) {
      if (index || pagesToCheck.length) await sleep(jitter(3_000, 8_000));
      let result;
      try {
        result = await inspectSession(context, session, {
          excludeAccessible: session.watches.every((watch) => watch.excludeAccessible),
        });
      } catch (error) {
        if (error instanceof BlockedError) {
          blockedError = error;
          break;
        }
        throw error;
      }
      loadedAnyPage = true;
      const verified = result.confidence === 'high';
      markHealth(session.watches, 'seats', verified);
      const entry = (state.sessions[session.url] ||= { alerts: {} });
      entry.checkedAt = now.toISOString();
      entry.date = session.date;
      entry.alerts ||= {};
      if (!verified) {
        console.warn(`Seats could not be verified, no alert: ${session.url}`);
        continue;
      }
      const info = result.info;
      const salesOpen = !info || info.allowTicketSales;

      for (const watch of session.watches) {
        if (info && !attributesMatch(watch, info.attributes)) {
          console.warn(`Format double-check failed for "${watch.name}" at ${session.url}: ${info.attributes.join(', ')}`);
          continue;
        }
        // Accessible seats were read as open if any watch allows them; re-apply this watch's own choice.
        const seats = result.seats.map((seat) => (watch.excludeAccessible && seat.accessible
          ? { ...seat, status: 'unavailable' }
          : seat));
        const allowedRows = allowedRowsFor(seats, watch, result.rowOrder);
        const plan = salesOpen
          ? findTicketPlan(seats.filter((seat) => allowedRows.has(seat.row)), watch)
          : null;
        const minutes = info?.minutes ?? session.minutes;
        const label = `${watch.name}: ${formatDate(session.date)} ${formatClock(minutes)}`;
        if (!plan) {
          delete entry.alerts[watch.name];
          console.log(`${label}: no qualifying seats (rows ${[...allowedRows].join('') || 'none'}).`);
          continue;
        }
        const fingerprint = groupsFingerprint(plan.blocks);
        if (entry.alerts[watch.name] === fingerprint) {
          console.log(`${label}: same qualifying seats as last alert, not repeating.`);
          continue;
        }
        alerts.push({
          watchName: watch.name,
          url: session.url,
          fingerprint,
          movieTitle: info?.movieTitle || titleFromSlug(session.movie),
          format: session.format,
          theatreName: info?.theatreName || session.theatreName || session.theatreSlug,
          date: session.date,
          minutes,
          seatText: describePlan(plan),
        });
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  // 3. Deliver alerts found before any block, then record them.
  if (alerts.length) {
    const delivered = await sendSeatAlerts(alerts);
    if (delivered) {
      for (const alert of alerts) state.sessions[alert.url].alerts[alert.watchName] = alert.fingerprint;
      console.log(`Sent ${alerts.length} seat alert(s).`);
    } else {
      console.warn('No alert channel delivered; the same seats will be alerted next run.');
    }
  } else {
    console.log('No new qualifying seats.');
  }

  if (blockedError) {
    await handleBlock(state, config, now, blockedError);
    return;
  }
  if (loadedAnyPage) state.block.active = false;
  await updateHealth(state, config, watches, health);
}

async function main() {
  const config = await loadConfig();
  const now = new Date();
  const today = dateInTimeZone(config.timeZone, now);
  const nowMinutes = minutesInTimeZone(config.timeZone, now);
  const watches = activeWatches(config, today);
  console.log(`MovieBot: ${watches.length} active watch(es) on ${today}.`);

  const { issueNumber, state } = await loadState();
  try {
    await run(config, watches, state, { now, today, nowMinutes });
  } finally {
    pruneState(state, today);
    await saveState(issueNumber, state);
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
