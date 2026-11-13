# sit web: design and handoff

A single page for finding Vipassana courses on dhamma.org that you can still sign up for. It
re-renders as you change the filters at the top. `web/mockup.html` is a working mockup that runs
on a sample of real courses in `web/mockup-data.js`. It's plain HTML, CSS and JS in one file:
no framework, no build step, no external assets.

## Filter bar (sticky, top)

- **Where**: places as chips; see [Where box](#where-box). Courses in any chosen place show.
- **From**: start date, default today. No end date: every course from then on.
- **Course**: toggle chips; any number can be on, and none on means all. The page covers only:

  | Chip | Full name | `raw_course_type` | Search ID |
  |---|---|---|---|
  | 10D | 10-day | `10-Day` | 3 |
  | 10D OS | 10-day for old students | `10-DayOSC` | 28 |
  | 10D SPCL | Special 10-day | `10-DaySpecial` | 6 |
  | 14D | 14-day gratitude course | `14-DayGratitude` | 66 |
  | 20D / 30D / 45D / 60D | 20/30/45/60-day | `20-DayOSC` … `60-DayOSC` | 4 / 11 / 12 / 23 |
  | TSC | Teacher's self course | `TSC` | 21 (27 unused) |
  | EXEC | Executive course | `10-DayExecutive` | 1 |
  | STP | Satipaṭṭhāna Sutta course | `Satipatthana` | 10 |
  | 3D | 3-day | `3-DayOSC` | 9 |

  Codes for other types, if added later: 1D, 2D, 4H, 9D, GS, VGS, OSP, OSSC, OD, WP, Other,
  7D TEEN, CHLD, CHLD/TEEN, TEEN.
- **As**: anyone, or new / old / server × male / female. This narrows "can sign up" to that
  position and highlights its light column.
- **Language** (one instruction language) and **centers only**.
- **Also show**: wait lists (on by default) and not open yet (on by default).
- **Theme switch**, top right: light/dark. The page follows the system until the switch is
  clicked, then remembers the choice in localStorage.
- Filters live in the URL fragment, so a search can be bookmarked or shared.

## Course list

- **Which courses show:** only courses you can still sign up for. A course shows when a
  relevant position (any position, or the **As** one) is green, or yellow/orange while wait
  lists are on. Courses whose registration hasn't opened yet also show, because registration
  opens only 2–3 months ahead. In-progress, full and closed courses never show, and there's
  no "N hidden" count.
- **Summary line:** "N courses you can sign up for", plus a legend: center/non-center dots and
  the open / wait list / long wait list / closed lights.
- **Grouping:** rows are grouped by start month. The column headings stick under the filter
  bar, and the month headings ("NOVEMBER 2026 63") stick under the column headings. Rows sort
  by start date, then name.
- **Rows:** compact, one 32px line each.
- **Columns** (default order), meant to be rearranged by dragging their headings, with the
  order remembered (not built yet):
  1. **Location**:
     - Shows the flag emoji, then the name without its "Dhamma " prefix, then a tiny faint
       dot: green for a center, blue for a non-center. The legend is the only explanation.
     - Hovering the flag shows the location ("Onalaska, Washington, United States"). For a
       non-center, the venue appears on the line above it.
     - Hovering the name shows the photo (`header_image_path`, 284×200) with the full name and
       its meaning. Clicking the name opens the center's website.
  2. **Dates**: "Nov 18 – 29" or "Nov 25 – Dec 6", with no year (the month heading has it). The
     end is at 40% opacity so the start stands out. Hovering shows the full dates with weekdays.
  3. **Type**:
     - Shows the chip code, then a notes icon when the course has comments.
     - Hovering the code shows the full name, with the languages on a second line.
     - The notes icon toggles an inline panel under the row. The panel shows the sanitized
       comments, plus the location's own label for the course when it says more than the type.
  4. **Lights**: six 13px columns with a two-row heading: NEW / OLD / SRV, each over M F.
     Columns in a pair are 2px apart, groups 12px apart.
  5. **Apply**: a centered "Apply" link to the application form. Before registration opens it
     shows the opening date instead, as aligned month and day columns ("Mar  2", "Mar 21").
  6. **Schedule**: a calendar icon linking to the location's schedule.
- **Tooltips:** every hover uses one instant custom tooltip (`data-tip`), because native
  `title` tooltips lag or don't show.

### Lights

dhamma.org gives one status per applicant group, `{status, color, label, type}`. Colors are
shown as given:

| Color | Statuses |
|---|---|
| Green | Open, Filling Up |
| Yellow | Wait List, Short Wait List |
| Orange | Long Wait List |
| Red | Closed, Course Full, FULL |
| none | In Progress |

How a status's `type` fills the columns:
- `m` fills NM and OM; `w` fills NF and OF; `s` fills SM and SF.
- `nm`, `nw`, `om`, `ow`, `ms` and `fs` each fill their own column.
- A status with no type covers all six columns.
- When entries overlap, the more specific one wins.
- NM and NF stay empty unless the course takes new students (10D, EXEC).
- Courses whose registration isn't open yet show no lights.

## Where box

This should work like dhamma.org's own search box (select2 over `viewModel.search_regions`).

**Places:**
- 154 regions: World, continents, sub-regions, countries and Indian states.
- 142 states and provinces.
- 409 locations.
- 465 venues (sublocations).

Each place has a display text and search texts: name, state, city, short name, subdomain, and
codes such as "WA" or "IN".

**Matching:**
- Typing suggests places grouped as Regions / States and provinces / Centers and non-centers /
  Venues, up to 8 per group plus an "N more" hint.
- Every typed word must appear in one of a place's search texts, ignoring accents.
- Ranking: exact matches first, then prefixes, word starts and substrings. Ties go to regions,
  then to bigger regions. Matched words are bold.
- Each suggestion shows a tag (continent / region / country / state / center / non-center /
  venue), and regions also show how many locations they contain.
- With nothing typed, the suggestions are the continents.

**Using it:**
- Keyboard: the arrows move through suggestions, Enter picks one, Escape closes the list, and
  Backspace in an empty box removes the last chip.
- Each chip shows the place name, its full text on hover, and × to remove it.

## Real implementation (next phase)

- **Server:** `sit serve` serves the page and `/api/search`, which calls dhamma.org's
  `do_search` with plain HTTP only: no browser cookies, no imitating a browser (see
  CLAUDE.md). A page in the browser can't call dhamma.org directly anyway.
- **Query parameters:**
  - Places go in `regions[]` as `kind_id`.
  - Course types go in `course_type_constraint[]`, using the IDs in the table above.
  - `current_state=OldStudents` covers every type.
  - `daterange` runs from the From date to an end date well past the last listed course.
- **Limits:** one query returns at most 100 courses. When `total_rows` is higher, split the
  date range. Fetch pages one at a time with a pause, stream results to the page, and
  consider a short in-memory cache.
- **What needs a query:** only Where, From and Course need a new server query. As, Language,
  centers only and the two "also show" checkboxes filter in the browser.
- **Payload:** send only the fields the page uses (see the course objects in
  `mockup-data.js`), with `comments` sanitized.
- **Index:** `sit update` should also cache each place's search texts and the region nesting
  from `/en/locations/directory`, for the Where box. `web/tools/places.py` parses both.
- **Assets:** photos are hotlinked from dhamma.org; the server could proxy them. Flags are
  emoji, which Windows renders as letter pairs.

## Status: where to pick up

**Done** in `mockup.html`: everything above except the Where box and column dragging.

**To do in the mockup:**
1. **Where box.** Today "Where" is a plain text filter on name, venue and place. The data is
   already in `mockup-data.js`:
   - `PLACES`: `[kind, id, text, search texts, tag, location count]`.
   - `LOCATION_REGIONS`: `{location id: [enclosing region ids]}`.
   - Courses have `loc.subId`, `loc.state` and `loc.country`.
   - In the mockup, a course is in a region when its location's region list includes it. It's
     in a state when the location's state and country match. Locations and venues match by
     `loc.id` and `loc.subId`.
   - Keep the chosen place keys (`region_402,…`) in the hidden `where` value and the URL
     fragment.
2. **Draggable columns.**
   - Move the flag into the Location cell, so each column is one grid track.
   - Build the heading and the rows from a column → cell-HTML map in the current order, and set
     `grid-template-columns` from that order.
   - Use HTML5 drag-and-drop on the heading cells with a drop marker, and save the order in
     localStorage.
3. Fix the phone-width layout: the filter bar overflows.

**Then:** build the real implementation, and update `docs/plan.md`, which still describes
only the CLI.

**Mockup data:** `mockup-data.js` is a snapshot taken from dhamma.org on 2026-11-13. It's built
by `web/tools/mkdata.py` from saved pages: one `do_search` page per course type, plus the search
and directory pages. The mockup uses that date as "today".
