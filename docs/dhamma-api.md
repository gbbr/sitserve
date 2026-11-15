# dhamma.org data sources

The www.dhamma.org endpoints and page data that sitserve's simulator and live backend rely on.
None is a documented public API: they are what the site's own pages use, so they can change
without notice. Verified 2026-11-13; pagination, date ranges and filters rechecked on 2026-11-14,
when `/robots.txt` contained no rules. How sitserve paces and checks its requests is in
[architecture.md](architecture.md).

dhamma.org's [Terms of Use](https://www.dhamma.org/en/docs/forms/Dhamma.org_Terms_of_Use.pdf),
a click-through agreement for its online services and APIs, doesn't mention automated access
(read 2026-11-14). Its acceptable-use policy forbids "intentionally wasting Dhamma.org's
resources or the time of its volunteers" and "activities that lead to confusing and competing
Vipassana choices".

Plain HTTP requests work. No cookies, CSRF token or browser headers are needed, and none should be
sent: don't replay cookies from a browser session (such as Cloudflare's `cf_clearance`) or imitate
a browser. Responses have no `Access-Control-Allow-Origin` header, so browser JavaScript on
another origin can't read them; sitserve calls dhamma.org from its Worker.

## Course search: `POST /en-US/courses/do_search`

Form-encoded request, JSON response. The site uses the current page's locale prefix (`/en/`,
`/en-US/`, …); all verified queries used `/en-US/`. `worker/dhamma.js` sends the same headers as
this example:

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

Neither applicant filter considers availability, so sitserve sends neither: its As filter checks
the chosen position's status itself.

### Limits

