# sit web: design and handoff

A single page for finding Vipassana courses on dhamma.org that you can still sign up for. It
re-renders as you change the filters at the top. `web/mockup.html` is a working mockup that runs
on a sample of real courses in `web/mockup-data.js`. It's plain HTML, CSS and JS in one file:
no framework and no build step. Flags are local assets; location photos load from dhamma.org
on hover. This project is a website; the live-data backend will be JavaScript. The Go CLI and
its index package have been removed.

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
  Chips are grouped by their color, then by duration, in this order:
  - Neutral: 3D, 10D, 10D OS, EXEC.
  - Violet: 10D SPCL, 20D, 30D, 45D, 60D.
  - Teal: STP, 14D, TSC. TSC has no numeric duration code and comes last.
  No visual separators are needed between these groups.
- **As**: anyone, or new / old / server × male / female. This narrows "can sign up" to that
  position, highlights its light column, and enlarges its lights from 8px to 10px. Other
  positions' lights are dimmed to 28% opacity. Anyone restores all lights to their normal size
  and opacity. The legend remains unchanged.
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
- **Summary line:** "N courses you can sign up for", plus a legend: the blue non-center dot and
  the open / wait list / long wait list / closed lights.
- **Grouping:** rows are grouped by start month. The column headings stick under the filter
  bar, and the month headings ("NOVEMBER 2026 63") stick under the column headings. Rows sort
  by start date, then name.
- **Rows:** compact, one 32px line each on wide screens.
- **Columns** (default order), rearrangeable by dragging their headings. A marker shows which
  side of a heading the column will land on. Focused headings also support Alt + Left/Right.
  The order is stored in localStorage as `sit.columns`; invalid saved orders fall back to the
  default. Both headings and rows use one column-to-HTML map and the same grid track order:
  1. **Location**:
     - Shows a square flag, then the name without its "Dhamma " prefix. Only non-centers have
       a tiny faint blue dot; centers have no dot. The legend explains the non-center marker.
     - Flags are 16×16px local SVGs from `flag-icons` v7.3.2, with 2px corners and a fine edge.
       They use 78% opacity and 75% saturation to blend with the quiet rows; hovering restores
       their full color. The 29 countries in the snapshot are saved under `assets/flags/`, with
       the upstream MIT license and a source/hash manifest. Keep the flag inside the Location
       cell so it moves with the name when columns are reordered.
     - Hovering the flag shows the location ("Onalaska, Washington, United States"). For a
       non-center, the venue appears on the line above it.
     - Hovering the name shows the photo (`header_image_path`, 284×200) with the full name and
       its meaning. Clicking the name opens the center's website.
  2. **Dates**: "Nov 18 – 29" or "Nov 25 – Dec 6", with no year (the month heading has it). The
     end is at 40% opacity so the start stands out. Hovering shows the full dates with weekdays.
  3. **Type**:
     - Shows a centered, compact badge containing the chip code. The Type heading is centered too.
     - Basic courses (3D, 10D, 10D OS, EXEC) use slate text on a neutral background with a fine
       border. A crisp outline and readable text keep these from looking disabled.
     - Long courses (10D SPCL and 20/30/45/60D) use a subtle violet tint.
     - STP, 14D and TSC use a subtle teal tint, distinct from both basic and long courses.
       This grouping is visual; the actual course code remains visible in every badge.
     - Match the filter chips to these same groups. Selected chips use a solid fill so their
       selection remains clear. Do not tint entire rows: availability remains easy to scan.
     - Hovering the code shows the full name, with the languages on a second line.
  4. **Lights**: six 13px columns with a two-row heading: NEW / OLD / SRV, each over M F.
     Columns in a pair are 2px apart, groups 12px apart.
  5. **Apply**: a centered link styled as a quiet blue button, 24px high and at least 56px wide,
     with a fine border, 6px corners, and a very faint blue fill. Hover strengthens the border
     and fill; keyboard focus has a visible outline. It still opens the application form in
     another tab. Before registration opens it
     shows the opening date instead, as aligned month and day columns ("Mar  2", "Mar 21").
  6. **Links**: the schedule calendar icon, followed by the notes icon when comments exist.
     Notes are always last, beside the schedule icon, rather than beside the course type.
     The notes button toggles an inline panel under the row showing sanitized comments,
     languages, and the location's own course label when it says more than the standard type.
     Open panels survive filter changes and column reordering while their courses remain shown.
- **Desktop track widths:** Location takes the remaining width; Dates 120px, Type 84px,
  Lights 108px, Apply 84px, Links 48px, with 10px gaps. Column reordering also reorders these
  widths so headings and cells stay aligned.
- **Tooltips:** every hover uses one instant custom tooltip (`data-tip`), because native
  `title` tooltips lag or don't show.

### Lights

dhamma.org gives one status per applicant group, `{status, color, label, type}`. Keep its color
meanings, rendered as compact circular CSS lights:

| Color | Statuses |
|---|---|
| Green | Open, Filling Up |
| Yellow | Wait List, Short Wait List |
| Orange | Long Wait List |
| Red | Closed, Course Full, FULL |
| none | In Progress |

- Default lights are 8px across, with a subtle internal highlight and thin edge. The selected
  As position is 10px across; other positions become less opaque as described above.
