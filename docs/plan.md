# sitserve

sitserve finds Vipassana courses on dhamma.org that still accept applications. A plain page
and a Cloudflare Worker share filtering in `web/shared/courses.js`. Only pressing Search queries
course availability. Editing the form preserves the submitted results and their applicant lights.

## Search and stream

Workers Static Assets serves `web/`; tools and design notes are excluded. `/api/*` and `/photo/*`
run through the Worker first. One SQLite-backed Durable Object, named `upstream`, runs searches,
shares the cache, and makes every upstream request. The Worker forwards stream cancellation
explicitly to the DO; request signal compatibility flags are enabled as well. The page also
sends `POST /api/cancel?id=<UUID>` on abort/navigation, since Wrangler’s development proxy does
not propagate HTTP disconnects. Cancellation is scoped to the visitor IP and search ID; a
`X-Sitserve-Search-Id` UUID can identify a search before its start event arrives.

`GET /api/search` takes the same parameters as the page fragment: `where`, `from`, `types`, `as`,
`lang` (ISO code), `centers`, `wait`, `soon`. Booleans are `1`/`0`. Unknown/duplicate places are
removed. Old language names and `types=14D` / `TSC` restore their current equivalents. Invalid
API parameters return 400 JSON. From is clamped to yesterday using UTC; `SITSERVE_TODAY` fixes
the server date for tests. The upstream end date is Dec 31 of the current UTC year plus two.

Responses are NDJSON with `Cache-Control: no-store`:

```json
{"type":"start","mode":"simulator","searchId":"<UUID>","today":"2026-11-14","filters":{}}
{"type":"progress","courses":[],"searchedThrough":"2026-12-03","checkedAt":"2026-11-14T12:00:00.000Z","pages":4,"cacheHit":true}
{"type":"done","reason":"end","partial":false,"searchedThrough":"2026-12-03","checkedAt":"2026-11-14T12:00:00.000Z","pages":4,"count":18,"usage":{"date":"2026-11-14","requests":37,"photos":5}}
```

`start.filters` contains the submitted filters. Each progress event contains only new matching
courses. `checkedAt` is the oldest contributing page's fetch time. Completion reasons are `limit`,
`end`, `cap`, `same-date`, `nothing-new`, `allowance`, `paused`, `visitor-limit`, `cancelled`.
An error event has `type: "error"`, `code`, `message`, `retryAfter` (seconds). Allowance, pause and
visitor limits also produce a partial `done`; transport/response failures terminate with `error`.
`done` and `error` carry `usage`: page and photo requests started upstream on the current UTC day,
across all visitors, excluding cache hits. The footer shows it.
The page keeps streamed rows, shows incomplete results or errors, and requires Search to retry.

- Send Where, From, Course and Language upstream. Empty Course sends every in-scope type.
  NM/NF sends only IDs 3 and 1, or makes zero requests when Course excludes both.
- Read ten-course pages in date order; deduplicate IDs and apply As, centers, wait lists,
  not-open-yet and Language again before counting. Stop at **50 matches**.
