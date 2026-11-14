# dhamma.org data sources

Data sources on www.dhamma.org for the sitserve's local simulator and live JavaScript backend.
None of this is a documented public API: these are the endpoints and inline data the site's own
pages use, so they can change without notice. Verified 2026-11-13; pagination, date ranges and
filters rechecked on 2026-11-14, when `/robots.txt` contained no rules.

dhamma.org's [Terms of Use](https://www.dhamma.org/en/docs/forms/Dhamma.org_Terms_of_Use.pdf),
a click-through agreement for its online services and APIs, doesn't mention automated access
(read 2026-11-14). Its acceptable-use policy forbids "intentionally wasting Dhamma.org's
resources or the time of its volunteers" and "activities that lead to confusing and competing
Vipassana choices".

Plain HTTP requests work. No cookies, CSRF token or browser headers are needed, and none should be
sent: don't replay cookies from a browser session (such as Cloudflare's `cf_clearance`) or imitate
a browser.

A search POST tested with `Origin: http://localhost:8000` returned JSON but no
`Access-Control-Allow-Origin` header. Browser JavaScript at that origin cannot read the response;
use a small same-origin JavaScript proxy for live searches. The Origin header was used only to
check CORS behavior; ordinary backend requests do not need it.

## Course search: `POST /en-US/courses/do_search`

Form-encoded request, JSON response. The site uses the current page's locale prefix (`/en/`,
`/en-US/`, …); all verified queries used `/en-US/`.

```sh
curl -s -X POST https://www.dhamma.org/en-US/courses/do_search \
  -H 'Accept: application/json' -H 'X-Requested-With: XMLHttpRequest' \
  --data-urlencode 'current_state=OldStudents' \
  --data-urlencode 'daterange=2026-11-13 - 2027-11-13' \
  --data-urlencode 'course_type_constraint[]=3' \
  --data-urlencode 'course_type_constraint[]=1' \
  --data-urlencode 'regions[]=region_402' \
  --data-urlencode 'page=1' \
  --data-urlencode 'sort_column=dates' \
  --data-urlencode 'sort_direction=up' \
  --data-urlencode 'date_format=YYYY-MM-DD'
```

### Parameters