- Green has the strongest outer ring, emphasizing available seats. Yellow and orange have
  softer rings. Red stays clearly red and fully opaque, with no outer ring; use `#d94a4a`
  in the light theme and `#e26060` in the dark theme. Avoid making closed seats pale pink.
- The official site's semaphore PNGs were downloaded from its stylesheet and are retained in
  `assets/status/` with their source and hashes. The current UI uses the round CSS lights.

Course badge colors (foreground / background):

| Group | Light | Dark |
|---|---|---|
| Basic | `#586171` / `#fff`, control border | `#b4bdca` / `#1b1f26`, control border |
| Long | `#7351a8` / `#f1ecf8` | `#c4a7ee` / `#2b2338` |
| STP / 14D / TSC | `#287b7a` / `#e8f4f2` | `#85cec8` / `#1c3334` |

How a status's `type` fills the columns:
- `m` fills NM and OM; `w` fills NF and OF; `s` fills SM and SF.
- `nm`, `nw`, `om`, `ow`, `ms` and `fs` each fill their own column.
- A status with no type covers all six columns.
- When entries overlap, the more specific one wins.
- NM and NF stay empty unless the course takes new students (10D, EXEC).
- Courses whose registration isn't open yet show no lights.

## Where box

This works like dhamma.org's own search box (select2 over `viewModel.search_regions`), built
with native HTML and JavaScript here.

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
- Every typed word must appear in a place's search texts or display text, ignoring accents.
- Ranking: exact matches first, then prefixes, word starts and substrings. Ties go to regions,
  then to bigger regions. Matched words are bold.
- Each suggestion shows a tag (continent / region / country / state / center / non-center /
  venue), and regions also show how many locations they contain.
- With nothing typed, the suggestions are the continents.
- Already-selected places are excluded from suggestions. Typing alone does not filter the
  courses; a place must be selected. A clear empty state appears when nothing matches.

**Using it:**
- Keyboard: the arrows move through suggestions, Enter picks one, Escape closes the list, and
  Backspace in an empty box removes the last chip.
- Each chip shows the place name, its full text on hover, and × to remove it.
- Clicking outside or tabbing away closes the suggestions. The input exposes combobox/listbox
  semantics and the active option, and result counts are announced to assistive technology.
- Store selected keys (`region_402,location_1542,…`) in the hidden `where` value and the URL
  fragment. Remove duplicate and unknown keys when restoring a link.
- Places combine with OR: courses in any selected place show. Region membership uses
  `LOCATION_REGIONS[loc.id]`; states compare both state and country; locations and venues use
  `loc.id` and `loc.subId` respectively. The data lives in `PLACES`, `LOCATION_REGIONS`, and the
  course objects in `mockup-data.js`.

## Responsive layout

- Above 820px, keep the compact full-width desktop grid, sticky filters, column headings and
  month headings. Do not apply the phone layout to wide screens.
- At 820px and below, the filter bar becomes a normal scrolling section. Its controls use a
  two-column grid; Where, Course and Also show span both columns, and chips wrap within the
  available space. The theme button stays in the top right beside the brand.
- Hide column headings in this layout. Each row shows Location first, then Dates / Type /
  Apply, then the labeled applicant lights and trailing icons. Month headings stick at the
  top of the viewport. Fixed named grid areas keep this arrangement independent of the saved
  desktop column order.
- At 380px and below, filters use one column and row icons move below the lights. Avoid
  horizontal scrolling at phone widths. Keep controls and suggestion panels within the viewport.
- Re-measure sticky offsets when the filter bar or list resizes, including when crossing the
  breakpoint, so month headings never cover the desktop column headings.

## Real implementation (next phase)

- **Server:** a small JavaScript server or serverless function serves the page and `/api/search`,
  which calls dhamma.org's
  `do_search` with plain HTTP only: no browser cookies, no imitating a browser (see
  CLAUDE.md). On 2026-11-13, a normal search POST with Origin `http://localhost:8000` returned
  JSON without `Access-Control-Allow-Origin`, so browser JavaScript at that origin cannot read
  it directly. The backend acts as a same-origin proxy.
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
- **Metadata:** fetch any needed place search texts, IDs and region nesting from the search
  page and `/en/locations/directory` using a JavaScript script. The old Go implementation has
  been removed; `web/tools/places.py` preserves the parsing approach used for the snapshot.
- **Assets:** photos are hotlinked from dhamma.org; the server could proxy them. Flags are local
  SVGs and render consistently across operating systems. Download any newly needed flags when
  expanding the snapshot or preparing live data.
- **Live UI:** add loading, error and partial-result states, cancel superseded requests, and
  replace the mockup's fixed date with today's date in live mode. A backend framework and
  hosting provider have not been chosen.

## Status: where to pick up

**Done** in `mockup.html`: the filters and Where picker, column dragging and keyboard reordering,
phone layout, centered color-coded course badges and sorted filter chips, trailing notes icon,
quiet Apply buttons, subdued square flags, As-focused availability lights, and both themes.

**Next:** build the JavaScript live-data backend and fetching states described above. The page
still uses sample data. `docs/plan.md` now describes the website and its next implementation phase.

**Mockup data:** `mockup-data.js` is a snapshot taken from dhamma.org on 2026-11-13. It's built
by `web/tools/mkdata.py` from saved pages: one `do_search` page per course type, plus the search
and directory pages. The mockup uses that date as "today".
