# sitserve

A website for finding Vipassana courses listed on dhamma.org that you can still sign up for.
`web/index.html` and `web/app.js` are plain HTML/CSS/JavaScript, with no page build step.
`worker/` is the Cloudflare Worker and SQLite-backed Durable Object backend.

- UI decisions: [docs/design.md](docs/design.md)
- Architecture, limits and development: [docs/architecture.md](docs/architecture.md)
- Verified upstream behavior: [docs/dhamma-api.md](docs/dhamma-api.md)

Use **sitserve** for the app, package and Worker. Preserve localStorage key `sit.columns`.
Documentation lives in `docs/`. Docs and comments describe the current purpose and behavior,
with concise wording.

`npm run dev` uses saved data and a local simulator; it never contacts dhamma.org, including
photos. `npm test`, `npm run test:worker` and `npm run test:browser` are offline. Keep fetch,
clock, timers and storage injectable. Check interactions and responsive layouts after UI changes.
Playwright lives outside the checkout at `/tmp/sit-web-test/node_modules`.

Only explicit live mode (`npm run dev:live` or the Wrangler `production` environment) can contact
dhamma.org. It requires `UPSTREAM_CONTACT` in `.dev.vars` or a secret. All upstream requests pass
through one Durable Object, with plain HTTP: no browser cookies, browser User-Agent, Origin or
Referer. Never run live mode as part of development verification. New metadata tools read saved
files with JavaScript; they do not fetch upstream pages.
