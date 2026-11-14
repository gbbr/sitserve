# Plan

`sit` is a website for finding Vipassana courses on dhamma.org that you can still sign up for.
The frontend is plain HTML, CSS and JavaScript; the live-data backend will be a JavaScript
Cloudflare Worker. The current implementation and visual decisions are documented in
[web/design.md](../web/design.md).

## Current state

- `web/mockup.html` runs entirely in the browser on a fixed snapshot in `web/mockup-data.js`.
- Place chips, course and availability filters, explicit Search submission, URL sharing,
  reorderable columns, responsive layouts and light/dark themes are implemented. The mockup
  shows up to 30 matching courses; the live search will show up to 50. Editing filters leaves
  the last submitted results in place. From defaults to the viewer's current local date; the
  sample remains a snapshot from 2026-11-13.
- Square flags are local SVG assets. Location photos are fetched on hover from dhamma.org.
- The Go CLI, module and index package have been removed. No live-data backend exists yet.

## Live search

dhamma.org is run by a non-profit, so the backend keeps its load small and bounded: it queries
only when a visitor submits Search, shares one request queue and one page cache across all
visitors, and stops at a fixed allowance. A typical uncached search costs 5–10 upstream
requests, about as many as a visitor paging through dhamma.org's own results. Endpoint details
and the checks behind these rules are in [dhamma-api.md](dhamma-api.md).

### Architecture

- A Cloudflare Worker serves the page and a same-origin `/api/search` endpoint. dhamma.org
  sends no `Access-Control-Allow-Origin` header for our origin, so the browser can't query it
  directly.
- Every dhamma.org request goes through one Durable Object. Worker instances never call
  dhamma.org themselves, so the queue, cache, request merging and allowance below hold across
  the whole site. The Durable Object keeps cached pages in memory and in its storage.

### Search

- **Trigger:** query only when the user submits Search. Filter edits, place suggestions, page
  load and URL restoration never start a search. Keep pending edits separate from the filters
  attached to the displayed results, and update the shareable URL on submission.
- **Upstream filters:** send Where as `regions[]`, From as the start of `daterange`, Course as
  `course_type_constraint[]` and Language as `languages[]`. When As is a new-student position,
  send only 10D and EXEC, the types that take new students, and make no request at all if
  Course excludes both. Keep the `daterange` end fixed well past the last listed course: the
  range only returns courses that end inside it.
- **Backend filters:** normalize each page (sanitize comments; resolve application, schedule
  and image URLs) and apply As, centers only, wait lists, not open yet and a re-check of
  Language before counting a course as a match. dhamma.org's attend/serve and gender filters
  ignore availability, so they can't replace As.
- **Paging:** fetch 10-course pages in date order, deduplicate by course ID, and stream matching
  rows to the page as each page arrives. Stop at **50 matches after all filters**. Fifty is a
  maximum, not a guaranteed count; there is no pagination or Load more.
- **Date cursor:** a query exposes at most 10 pages (100 courses). When `pages_truncated` is
  true and fewer than 50 courses match, start a new query from the last course's start date,
  with the same end date. If all 100 courses of a query share one start date, stop instead of
  looping.
- **Page cap:** read at most 20 pages per search, cached or not, so results don't depend on what
  is cached. A search stopped by the cap is partial: show its matches with "Searched through
  <date>" and suggest a later From or narrower filters.

### Cache

- Cache each upstream page for 1 hour, keyed by its normalized parameters and shared by all
  visitors. Identical requests in flight share one fetch. Changing As, centers only or Also
  show reuses cached pages.
- Show when the results were checked, using the oldest page ("Checked 12 min ago").
- `/api/search` responses use `Cache-Control: no-store`; the page cache is the only cache. No
  course index, bulk download, background refresh or cache warming.

### Load limits

All of these are enforced in the Durable Object.

- **Queue:** one upstream request at a time, 1–2 seconds apart. Alternate between active
  searches, and stop fetching for a search whose visitor disconnects or searches again.
- **Allowance:** about 100 upstream requests per hour. When it's spent, serve cached pages only
  and ask visitors to try again later.
- **Per visitor:** one active search per IP address and a few uncached searches per minute, so
  one client can't use up the allowance.
- **Circuit breaker:** after a 429, a 5xx, a non-JSON response (such as a Cloudflare challenge)
  or an unusually slow response, pause all upstream requests for several minutes, honoring
  `Retry-After`. Never retry automatically or work around a challenge.
- **Identity:** plain HTTP with no browser cookies and no browser imitation, and a User-Agent
  that names the site and gives a contact address. Log upstream requests per hour to tune
  these limits.
- **Contact:** before building the backend, write to dhamma.org's webmasters describing these
  limits and the date cursor, which reaches past their search's 100-course limit. If they
  object to the cursor, stop at that limit and show partial results.

### Page and assets

- Add loading, error, empty and partial-result states; rows appear as pages arrive. Disable
  duplicate submission while a search runs, cancel abandoned requests, and keep results tied to
  their submitted filters when the form is edited during a search. Errors require an explicit
  retry with Search.
- Proxy location photos through the Worker and cache them for several days, so dhamma.org
  serves each photo about once per cache period instead of once per visitor.
- Fetch any needed place search texts, IDs, course types and directory region relationships
  with a JavaScript script. Keep generated metadata separate from live course availability.

## Development

- The mockup needs no installation or build step: open `web/mockup.html` or serve `web/` with a
  static server. Browser verification should cover explicit submission, pending filter edits,
  the 30-match limit after filtering, place selection, notes, column reordering and persistence,
  themes, and both sides of the 820px layout breakpoint.
- `web/tools/test-mockup.cjs` provides browser regression checks. Install Playwright outside the
  checkout with `npm install --prefix /tmp/sit-web-test playwright`, then run
  `NODE_PATH=/tmp/sit-web-test/node_modules node web/tools/test-mockup.cjs`. It uses local Chrome
  on macOS, a `CHROME_PATH` override, or Playwright's installed Chromium. Test dependencies are
  optional and are not needed to view the mockup.
- Develop and test the backend against saved upstream pages. Send live requests to dhamma.org
  only on purpose: during development they can easily outnumber real visitors' searches.
- The existing Python tools under `web/tools/` record how the snapshot was prepared. New
  metadata-fetching and backend work should use JavaScript.
- Make plain requests to dhamma.org: no browser cookies and no imitating a browser.

## Still to decide

- Deployment setup: Wrangler configuration and domain.
- Exact pacing, allowance and per-visitor limits, tuned from the request logs.
- Whether to keep the date cursor, depending on dhamma.org's reply.
- Refresh cadence and storage for place metadata.
