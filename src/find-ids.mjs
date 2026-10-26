// Usage: npm run find-ids -- <movie-slug> [theatre-slug-or-id] [YYYY-MM-DD]
// Lists the theatre slugs, theatre IDs and format names Harkins uses for a
// movie, so watches.json can be filled in exactly. Reads one showtimes page
// per day for up to 7 days until it finds showtimes.
import { chromium } from 'playwright';
import { addDays, dateInTimeZone } from './lib.mjs';
import { discoverShowtimes } from './harkins.mjs';

const [movie, theatre, startDate] = process.argv.slice(2);
if (!movie) {
  console.error('Usage: npm run find-ids -- <movie-slug> [theatre-slug-or-id] [YYYY-MM-DD]');
  console.error('The movie slug is the end of its harkins.com address, e.g. "the-odyssey" from harkins.com/movies/the-odyssey.');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1200 }, locale: 'en-US' });
try {
  let date = startDate || dateInTimeZone('America/Phoenix');
  let showtimes = [];
  for (let attempt = 0; attempt < 7 && !showtimes.length; attempt += 1) {
    const result = await discoverShowtimes(context, { movieSlug: movie, date });
    if (!result.ok) {
      console.error(result.reason || `The page for "${movie}" on ${date} did not load. Check the movie slug.`);
      process.exitCode = 1;
      break;
    }
    showtimes = result.showtimes;
    if (!showtimes.length) date = addDays(date, 1);
  }
  if (theatre) {
    const wanted = theatre.toLowerCase();
    showtimes = showtimes.filter((item) => item.theatreSlug === wanted || item.theatreId === wanted);
  }
  if (!showtimes.length) {
    console.log('No showtimes found. The movie may not be on sale yet; try a later date as the third argument.');
  } else {
    const rows = new Map();
    for (const item of showtimes) {
      const key = `${item.theatreSlug}|${item.format}`;
      if (!rows.has(key)) {
        rows.set(key, {
          theatre: item.theatreSlug,
          theatreId: item.theatreId,
          name: item.theatreName,
          format: item.format,
          movieId: item.movieId,
          showtimes: 0,
        });
      }
      rows.get(key).showtimes += 1;
    }
    console.log(`\nShowtimes for "${movie}" on ${date}. Use "theatre" and "format" in watches.json:\n`);
    console.table([...rows.values()].sort((a, b) => a.theatre.localeCompare(b.theatre) || a.format.localeCompare(b.format)));
  }
} finally {
  await context.close();
  await browser.close();
}
