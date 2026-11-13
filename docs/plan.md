# Plan

`sit` is a website for finding Vipassana courses on dhamma.org that you can still sign up for.
The frontend is plain HTML, CSS and JavaScript; the live-data backend will be JavaScript too.
The current implementation and visual decisions are documented in [web/design.md](../web/design.md).

## Current state

- `web/mockup.html` runs entirely in the browser on a fixed snapshot in `web/mockup-data.js`.
- Place chips, course and availability filters, URL sharing, reorderable columns, responsive
  layouts and light/dark themes are implemented. The sample date, 2026-11-13, stands in for today.
- Square flags are local SVG assets. Location photos are fetched on hover from dhamma.org.
- The Go CLI, module and index package have been removed. No live-data backend exists yet.

## Live-data phase

1. Add a small JavaScript server or serverless function that serves the page and a same-origin
   `/api/search` endpoint. dhamma.org does not allow our browser origin through CORS: a plain
   POST from `http://localhost:8000` returned JSON without `Access-Control-Allow-Origin` when
   checked on 2026-11-13. See [dhamma-api.md](dhamma-api.md).
2. Translate Where, From and Course into the upstream search parameters. Keep As, Language,
   centers only, wait lists and not open yet as browser filters over the fetched results.
3. Normalize live courses into the fields the mockup already renders. Sanitize comments and
   resolve application, schedule and image URLs.
4. Fetch result pages sequentially with a short pause. One query returns at most 100 courses;
   split date ranges when `total_rows` exceeds that limit, deduplicate by course ID, and stream
   results to the page. Consider a short in-memory cache.
5. Add loading, error, empty and partial-result states, cancel stale searches, and use the real
   current date in live mode.
6. Fetch any needed place search texts, IDs, course types and directory region relationships
   with a JavaScript script. Keep generated metadata separate from live course availability.

## Development

- The mockup needs no installation or build step: open `web/mockup.html` or serve `web/` with a
  static server. Browser verification should cover place selection, filters, notes, column
  reordering and persistence, themes, and both sides of the 820px layout breakpoint.
- `web/tools/test-mockup.cjs` provides browser regression checks. Install Playwright outside the
  checkout with `npm install --prefix /tmp/sit-web-test playwright`, then run
  `NODE_PATH=/tmp/sit-web-test/node_modules node web/tools/test-mockup.cjs`. It uses local Chrome
  on macOS, a `CHROME_PATH` override, or Playwright's installed Chromium. Test dependencies are
  optional and are not needed to view the mockup.
- The existing Python tools under `web/tools/` record how the snapshot was prepared. New
  metadata-fetching and backend work should use JavaScript.
- Make plain requests to dhamma.org: no browser cookies and no imitating a browser.

## Still to decide

- JavaScript runtime, hosting and deployment setup.
- Refresh cadence and storage for place metadata, and cache lifetime for live searches.
- Whether to proxy the location photos or keep loading them from dhamma.org on hover.
