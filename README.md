# MovieBot: Harkins seat alerts

MovieBot watches Harkins seat maps for the movies, theatres and formats you list, and messages you on **Telegram** when a showtime has the seats you want. You then open the link and book them yourself.

It **never selects, holds, reserves or buys seats**, and it never tries to get around a CAPTCHA or block page. It runs free on GitHub Actions every 15 minutes, so your computer can stay off.

First-time setup (Telegram bot, secrets, making the repo public): see **[SETUP.md](SETUP.md)**.

## Adding a watch

Edit [`watches.json`](watches.json) on github.com or in your editor, then commit. Each entry in `watches` is one thing to look for:

```json
{
  "name": "Odyssey IMAX 70mm, 6 seats",
  "movie": "the-odyssey",
  "theatre": "arizona-mills-w-imax",
  "format": "IMAX 70mm",
  "until": "2026-09-11",
  "showtimes": { "earliest": "2:00 PM", "latest": "11:00 PM" },
  "tickets": 6,
  "minGroup": 2,
  "depth": [0.35, 0.75],
  "middlePercent": 50
}
```

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | Any unique label; shown in alerts. |
| `movie` | yes | The movie's slug: the end of its harkins.com address (`harkins.com/movies/the-odyssey` → `the-odyssey`). |
| `theatre` | yes | The theatre's slug (`arizona-mills-w-imax`) or numeric ID (`16`). Run `find-ids` to list them. |
| `format` | no | `"IMAX 70mm"`, `"Ciné XL"`, `"Digital"`, a list like `["IMAX 70mm", "IMAX"]`, or `"any"` (default). Capitals, spaces and accents don't matter, but otherwise the name must match Harkins' label exactly. Some movies use longer labels such as `"Ciné XL + Infinity Vision"`, so check with `find-ids`. |
| `until` | yes | Last date to watch (`YYYY-MM-DD`). After it, the watch is skipped. |
| `from` | no | First date to watch; defaults to today. Only dates within `maxDaysAhead` of today are checked. |
| `showtimes` | no | `earliest` / `latest` start times, both included. Defaults to the whole day. A `latest` earlier than `earliest` runs past midnight: `"5:00 PM"` to `"3:00 AM"` includes late-night shows. |
| `tickets` | no | Total seats needed (default 2). |
| `minGroup` | no | Smallest block of side-by-side seats allowed (default 2). With 6 tickets and 2, any of 6, 4+2, 3+3 or 2+2+2 counts. Use 1 to allow single seats. |
| `together` | no | `true` = all tickets side by side in one row. |
| `rows` | no | Exact rows, e.g. `"G-M"` or `"E,G-J"`. Overrides `depth`. |
| `depth` | no | Part of the room from front (0) to back (1). Default `[0.35, 0.75]`, about the middle of the room. Works in any auditorium, whatever its row letters. |
| `middlePercent` | no | Seats must sit in this central share of their row (default 50; 100 = anywhere). |
| `excludeAccessible` | no | Skip wheelchair and companion seats (default `true`). |
| `enabled` | no | `false` pauses a watch without deleting it. |

Settings at the top of `watches.json` (the defaults are sensible):

| Setting | Default | Meaning |
|---|---:|---|
| `timeZone` | `America/Phoenix` | Time zone for "today" and showtimes. |
| `maxDaysAhead` | 45 | How far ahead of today dates are checked. Raise it for movies that go on sale early. |
| `maxShowtimePagesPerRun` | 10 | Showtime pages read per run. |
| `maxSeatMapsPerRun` | 8 | Seat maps opened per run. |
| `blockPauseHours` | 2 | How long to stop after Harkins shows a CAPTCHA/block. |
| `brokenAfterRuns` | 3 | Bad runs in a row before a "may be broken" message. |

### Finding slugs and format names

Needs [Node.js](https://nodejs.org) 20 or newer on your computer:

```bash
npm install
npx playwright install chromium
npm run find-ids -- the-odyssey
npm run find-ids -- the-odyssey arizona-mills-w-imax
```

It prints a table of theatre slugs, theatre IDs and the exact format names for that movie. Copy them into `watches.json`.

## How a run works

1. **Showtimes.** Harkins lists every theatre's showtimes for a movie and date on one page (`/movies/<slug>/<date>`). MovieBot reads the pages that are due and keeps the showtimes that match a watch's theatre, format, dates and times.
2. **Seat maps.** It opens at most `maxSeatMapsPerRun` seat maps per run. Showtimes it has never checked come first, then the most overdue. A showtime is due about every 15 minutes when it's within 3 days, hourly for 4–14 days out, and every 4 hours beyond that. Showtime pages follow the same schedule.
3. **Reading seats.** The main source is the seat data the seat page itself loads, cross-checked against Harkins' own open-seat count. If that doesn't add up, MovieBot reads the seat icons from a screenshot, calibrated against the page's own colour key. If neither is clear, it sends **no alert** and saves screenshots for debugging.
4. **Matching.** Seats must be open, in the allowed rows, side by side with consecutive numbers (no aisle in between), and inside the middle of the row.
5. **Alerting.** New matches go to Telegram (with sound) and to a GitHub issue. The same seats aren't alerted twice; if they disappear and come back, you're alerted again.

### When something goes wrong

- **CAPTCHA or block page:** MovieBot stops all checks for `blockPauseHours` and sends one silent "blocked, check manually" message. It doesn't try to solve or avoid the CAPTCHA.
- **Pages it can't read:** after `brokenAfterRuns` bad runs in a row for a watch, you get one silent "may be broken" message. Screenshots, HTML and details are in the workflow run's **Artifacts** for 5 days. A wrong movie or theatre slug looks the same.
- **Bookkeeping** is stored as JSON in an issue titled "MovieBot state — do not delete". Deleting it only means already-sent alerts may repeat once.

## Being polite to Harkins

`harkins.com/robots.txt` asks bots not to load `/ticketing` pages, which is where the seat maps are. MovieBot keeps those visits low: a fixed cap per run, random gaps between page loads, and a full stop when blocked. Keep the caps modest, and disable watches you no longer need.

## Running locally

```bash
npm install
npx playwright install chromium
npm test
npm run inspect -- "https://harkins.com/ticketing/theatre/16/movie/HO00016344/session/576959/date/2026-10-25"
npm run monitor
```

`inspect` opens one seat map in a visible browser and prints what MovieBot reads, using the first watch's rules (add a watch name as a second argument to pick another). `monitor` without `GITHUB_TOKEN` keeps its state in memory and only prints alerts unless Telegram variables are set.