- 10 courses per page and at most 10 pages, so one query returns at most 100 courses.
  `total_rows` still gives the full count, and `pages_truncated` is `true` when it's over 100.
  Broad queries reach this quickly: the first 100 worldwide 10-day courses from 2026-11-14 all
  started by Nov 21. sitserve continues with a new query from the last returned start date,
  within a per-search page cap (see [architecture.md](architecture.md#search-and-stream)).
- The page size is fixed at 10: `page_size` and `per_page` are ignored. The site's script sets
  `page_size: 10` but doesn't send it.
- Typical sizes for one year from 2026-11-13: new-student courses worldwide 3,487; in the
  Americas 441; long courses (IDs 66, 4, 11, 12, 23, 6, 21) worldwide 278. All of sitserve's
  in-scope types worldwide for one year from 2026-11-14: 4,681.
- Not every listed course is open. In one worldwide query for all in-scope types from 2026-11-14,
  the first four pages (40 courses) held 33 with an open or wait-list position; the rest were in
  progress, cancelled or closed. Narrower applicant, language or availability filters can use up
  a query's 100 courses with few matches.

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
| `app_page_url` | `"https://schedule.vridhamma.org/form/…"` | External application form: `schedule.vridhamma.org` for Indian centers, or a `mycourses.dhamma.org/…/initial_enrolment_form/<token>` form that identifies the course. Empty otherwise, including for some courses whose enrollment opens months later. |
| `comments` | HTML | Notes from the location. |
| `location` | object | The listing location: `id`, `dhamma_name`, `dhamma_name_meaning`, `city_province_country`, `state`, `country`, `country_iso_code`, `center_noncenter` (`center` or `noncenter`), `pin_class`, `website_url`, `schedule_url`, `header_image_path` and more. `header_image_path` is the site-relative photo: `/system/images/centers/<name>.jpg`, or a default image under `/assets/`. When the location records the course's venue, `sub_location`, `sub_location_id`, `sub_location_url` (a free-form link) and `sub_loc_image` (under `/images/sub_location_images/`) describe it; see [Venues and copied listings](#venues-and-copied-listings). |

A course starting today can already be `In Progress` in the location's local time, so its status,
not its start date, shows whether it still takes applications. `location.haversine_distance` is
always `null`, and no distance parameter is known.

### Venues and copied listings

Verified 2026-11-15 on all 283 saved courses, 156 live results and three schedule pages.

- A course at a venue (`sub_location`) always reports `center_noncenter: "noncenter"` and
  `pin_class: "pin-noncenter"`, even when the venue is a center. Without a venue, both match the
  location's directory pin. Most venues are outside sites, such as Dhamma Suttama's Montreal
  courses, but some are centers: Dhamma Geha records its own site as the venue
  "Dhamma Geha Vipassana Meditation Centre, Bangli".
- Some locations list another location's courses as records of their own. Dhamma Bhumi's schedule
  lists all 36 of Dhamma Pāsāda's courses at Bhumi's venue "Dhamma Pasada" (sub-location 2238).
  Pāsāda lists the same courses at its own venue 2239, which has the same name and URL. Each copy
  has its own course ID and application link (`course_id` and `location_id`), but the same type,
  label, dates, enrollment date, languages, status and comments. On the schedule pages, all 11
  courses with open enrollment used the same mycourses form in both listings. Search returns both
  records, such as 20-day courses 234197 (Bhumi) and 234198 (Pāsāda). Southwest Vipassana Group
  lists Dhamma Sampatti's courses the same way, and the two listings share one form.
- Sub-location IDs belong to the listing location, so they never match across copies.
- Combined schedule pages such as `/en/schedules/noncenter/uk` display other locations' own
  records (here Dhamma Dipa's and Dhamma Sukhakāri's). Search returns those once, under the
  location that holds the course.

sitserve counts a course at a venue naming a directory center as held at that center, and shows
copies once ([architecture.md](architecture.md#search-and-stream)).

### Course type IDs

Listed in `viewModel.course_types(...)` on `/en/courses/search`; `web/tools/build-places.js`
extracts them from saved HTML. By search mode:

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

There's no long-course-center flag, and centers mix types (Dhamma Tapovana also lists 10-day
executive, Satipatthana and 1-day courses), so sitserve filters by course type.

### Place IDs

`regions[]` takes `<kind>_<id>`. Every valid value is listed in `viewModel.search_regions([...])`
on `/en/courses/search`; `web/places.js` contains the generated `PLACES` metadata:

| Kind | Count | Example | Notes |
|---|---|---|---|
| `region` | 154 | `region_402` Americas | Continents, sub-regions, countries, Indian states. Same IDs as `data-id` on the directory page. |
| `state` | 142 | `state_3905` Alabama, United States | States and provinces |
| `location` | 409 | `location_1534` Dhamma Dipa | Centers and non-centers. Same IDs as the search results' `location.id`. |
| `sublocation` | 465 | `sublocation_12303` 2189 Professor Ave, Cleveland, OH | Individual venues |

An entry looks like
`{"id":["location",1442],"texts":["Dhamma Giri","Maharashtra","Igatpuri","Giri","giri","MH"],"text":"Dhamma Giri, Igatpuri, Maharashtra, India"}`.
For locations, `texts[4]` is the subdomain.

## Directory: `GET /en/locations/directory`

HTML list of every location, nested World › continent › country › state. Locations are
`<div class="location" data-id="1320" data-subdomain="sukhada" data-name="…" data-country-iso-code="AR">`
containing a `center-pin` or `noncenter-pin`. Regions are
`<div class="region" data-id="402" data-name="Americas" data-subdomain="019">`, followed by a
sibling `<div class="region-children">`. sitserve uses the directory for nesting and
center/non-center pins, and the search page for selectable places.

## Schedule pages

`/en/schedules/sch<subdomain>` for centers, `/en/schedules/noncenter/<subdomain>` for non-centers;
`location.schedule_url` links to them. All share one template: tables under `sch-header-year`
headings, with rows `<tr class="sch-row-N <raw_course_type>">` and columns for apply, dates, type,
status, location and comments. The location column links to the venue's `sub_location_url`,
otherwise to the listing location's map entry (`/en/maps#<subdomain>`). Apply links on the
Australian and UK pages are the mycourses forms from `app_page_url`. Date formats vary
(`10 Nov - 21 Nov` with the year in the heading, or `December 22, 2026`). sitserve doesn't read
schedule HTML; the search endpoint has the same information as structured data.
