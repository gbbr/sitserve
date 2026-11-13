# Plan

`sit` is a Go CLI for finding Vipassana courses on dhamma.org by place, date and course type.

## Approach

- **Courses are fetched live** from dhamma.org's course search endpoint on every query; no course
  data is stored locally. See [dhamma-api.md](dhamma-api.md).
- **A small cached index** holds what the endpoint needs as input or doesn't provide: locations
  with coordinates and center/non-center status, the search's place IDs, and course type IDs.
  `sit update` rebuilds it from two page requests into `sit/index.json` in the user cache
  directory (`~/Library/Caches` on macOS). Other commands fetch it when it's missing.

## Commands

- `sit update` (done): rebuild the index.
- `sit search`: list courses, soonest first.
  - `--in <place>`: region, country, state or location by name; repeatable.
  - `--near <place|lat,lng> --within <km>`: locations within a radius, worked out from the index.
  - `--from`, `--to`: date range; defaults to the next 12 months.
  - `--type`: e.g. `10-day`, `long`, `20-day`, `satipatthana`, `children`; maps to a search mode
    and course type IDs.
  - `--centers-only`, `--lang <language>`.
  - Table output by default, `--json` for scripting.
- `sit locations`: list and filter locations from the index (by country, centers only, near a
  place).

## Search details

- One query returns at most 100 courses. When `total_rows` is higher, split the date range and
  query each part.
- Fetch result pages one at a time, with a short pause between requests.
- Plain requests only: no browser cookies, no imitating a browser.

## Open questions

- The `--type` vocabulary.
- Whether `--lang` and gender filters use the server's `languages[]`/`genders[]` parameters
  (formats untested) or filter results locally.
