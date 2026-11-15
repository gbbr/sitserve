# sitserve architecture

sitserve finds Vipassana courses on dhamma.org that still accept applications. The page in `web/`
and the Cloudflare Worker in `worker/` share filtering in `web/shared/courses.js`. Only pressing
Search queries course availability. The UI is described in [design.md](design.md), and
dhamma.org's own behavior in [dhamma-api.md](dhamma-api.md).

## Search and stream

Workers Static Assets serves `web/` except `tools/`. `/api/*` and `/photo/*` run through the
Worker first. One SQLite-backed Durable Object (DO), named `upstream`, runs searches, shares the
cache and makes every upstream request. In simulator mode, `GET /api/debug` reports simulator
request and active search counts for tests.

Cancellation is scoped to the visitor IP and search ID. The page sends its own
`X-Sitserve-Search-Id` UUID, so it can cancel before the start event arrives. The Worker forwards
stream cancellation to the DO explicitly (the request-signal compatibility flags are enabled
too), and the page also sends `POST /api/cancel?id=<UUID>` on abort or navigation, because
Wrangler's development proxy does not propagate HTTP disconnects.

`GET /api/search` takes the page fragment's parameters: `where`, `from`, `types`, `as`, `lang`
(ISO code), `centers`, `wait`, `soon`; booleans are `1`/`0`. Unknown and duplicate places are
dropped, and more than 10 remaining places are invalid (links keep the first 10). Language names
and `types=14D` or `TSC` map to their current equivalents. Invalid parameters return 400 JSON.
From is clamped to yesterday (UTC); `SITSERVE_TODAY` fixes the server date for tests. The
upstream end date is Dec 31 of the current UTC year plus two.

Responses are NDJSON with `Cache-Control: no-store`:

```json
{"type":"start","mode":"simulator","searchId":"<UUID>","today":"2026-11-14","filters":{}}
{"type":"progress","courses":[],"searchedThrough":"2026-12-03","checkedAt":"2026-11-14T12:00:00.000Z","pages":4,"cacheHit":true}
{"type":"done","reason":"end","partial":false,"searchedThrough":"2026-12-03","checkedAt":"2026-11-14T12:00:00.000Z","pages":4,"count":18,"usage":{"date":"2026-11-14","requests":37,"photos":5}}
```

`start.filters` holds the submitted filters. Each progress event carries only new matching
courses; `checkedAt` is the oldest contributing page's fetch time. `done.reason` is `limit`,
`end`, `cap`, `same-date`, `nothing-new`, `allowance`, `paused`, `visitor-limit` or `cancelled`.
An `error` event has `code`, `message` and `retryAfter` (seconds). Allowance, pause and visitor
limits send an `error` followed by a partial `done`; transport and response failures end with the
`error`. `done` and `error` carry `usage`, the footer's count of page and photo requests started
upstream on the current UTC day across all visitors, excluding cache hits.

- Send Where, From, Course and Language upstream. Empty Course sends every in-scope type. NM/NF
  sends only IDs 3 and 1, or makes no requests when Course excludes both.
- Read ten-course pages in date order; deduplicate IDs and apply As, centers, wait lists,
  not-open-yet and Language again before counting. Stop at **50 matches**.
