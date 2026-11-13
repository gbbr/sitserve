# dhamma.org data sources

Data sources on www.dhamma.org for the website's sample data and future JavaScript backend.
None of this is a documented public API: these are the endpoints and inline data the site's own
pages use, so they can change without notice. Verified 2026-11-13.

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
  --data-urlencode 'current_state=NewStudents' \
  --data-urlencode 'daterange=2026-11-13 - 2027-11-13' \
  --data-urlencode 'course_type_constraint[]=3' \
  --data-urlencode 'course_type_constraint[]=31' \
  --data-urlencode 'regions[]=region_402' \
  --data-urlencode 'page=1' \
  --data-urlencode 'sort_column=dates' \
  --data-urlencode 'sort_direction=up' \
  --data-urlencode 'date_format=YYYY-MM-DD'
```

### Parameters

| Parameter | Notes |
|---|---|
| `current_state` | Search mode: `NewStudents`, `OldStudents`, `Children`, `ChildrenAnapana` or `Executives`. |
| `course_type_constraint[]` | Course type IDs, repeatable (see [Course type IDs](#course-type-ids)). **Required:** without it every search returns 0 results. The site sends all types of the current mode. |
| `daterange` | `YYYY-MM-DD - YYYY-MM-DD` |
| `regions[]` | Optional, repeatable; matches courses in any of them. Format `<kind>_<id>`, see [Place IDs](#place-ids). Omit to search worldwide. |
| `page` | 1-based |
| `sort_column`, `sort_direction`, `date_format` | The site sends `dates`, `up` and `YYYY-MM-DD`; other values untested. |
| `languages[]`, `course_types[]`, `attendee_types[]`, `genders[]` | Sent by the site's filter widgets; value formats untested. |

### Limits

- 10 courses per page and at most 10 pages, so one query returns at most 100 courses.
  `total_rows` still gives the full count, and `pages_truncated` is `true` when it's over 100.
  Broader queries have to be split, e.g. by date range.
- Typical sizes for one year from 2026-11-13: new-student courses worldwide 3,487; in the
  Americas 441; long courses (IDs 66, 4, 11, 12, 23, 6, 21) worldwide 278.
- The site's script sets `page_size: 10` but doesn't send it. Whether the server accepts a page
  size parameter is untested.

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
| `location` | object | Same fields as the [location API](#location-details-get-enapiv1locationsidjson), plus `sub_location` and `sub_location_id` naming the venue when the location has several. |

`location.haversine_distance` is always `null`, and no distance parameter is known.

### Course type IDs

Listed in `viewModel.course_types(...)` on `/en/courses/search`. A future JavaScript metadata
script can extract these for the website. By search mode:

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
on `/en/courses/search`; `web/mockup-data.js` contains a snapshot as `PLACES`:

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
sibling `<div class="region-children">`. `sit` doesn't use it; the search and maps pages cover
the same data.

## Schedule pages

`/en/schedules/sch<subdomain>` for centers, `/en/schedules/noncenter/<subdomain>` for non-centers.
All share one template: tables under `sch-header-year` headings, with rows
`<tr class="sch-row-N <raw_course_type>">` and columns for apply, dates, type, status, location
and comments. Date formats vary (`10 Nov - 21 Nov` with the year in the heading, or
`December 22, 2026`). `sit` doesn't use them; the search endpoint has the same information as
structured data.

## Implications for `sit`

- There's no "long-course center" flag, and Dhamma Tapovana's schedule also lists 10-day
  executive, Satipatthana and 1-day courses. Filter by course type instead.
- There's no distance filter. Pick nearby locations using the cached coordinates and pass them as
  several `regions[]=location_<id>`.