- A course is at a center when dhamma.org says so or its venue names a directory center. Copies
  of one course listed by different locations count once
  ([dhamma-api.md](dhamma-api.md#venues-and-copied-listings)): they must match in every course
  field except ID and application link, and either share a mycourses form or, while one has no
  form, be held at the same center (the listing location, or the one directory center the venue
  names) without conflicting venue URLs. Different forms never merge. A copy held at another
  location's center waits until that center's listing replaces it or a later start date shows
  none will come.
- At a truncated query's tenth page, query again from its last raw start date. Raw row counts,
  date bounds and IDs drive paging, same-date and nothing-new stops, even when every course on
  a page is dropped. Unusable raw dates are excluded from the bounds. Read at most **20 pages**,
  cached or fresh. Mark cursor stops and the cap partial and show the last date checked.
- Cancellation and a newer search from the same IP stop subsequent pages and remove queued work.

## Cache and upstream limits

dhamma.org is run by a non-profit, so upstream load stays small and bounded. A typical uncached
search costs 5–10 requests, about like a visitor paging through dhamma.org's own results.

Normalized pages and paging metadata are persisted in DO storage, with an in-memory layer.
They remain valid for **24 hours**, including across full dev-server and production restarts.
Keys include a schema version, mode, normalized type/region lists, language, date range and page;
As/availability/display filters reuse the same pages. Simulator scenarios and shifted snapshots
have separate namespaces. Schema version 3 retains `rawCount`, `rawFirstStart`, `rawLastStart`
and `rawIds` alongside normalized courses.

Writes use `getAlarm` to schedule only a missing or earlier expiry alarm; they do not scan storage.
The alarm sweeps expired pages and photos (including photo chunks), then reschedules to the next
expiry. Reads delete expired entries they encounter. Identical in-flight pages share one fetch.
A persisted index keeps up to 32 cached query sequences, their contiguous page prefixes, coverage
ends and oldest fetch times. A broader query covers later From dates, subsets of its type IDs and
places, and the same language (or any language when it has none), with the same daterange end.
Place containment uses directory ancestry, explicit location states and known cached venue parents.
The furthest covering sequence is reused and filtered with the submitted filters. An incomplete
prefix covers dates strictly before its last cached start date; an untruncated final page covers the whole range.
If more matches are needed, the submitted query continues from that boundary. Reused pages count
toward the 20-page cap and oldest `checkedAt`; expired pages invalidate their index entries.
Reused progress events carry `reused: true`. Exact queries keep their ordinary page cache.
No extra broad pages are fetched to enable reuse.
There is no background refresh, bulk course index or cache warming.

- FIFO queue: one request at a time, starts at least 1,500 ms apart in live mode (250 ms in dev).
- Rolling hourly allowances: 100 search requests and a separate 60 photos. Timestamps persist.
  Spent allowances permit cached data and stop at the first uncached page.
- One active search per IP; at most three searches needing uncached pages per rolling minute.
- 429, 5xx, non-JSON, malformed JSON/envelopes, timeout, slow responses and transport failures
  pause upstream requests for five minutes, or a longer Retry-After, capped at one hour. The pause
  persists; cached pages and photos remain available. Valid slow responses are cached and returned
  before further uncached requests pause. Invalid individual courses are skipped and logged;
  they do not pause the gate. There are **no automatic retries**.
- Default timeout: 20 s; slow threshold: over 10 s. Request logs include rolling hourly counts.
  A persisted per-UTC-day count of started page and photo requests feeds `usage`.
- Identity: `sitserve/<version> (+<SITE_URL>; <UPSTREAM_CONTACT>)`. Redirects are not followed.
  No cookies, browser identity, Origin or Referer are sent.

`GET /photo/system/images/...` and `/photo/assets/...` accept image paths only. Live photos use
the same queue, identity and breaker, are stored for seven days, and receive a one-day browser
cache lifetime. Simulator photos are generated SVG placeholders with no upstream request.

## Audience

sitserve is for private use by a few invited people. Access must be restricted (for example with
Cloudflare Access) so nobody else spends the allowance. Before opening it up, write to dhamma.org's
webmasters about the limits and date cursor. If they object to the cursor, stop at their 100-course
limit and show partial results.

## Local development

Wrangler 4.162.0 is the only development dependency. No frontend dependencies or build step.

```sh
npm run dev           # simulator on http://127.0.0.1:8787; .wrangler/state persistence
npm test              # all Node unit/fidelity and Worker tests; remote fetches blocked
npm run test:worker   # real local Worker, SQLite persistence, full restart and faults
npm run test:browser  # Playwright against local Workers; external requests blocked
```

Playwright is installed outside the checkout in `/tmp/sit-web-test/node_modules`. `CHROME_PATH`
selects a browser; otherwise the runner uses local macOS Chrome or Playwright Chromium.
`SITSERVE_SCREENSHOT_DIR` saves screenshots. A browser launch failure exits and cleans up the
local Worker. The simulator dev process also blocks remote Node connections and telemetry. Worker tests route
all HTTP egress through the same offline guard. Dev logs and registry files stay under `.wrangler/`.

The simulator parses the actual form-encoded Request built by the client, using the deduplicated
raw corpus in `worker/fixtures/dhamma/`. Date bounds, region OR matching, ISO languages, fixed
paging and clamping follow the saved probes. Totals describe this small corpus, not the whole site.
`manifest.json` records byte-identical page captures, hashes, known request parameters, retained
fields and normalization differences. `probe-facts.json` records every Nov 14 probe's metadata.
`oracle-input.json` and `oracle-expected.json` verify all 152 original sample courses.

Environment controls (set before `npm run dev`, or as Wrangler vars):

- `SIMULATOR_DATE_SHIFT=1` (dev default): move dates by whole weeks from the Nov 14 snapshot;
  use `0` with `SITSERVE_TODAY=2026-11-14` for reproducible results.
- `SIMULATOR_DELAY_MS`, `SIMULATOR_FAULT=429|503|html|slow|malformed` exercise loading/errors.
- `SIMULATOR_SCENARIO=sparse` generates 2,000 courses with one available position for cap tests.
- `UPSTREAM_SPACING_MS`, `UPSTREAM_ALLOWANCE`, `PHOTO_ALLOWANCE`, `VISITOR_SEARCHES_PER_MINUTE`,
  `UPSTREAM_TIMEOUT_MS`, `UPSTREAM_SLOW_MS` tune the gate.

`npm run dev:live` prints a warning and explicitly selects live mode. It needs `UPSTREAM_CONTACT`
in ignored `.dev.vars`; production uses a secret. Set `SITE_URL` to the real site before deployment.
The production environment uses live mode; ordinary dev and every test use the simulator.

Regenerate place metadata from saved files, without network access:

```sh
node web/tools/build-places.js /path/to/search.html /path/to/directory.html
node scripts/import-fixtures.js /path/to/dhamma-saved
```

The place generator reproduces the original 1,170 places, tags, counts and region memberships.
Search location 1699 has no directory pin and defaults to non-center. The fixture importer uses
the preserved oracle; an optional original snapshot JS argument verifies the original metadata
and extracts the oracle. Safe URL canonicalization, sanitized comments, proxied photos, `hasNotes`,
venue URLs and centers at venues that name one are the intentional normalization differences.
Countries without a saved flag use a text fallback; no flag or photo is downloaded during development.

## Deployment and tuning remain

Set a real domain/SITE_URL, configure secrets and access restriction, then deploy. Tune spacing,
allowances, timeout and slow thresholds from logs. Decide metadata refresh cadence. Production
deployment and live upstream verification are separate from local development.