- A course is at a center when dhamma.org says so or its venue names a directory center.
- Copies of one course listed by different locations
  ([dhamma-api.md](dhamma-api.md#venues-and-copied-listings)) count once. Two listings are copies
  when every course field except ID and application link matches, and they either share a
  mycourses enrollment form or, when either has none, are held at the same center (the listing
  location, or the one directory center its venue names) without conflicting venue URLs.
  Different forms never merge. A copy held at another location's center waits until that
  center's own listing replaces it, or a later start date shows it won't come.
- When a query is truncated at 100 courses, query again from its last raw start date. Raw row
  counts, start dates and IDs drive paging and the same-date and nothing-new stops, so a page
  counts even when all its courses are filtered out. Unusable raw dates are ignored. Read at most
  **20 pages**, cached or fresh. Cursor stops and the cap are partial and report the last date
  checked.
- Cancellation and a newer search from the same IP stop further pages and remove queued work.

## Cache and upstream limits

dhamma.org is run by a non-profit, so upstream load stays small and bounded. A typical uncached
search costs 5–10 requests, about like a visitor paging through dhamma.org's own results.

Normalized pages, with their raw paging facts (`rawCount`, `rawFirstStart`, `rawLastStart`,
`rawIds`), are persisted in DO storage behind an in-memory layer and stay valid for **24 hours**,
across dev-server and production restarts. Keys hash the cache schema version, a namespace (mode,
simulator date shift and scenario), the sorted type IDs and places, language, date range and
page, so As, availability and display filters reuse the same pages. Writes set the expiry alarm
only when none is pending or theirs is earlier, without scanning storage; the alarm sweeps expired
pages and photos (with their chunks), then reschedules for the next expiry. Reads delete expired
entries they meet. Identical in-flight requests share one fetch.

A cached broader query can answer a narrower one. A persisted index records up to 32 query
sequences: their contiguous cached pages, how far they cover and their oldest fetch time. A
sequence covers a search when it has the same end date, an earlier or equal From, a superset of
the search's type IDs and places (by directory ancestry, location states and cached venue
parents), and no language or the same one. The furthest-reaching covering sequence is replayed
through the submitted filters. An untruncated final page covers the whole range; otherwise
coverage stops before the last cached start date, and the submitted query continues from there if
more matches are needed. Replayed pages count toward the page cap and `checkedAt`, and their
progress events carry `reused: true`; expired pages drop out of the index. Exact repeats use the
ordinary page cache. Nothing is fetched just to enable reuse: there is no background refresh, bulk
course index or cache warming.

- FIFO queue: one request at a time, started at least 1,500 ms apart in live mode (250 ms in dev).
- Rolling hourly allowances: 100 search requests and, separately, 60 photos. Timestamps persist.
  A spent allowance still serves cached data and stops the search at the first uncached page.
- One active search per IP, and at most three searches needing uncached pages per rolling minute.
- Breaker: an unsuccessful status (429, 5xx, other 4xx, redirects), a non-JSON or malformed
  response, a timeout, a slow response or a transport failure pauses upstream requests for five
  minutes, or a longer Retry-After, up to an hour. The pause persists; cached pages and photos stay
  available. A slow but valid response is still cached and used. Invalid individual courses are
  skipped and logged without pausing. There are **no automatic retries**.
- Timeout 20 s; slow means over 10 s. Request logs include rolling hourly counts, and a persisted
  per-UTC-day count of started page and photo requests feeds `usage`.
- Identity: `sitserve/<version> (+<SITE_URL>; <UPSTREAM_CONTACT>)`. Redirects are not followed.
  No cookies, browser identity, Origin or Referer are sent.

`GET /photo/system/images/...` and `/photo/assets/...` accept image paths only. Live photos use
the same queue, identity and breaker, are stored for seven days and get a one-day browser cache
lifetime. A photo answering 404/410 or larger than 2 MB is stored as missing for a day and returns
404, without pausing the gate. Simulator photos are generated SVG placeholders.

## Audience

sitserve is for private use by a few invited people, so nobody else spends the upstream allowance.
Production runs at https://os.sutamaya.org behind Cloudflare Access. Static responses also carry
`X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer` (`web/_headers`), so search
engines skip the site even without Access and outbound links don't reveal its address. Before
opening it to others, write to dhamma.org's webmasters about the limits and date cursor; if they
object to the cursor, stop at their 100-course limit and show partial results.

## Local development

Wrangler is the only development dependency; the page has no dependencies or build step.

```sh
npm run dev           # simulator on http://127.0.0.1:8787; .wrangler/state persistence
npm test              # all Node unit/fidelity and Worker tests; remote fetches blocked
npm run test:worker   # real local Worker, SQLite persistence, full restart and faults
npm run test:browser  # Playwright against local Workers; external requests blocked
```

Playwright is installed outside the checkout in `/tmp/sit-web-test/node_modules`. The browser
runner uses `CHROME_PATH`, else local macOS Chrome, else Playwright Chromium;
`SITSERVE_SCREENSHOT_DIR` saves screenshots. `scripts/offline.js` blocks remote connections, DNS
lookups and Wrangler telemetry in the simulator dev process and in every test; local Workers
started by tests send their outbound requests through it, and browser tests also abort non-local
page requests. Dev logs and registry files stay under `.wrangler/`.

The simulator answers the real form-encoded requests that `worker/dhamma.js` builds, from saved
courses, with the date bounds, region matching, ISO languages, fixed page size and page clamping
seen in the saved probes. Totals reflect this small corpus, not the whole site. The fixtures in
`worker/fixtures/dhamma/`:

- `corpus.json`: every saved course, deduplicated by ID.
- `verbatim/` and `manifest.json`: byte-identical page captures, with hashes, known request
  parameters and what each demonstrates; the manifest also lists dropped fields and the
  intentional normalization differences.
- `probe-facts.json`: paging, accepted filters and IDs from every Nov 14 probe.
- `oracle-input.json` and `oracle-expected.json`: 152 sample courses that check normalization.
- `metadata-hashes.json`: hashes that check `web/places.js`.
- `browser-expected.json`: course IDs the browser tests expect.

Environment controls (set before `npm run dev`, or as Wrangler vars):

- `SIMULATOR_DATE_SHIFT=1` (dev default) moves dates by whole weeks from the Nov 14 snapshot; use
  `0` with `SITSERVE_TODAY=2026-11-14` for reproducible results.
- `SIMULATOR_DELAY_MS` and `SIMULATOR_FAULT=429|503|html|slow|malformed` exercise loading and
  errors.
- `SIMULATOR_SCENARIO=sparse` generates 2,000 courses with one available position, for cap tests.
- `UPSTREAM_SPACING_MS`, `UPSTREAM_ALLOWANCE`, `PHOTO_ALLOWANCE`, `VISITOR_SEARCHES_PER_MINUTE`,
  `UPSTREAM_TIMEOUT_MS` and `UPSTREAM_SLOW_MS` tune the gate.

`npm run dev:live` prints a warning and selects live mode explicitly. It needs `UPSTREAM_CONTACT`
in the ignored `.dev.vars`. Ordinary dev and every test use the simulator.

Place metadata and fixtures are regenerated from saved files, without network access:

```sh
node web/tools/build-places.js /path/to/search.html /path/to/directory.html
node scripts/import-fixtures.js /path/to/dhamma-saved
```

`build-places.js` writes `web/places.js`: 1,170 places with tags, location counts and region
paths, plus languages and course type IDs. Search location 1699 has no directory pin and counts as
a non-center. `import-fixtures.js` rebuilds the fixtures above from a folder of saved responses,
keeping the existing oracle. No flag or photo is downloaded during development.

## Deployment

`npm run deploy` deploys the `production` environment: live mode on the custom domain
`os.sutamaya.org`, with Workers Logs and no workers.dev or preview URLs, which would bypass
Access. The Access application for that hostname, which admits only listed email addresses and
sets the login methods, is configured in the Cloudflare Zero Trust dashboard, not this repository.
`UPSTREAM_CONTACT` is a Worker secret (`wrangler secret put UPSTREAM_CONTACT --env production`).

Still to do: tune spacing, allowances, timeout and slow thresholds from logs, and decide the
metadata refresh cadence.