| Parameter | Notes |
|---|---|
| `current_state` | Search mode: `NewStudents`, `OldStudents`, `Children`, `ChildrenAnapana` or `Executives`. For course type 3, `NewStudents` and `OldStudents` returned the same 3,531 courses: the mode sets which types the site offers, not which courses match. |
| `course_type_constraint[]` | Course type IDs, repeatable (see [Course type IDs](#course-type-ids)). **Required:** without it every search returns 0 results. The site sends all types of the current mode. |
| `daterange` | `YYYY-MM-DD - YYYY-MM-DD`. Returns courses that start on or after the first date and end on or before the second: `2026-12-02 - 2026-12-03` returned nothing, while `2026-12-02 - 2026-12-14` returned 10-day courses running Dec 2–13. A later first date works as a cursor past the 100-course limit. |
| `regions[]` | Optional, repeatable; matches courses in any of them. Format `<kind>_<id>`, see [Place IDs](#place-ids). Omit to search worldwide. |
| `page` | 1-based. A page past the last one returns the last page: `page=11` returned page 10. |
| `sort_column`, `sort_direction`, `date_format` | The site sends `dates`, `up` and `YYYY-MM-DD`; other values untested. |
| `languages[]` | ISO codes from the search page's language list, e.g. `en`. Narrows results: a two-year worldwide 10-day search went from 4,069 to 3,928 courses, and its first page held only courses with English among their instruction languages. |
| `attendee_types[]` | `Attend` or `Serve`. Narrows results (sitserve's in-scope types worldwide for one year: 4,681 → 4,421 and 4,359) but ignores availability: full, closed and in-progress courses still appear. Which courses it removes is unverified. |
| `genders[]` | `Male` or `Female`, the option text the site sends. Accepted, but totals and courses were unchanged. |
| `course_types[]` | Sent by the site's course type widget; value format untested. |

### Limits

- 10 courses per page and at most 10 pages, so one query returns at most 100 courses.
  `total_rows` still gives the full count, and `pages_truncated` is `true` when it's over 100.
  Broad queries reach this quickly: the first 100 worldwide 10-day courses from 2026-11-14 all
  started by Nov 21. sitserve continues with a new query from the last returned start date, within
  a per-search page cap (see [plan.md](plan.md#live-search)).
- Typical sizes for one year from 2026-11-13: new-student courses worldwide 3,487; in the
  Americas 441; long courses (IDs 66, 4, 11, 12, 23, 6, 21) worldwide 278. All of sitserve's
  in-scope types worldwide for one year from 2026-11-14: 4,681.
- The page size is fixed at 10: `page_size` and `per_page` are ignored. The site's script sets
  `page_size: 10` but doesn't send it.

### Live pagination check (2026-11-14)

A worldwide `OldStudents` query with all of sitserve's in-scope types and date range
`2026-11-14 - 2027-11-14` reached 30 usable matches on page 4. Those four pages contained 40
courses: 33 with an open or wait-list position, four in progress and one cancelled, plus two
closed courses. The in-progress courses all started on 2026-11-14; no course in these pages
started before the requested From date. A start date of today does not mean registration is
still open: courses starting today can already be in progress in the location's local time.

This is one observed query, not a guarantee. Narrower applicant, language or availability
filters can use up a query's 100 courses with few matches, even when `total_rows` reports many
more; the date cursor then continues from a later start date. The result limit is a maximum,
and searches stopped by the page cap must be identified as partial.

### Response

Top level: `courses`, `page`, `pages`, `total_rows`, `formatted_total_rows`, `pages_truncated`,
`saved_search_uuid` and `saved_search_params` (the accepted filters, without `daterange` and
`page`).

Useful course fields:

| Field | Example | Notes |
|---|---|---|
| `id` | `212733` | |
| `course_start_date`, `course_end_date` | `"2026-11-16"` | ISO dates |
| `enrollment_open_date` | `"2026-09-17"` | |
| `raw_course_type` | `"10-Day"`, `"20-DayOSC"`, `"ServicePeriod"` | Stable type code; use it rather than `course_type`. |
| `course_type` | `"10-Day"`, `"Mega 3-day Course"` | Free-text label set by the location; may contain HTML. |
| `course_type_number_nights` | `11` | `0` for service periods, one-day and children's courses and other events. |
| `course_instruction_languages` | `["Hindi", "English"]` | |
| `status` | `[{"status": "Wait List", "color": "Yellow", "label": "Women", "type": "w"}]` | One entry per applicant group. `type`: `m`/`w` men/women, `nm`/`nw` new students, `om`/`ow` old students, `ms`/`fs`/`s` servers, `null` the whole course. Seen statuses: `Open`, `Wait List`, `Closed`, `Course Full`, `In Progress`. |
| `service` | `false` | `true` seen on `ServicePeriod`, `OSProgram` and some `Other` entries. |
| `apply_link_url` | `"/portal/student_apps/new_app?course_id=…&location_id=…"` | Site-relative. |
| `app_page_url` | `"https://schedule.vridhamma.org/form/…"` | External application form (Indian centers); empty otherwise. |
| `comments` | HTML | Notes from the location. |
| `location` | object | Same fields as the [location API](#location-details-get-enapiv1locationsidjson), plus `sub_location` and `sub_location_id` naming the venue when the location has several. `header_image_path` is the site-relative photo: `/system/images/centers/<name>.jpg`, or a default image under `/assets/`. |

`location.haversine_distance` is always `null`, and no distance parameter is known.

### Course type IDs

Listed in `viewModel.course_types(...)` on `/en/courses/search`. `web/tools/build-places.js` extracts these from saved HTML. By search mode:

- **NewStudents:** 3 10-Day, 31 9-Day
- **OldStudents**, under the site's headings:
  - *Short:* 5 1-Day, 19 2-Day, 9 3-Day, 25 4-hour meditation
  - *Long:* 66 14-Day Gratitude, 4 20-Day, 11 30-Day, 12 45-Day, 23 60-Day, 6 Special 10-Day,
    21 Teacher's Self Course
  - *Other:* 3 10-Day, 28 10-Day for Old Students, 31 9-Day, 32 Group Sitting, 24 Old Student
    Program, 22 Old Student Self Course, 15 Open Day, 26 Other, 10 Satipatthana Sutta, 27
    Teacher's Self Course, 33 Virtual Group Sitting, 7 Work Period
  - *Child/Teen:* 30 7-day course for teens, 13 Children, 14 Children / Teens, 8 Teen
  - *Executive:* 1 Executive Course
- **Children:** 30, 13, 14, 8
- **ChildrenAnapana:** 13, 14, 8
- **Executives:** 1

Search results give a course's type as a `raw_course_type` code, not the ID: 3 `10-Day`,
28 `10-DayOSC`, 6 `10-DaySpecial`, 1 `10-DayExecutive`, 66 `14-DayGratitude`, 4 `20-DayOSC`,
11 `30-DayOSC`, 12 `45-DayOSC`, 23 `60-DayOSC`, 21 `TSC`, 10 `Satipatthana`, 5 `1-DayOSC`,
19 `2-DayOSC`, 9 `3-DayOSC`, 25 `4-hrOSC`, 24 `OSProgram`, 15 `OpenHouse`, 26 `Other`,
7 `ServicePeriod`, 30 `7-DayTeen`, 13 `Child`, 14 `Child-Teen`, 8 `Teen`. IDs 31, 32, 22, 27 and
33 had no courses listed through 2027, so their codes are unknown.

### Place IDs

`regions[]` takes `<kind>_<id>`. Every valid value is listed in `viewModel.search_regions([...])`
on `/en/courses/search`; `web/places.js` contains the generated `PLACES` metadata:

| Kind | Count | Example | Notes |
|---|---|---|---|
| `region` | 154 | `region_402` Americas | Continents, sub-regions, countries, Indian states. Same IDs as `data-id` on the directory page. |
| `state` | 142 | `state_3905` Alabama, United States | States and provinces |
| `location` | 409 | `location_1534` Dhamma Dipa | Centers and non-centers. Same IDs as the location API. |
| `sublocation` | 465 | `sublocation_12303` 2189 Professor Ave, Cleveland, OH | Individual venues |

An entry looks like
`{"id":["location",1442],"texts":["Dhamma Giri","Maharashtra","Igatpuri","Giri","giri","MH"],"text":"Dhamma Giri, Igatpuri, Maharashtra, India"}`.
For locations, `texts[4]` is the subdomain.

## Location details: `GET /en/api/v1/locations/<id>.json`

One location as JSON: `id`, `sub_domain`, `dhamma_name`, `city`, `state`, `country`,
`country_iso_code`, `center_noncenter` (`center` or `noncenter`), `schedule_url`, `website_url`,
`map_url`, `year_of_first_course`, `location_languages`, and HTML `contact` and `about`. The maps
page can supply location names and coordinates in one request when only those fields are needed.

## Maps page: `GET /en/maps`

Inline script objects keyed by subdomain (locations) or region code:

- `position_data`: `{"sukhada": {"latitude": "-35.163605", "longitude": "-58.30524", "zoom": 5}, …}`.
  Coordinates are strings. 563 entries: the 410 locations plus regions. `ci` and `fa` are at
  0,0 (unknown).
- `location_data`: `{"sukhada": {"iscenter": true, "title": "Dhamma Sukhadā", "description": "<html>"}, …}`.
  410 entries (274 centers, 136 non-centers). Non-center titles end in ` non-center`. The
  description HTML holds the country flag (`flag-ar`), an address line, the schedule link and the
  website link.

`mitra.in` appears here but not in the search page's place list.

## Directory: `GET /en/locations/directory`

HTML list of every location, nested World › continent › country › state. Locations are
`<div class="location" data-id="1320" data-subdomain="sukhada" data-name="…" data-country-iso-code="AR">`
containing a `center-pin` or `noncenter-pin`. Regions are
`<div class="region" data-id="402" data-name="Americas" data-subdomain="019">`, followed by a
sibling `<div class="region-children">`. sitserve uses the directory for nesting and
center/non-center pins, and the search page for selectable places.

## Schedule pages

`/en/schedules/sch<subdomain>` for centers, `/en/schedules/noncenter/<subdomain>` for non-centers.
All share one template: tables under `sch-header-year` headings, with rows
`<tr class="sch-row-N <raw_course_type>">` and columns for apply, dates, type, status, location
and comments. Date formats vary (`10 Nov - 21 Nov` with the year in the heading, or
`December 22, 2026`). sitserve does not use schedule HTML; the search endpoint has the same information as
structured data.

## Implications for sitserve

- There's no "long-course center" flag, and Dhamma Tapovana's schedule also lists 10-day
  executive, Satipatthana and 1-day courses. Filter by course type instead.
- There's no distance filter. Pick nearby locations using the cached coordinates and pass them as
  several `regions[]=location_<id>`.
- The site's applicant filters are attend/serve and gender, and neither considers availability.
  sitserve's As filter (new / old / server × male / female) checks that position's status itself.

## Local implementation

`worker/dhamma.js` builds this form request with `Accept: application/json` and
`X-Requested-With: XMLHttpRequest`. Live identity is
`sitserve/<version> (+<SITE_URL>; <UPSTREAM_CONTACT>)`; missing contact prevents all live requests.
Redirects are not followed. The client validates page/course fields and classifies throttling,
5xx, challenges/non-JSON, malformed JSON/envelopes, timeout and slow responses, without retries.
Invalid individual courses are skipped and logged. Valid slow responses are cached and returned
while further uncached requests pause.

The ordinary development mode is a simulator that parses those real form Requests using saved
raw course objects. No development command or test needs dhamma.org. The curated byte-identical
responses, capture dates, known request parameters and hashes are in
`worker/fixtures/dhamma/manifest.json`; unknown date ranges are recorded as null. Probe metadata
is in `probe-facts.json`. Corpus fields omitted for size are listed in the manifest.

The DO shares normalized pages for **24 hours**, persisted across restarts; photo storage lasts
seven days. API responses are streamed NDJSON and have `Cache-Control: no-store`. Run
`npm run dev`, `npm test`, `npm run test:worker` or `npm run test:browser` for offline work.
`npm run dev:live` and the Wrangler `production` environment are explicit live modes. See
[plan.md](plan.md) for pacing, allowances, breaker behavior and the stream contract.
