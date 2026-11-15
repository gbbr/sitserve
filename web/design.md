# sitserve: design

A single page for finding Vipassana courses on dhamma.org that you can still sign up for.
`web/index.html` and `web/app.js` are plain HTML, CSS and ES modules: no framework or page build
step. A Cloudflare Worker streams up to 50 matches after all filters. Flags are local assets;
location photos use the same-origin Worker proxy. Local development uses saved real responses
and a simulator, identified by a small amber dot on the wheel (“Simulated data”).

## Filter bar (sticky, top)

- **Layout**: two rows on desktop. The first holds dhamma.org's wheel (`assets/wheel/`, from its
  design standards, with its source and hashes), Where, From, As, Lang, Search,
  then the filter toggle and theme switch. The second holds the course chips, aligned with
  Where, then the Wait lists, Not open yet and Centers only checkboxes. Icons replace the
  Where, From, As and Lang labels. From's calendar icon opens the date picker (the browser's own
  picker icon is hidden), and its tooltip says courses start on or after the date.
- **Where**: places as chips; see [Where box](#where-box). Courses in any chosen place show.
- **From**: start date, default the viewer's current local calendar date. Preserve a date
  explicitly supplied in the URL fragment. No end date control: search courses starting from
  that date, earliest first.
- **Course**: toggle chips; any number can be on, and none on means all. The page covers only:

  | Chip | Full name | `raw_course_type` | Search ID |
  |---|---|---|---|
  | 10D | 10-day | `10-Day` | 3 |
  | 10D OS | 10-day for old students | `10-DayOSC` | 28 |
  | 10D SPCL | Special 10-day | `10-DaySpecial` | 6 |
  | 14D/TSC | 14-day gratitude / teacher's self course | `14-DayGratitude`, `TSC` | 66 / 21 (27 unused) |
  | 20D / 30D / 45D / 60D | 20/30/45/60-day | `20-DayOSC` … `60-DayOSC` | 4 / 11 / 12 / 23 |
  | EXEC | Executive course | `10-DayExecutive` | 1 |
  | STP | Satipaṭṭhāna Sutta course | `Satipatthana` | 10 |
  | 3D | 3-day | `3-DayOSC` | 9 |

  Codes for other types, if added later: 1D, 2D, 4H, 9D, GS, VGS, OSP, OSSC, OD, WP, Other,
  7D TEEN, CHLD, CHLD/TEEN, TEEN.
  Chips are grouped by their color, then by duration, in this order:
  - Neutral: 3D, 10D, 10D OS, EXEC.
  - Teal: STP, 14D/TSC.
  - Violet: 10D SPCL, 20D, 30D, 45D, 60D.
  No visual separators are needed between these groups.
  `14D/TSC` is one filter matching both upstream course types. Existing links with `types=14D`
  or `types=TSC` restore that combined chip. Rows retain their own 14D or TSC code and full name.
- **As**: anyone, or new / old / server × male / female. This narrows "can sign up" to that
  position and enlarges its lights from 8px to 10px. Column backgrounds and header labels
  stay neutral. Other
  positions' lights are dimmed to 28% opacity. Anyone restores all lights to their normal size
  and opacity. The legend remains unchanged.
- **Lang** (one instruction language): the control shows only its icon and chevron, plus the
  chosen ISO code (“en”, “ro”); the tooltip names the language. Its list shows names and
  stores upstream ISO codes; old links such as `lang=English` restore as `lang=en`.
- **Wait lists** and **Not open yet** (both on by default), and **Centers only**.
- **Theme switch**, top right: light/dark. The page follows the system until the switch is
  clicked, then remembers the choice in localStorage. Light uses a warm ivory background
  (`#f7f1e5`) and sepia text; dark uses deep brown (`#211c18`) and beige text. Controls,
  popovers, borders and hover surfaces follow the same warm palette. The primary accent is
  brown in light mode and golden beige in dark mode; availability retains its familiar colors.
- **Auto-collapse**: after a successful search finishes, collapse the filters to a compact
  bar with the selected places, start date, course types and other filter choices. Results
  appear first, followed by a 300ms pause and a 280ms slide. Contents fade over 240ms, remain
  mounted until the slide finishes, and fade in again when opened. Reduced-motion preferences
  skip the animation. **Edit filters** reopens the existing controls without changing results
  or selections; **Hide filters** closes them again. One filter icon button stays visible
  at the top right beside the theme switch, with the current action as its tooltip and
  accessible label. Clicking anywhere else on the collapsed bar, except the theme switch, also
  reopens the controls. Search appears only with the open controls. Pending edits made
  during a search, errors and cancellation leave the controls open. Reopening controls during
  a search also keeps them open when it finishes. Page load and shared links start expanded.
  The compact summary groups neutral place pills with a location icon, a bordered date chip,
  course badges using their existing category colors, and quieter applicant/language/option
  chips. A long summary scrolls horizontally. On phones the summary uses a second row.
- **Search**: submits all filters together. No automatic search on filter changes, place
  selection, page load or URL restoration. The compact button says **Search** in its resting
  states: solid brown with a search icon before the first submission; quiet outlined with a
  checkmark when the visible results match the filters; solid amber with a refresh icon when
  filters change. The amber background is distinct in both themes. Pending edits leave the
  submitted results in place and show "Filters changed. Press Search to update results." in
  yellow with a warning icon, in both themes. Restoring the submitted filters restores the
  completed state; the button remains clickable to run the search again. While loading it keeps
  its label, so the row doesn't shift, shows a spinning icon and is disabled. Status text
  (progress through the last searched date, pending, error and cancelled messages) and a Cancel
  link sit at the right of the results line, in place of “Checked …”. Cancel stops the stream.
  Edits during loading preserve the submitted results and show the pending warning.
  Column reordering and theme changes preserve the submitted filters too.
- Submitted filters live in the URL fragment, so a search can be bookmarked or shared.
  Opening a link restores the form; press Search to retrieve results.

## Course list

- **Which courses show:** only courses you can still sign up for. A course shows when a
  relevant position (any position, or the **As** one) is green, or yellow/orange while wait
  lists are on. Courses whose registration hasn't opened yet also show, because registration
  opens only 2–3 months ahead. In-progress, full and closed courses never show, and there's
  no "N hidden" count.
- **Before the first search:** below the filters, show only "Choose your filters and press
  Search to find up to 50 matching courses." Hide the summary, legend and footer until a
  search starts. The footer is centered when shown. Its second line shows today's (UTC) requests
  to dhamma.org from every search's final event: "Requests to dhamma.org today (UTC): 37 pages,
  5 photos" ("Simulated requests" in dev). It updates only when a search finishes.
- **Summary line:** "N courses you can sign up for", plus a legend: the blue non-center dot and
  the open / wait list / long wait list / closed lights.
- **Result limit:** collect up to 50 courses that pass every filter, fetching more upstream
  pages when needed and continuing past the target's 100-course query limit with a later start
  date. At 50 matches, suggest changing the filters to find others; there is no pagination or
  Load more. A search stopped early by its page cap is partial: mark it clearly ("Searched
  through Dec 3") and suggest a later From or narrower filters. Show when the results were
  checked ("Checked 12 min ago", in small faint text). The backend enforces the same page cap for cached and fresh
  pages; cursor and same-date stops are also reported as partial.
- **Grouping:** rows are grouped by start month. The column headings stick under the filter
  bar, and the year-first month headings ("2026 NOVEMBER 63") stick under the column headings.
  Keep full month names and align these group headings to the left edge of the table, rather
  than the Dates column. Rows sort by start date, then name. The table header uses a warm
  tinted band and bottom border spanning the full page width, square corners, compact uppercase
  labels and subtle column dividers. Result rows retain their constrained width.
  New / Old / SRV each has a fine grouping rule above its M / F labels. Month counts use a
  small muted pill. Sticky offsets follow the filter bar as it opens or collapses.
- **Rows:** compact, one 32px line each on wide screens.
- **Columns** (default order), rearrangeable by dragging their headings. A marker shows which
  side of a heading the column will land on. Focused headings also support Alt + Left/Right.
  The order is stored in localStorage as `sit.columns`; invalid saved orders fall back to the
  default. Both headings and rows use one column-to-HTML map and the same grid track order:
  1. **Location**:
     - Shows a rectangular flag, then the name without its "Dhamma " prefix. Courses away from a
       center (at a non-center or an outside venue) have a tiny faint blue dot; others have none.
       The legend explains the non-center marker.
     - Align the Location heading with the flag, at the left edge of the whole cell.
     - Flags are 16×12px local SVGs from the 4:3 set of `flag-icons` v7.3.2, with 2px corners and a fine edge.
       They use 78% opacity and 75% saturation to blend with the quiet rows; hovering restores
       their full color. The 30 supported countries, including Japan, are saved under `assets/flags/`, with
       the upstream MIT license and a source/hash manifest. Countries without a local asset use
       a text fallback. Keep the flag inside the Location
       cell so it moves with the name when columns are reordered.
     - Hovering the flag shows the location ("Onalaska, Washington, United States"). For a
       non-center, the venue appears on the line above it.
     - Resting on the name for 150 ms shows the photo (`header_image_path`, 284×200) with the
       full name and its meaning; the photo is requested only then, so passing over names costs
       nothing. Clicking the name opens the center's website.
  2. **Dates**: "Nov 18 – 29" or "Nov 25 – Dec 6", with no year (the month heading has it). The
     end is at 40% opacity so the start stands out. Hovering shows the full dates with weekdays.
  3. **Type**:
     - Shows a centered, compact badge containing the chip code. The Type heading is centered too.
     - Basic courses (3D, 10D, 10D OS, EXEC) use warm brown text on a neutral to sand background
       with a fine border. A crisp outline and readable text keep these from looking disabled.
     - Long courses (10D SPCL and 20/30/45/60D) use a subtle violet tint.
     - STP, 14D and TSC use a subtle teal tint, distinct from both basic and long courses.
       This grouping is visual; the actual course code remains visible in every badge.
     - Within a color group, badges differ by type. Ordered by length, the first half of a
       group's types are tints that deepen and the rest solid fills, deepening too: 3D, 10D tints
       and 10D OS, EXEC solid; STP, 14D tints and TSC solid; 10D SPCL, 20D, 30D tints and 45D,
       60D solid. Filter chips and summary tokens keep one color per group; selected chips use
       a solid fill so their selection remains clear. Do not tint entire rows: availability
       remains easy to scan.
     - Hovering the code shows the full name, with the languages on a second line.
  4. **Lights**: six 13px columns with a two-row heading: NEW / OLD / SRV, each over M F.
     Columns in a pair are 2px apart, groups 12px apart.
  5. **Apply**: a centered link styled as a quiet accent-colored button, 24px high and 64px wide,
     with a fine border, 6px corners, and a very faint accent fill. Hover strengthens the border
     and fill; keyboard focus has a visible outline. It still opens the application form in
     another tab. Before registration opens it shows the opening date inside a disabled
     button with the same fixed dimensions, a muted border and fill, and the day before the month
     ("2 Mar", "21 Mar"). Hovering shows the full registration opening date.
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

Filter chip and summary token colors (foreground / background); a selected chip fills with its
foreground color:

| Group | Light | Dark |
|---|---|---|
| Basic | `#74614e` / `#fcf7ed`, control border | `#cbb79c` / `#2b231d`, control border |
| Long | `#805d8b` / `#eee3ed` | `#ceb0d2` / `#392c38` |
| STP / 14D / TSC | `#426e60` / `#e5ece0` | `#a8c6ad` / `#26332a` |

Result badge ramps. Tints use the ink color as text; solid fills use the page background. Each
part runs from its first to its last color, mixed in OKLCH:

| Group | Theme | Tints | Ink | Solid fills |
|---|---|---|---|---|
| Basic | Light | `#faf6ef` → `#e9d6bd`, control border | `#5c412c` | `#846546` → `#523525` |
| Basic | Dark | `#2a241f` → `#46372a`, control border | `#dfcfb4` | `#ae8b63` → `#dcc8a6` |
| STP / 14D / TSC | Light | `#e6f7ed` → `#b1dfc5` | `#16513c` | `#35775d` → `#0b4834` |
| STP / 14D / TSC | Dark | `#1c2a22` → `#244534` | `#b0dec4` | `#579d79` → `#9dd3b5` |
| Long | Light | `#faedfa` → `#d9bae7` | `#562b71` | `#8050a0` → `#3e256e` |
| Long | Dark | `#2d2230` → `#4b355b` | `#e3c4f1` | `#9f76cb` → `#dab3ed` |

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
- Already-selected places are excluded from suggestions. Select a place, then submit Search
  to apply it to courses. A clear empty state appears when no suggestions match.

**Using it:**
- Keyboard: the arrows move through suggestions, Enter picks one, Escape closes the list, and
  Backspace in an empty box removes the last chip.
- Each chip shows the place name, its full text on hover, and × to remove it.
- Clicking outside or tabbing away closes the suggestions. The input exposes combobox/listbox
  semantics and the active option, and result counts are announced to assistive technology.
- Store selected keys (`region_402,location_1542,…`) in the hidden `where` value and, on Search,
  the URL fragment. Remove duplicate and unknown keys when restoring a link.
- Places combine with OR: courses in any selected place show. Region membership uses
  `LOCATION_REGIONS[loc.id]`; states compare both state and country; locations and venues use
  `loc.id` and `loc.subId` respectively. The data lives in `PLACES`, `LOCATION_REGIONS`, and the
  shared metadata in `places.js` and the normalized course objects.

## Responsive layout

- Above 820px, keep the compact full-width desktop grid, sticky filters, column headings and
  month headings. Do not apply the phone layout to wide screens.
- At 820px and below, the filter bar becomes a normal scrolling section. Where shares the
  first line with the wheel and the two buttons; From, As and Lang share the next line when
  they fit. Chips and checkboxes wrap within the available space, and a full-width Search ends
  the controls.
- Hide column headings in this layout. Each row shows Location first, then Dates / Type /
  Apply, then the labeled applicant lights and trailing icons. Month headings stick at the
  top of the viewport. Fixed named grid areas keep this arrangement independent of the saved
  desktop column order.
- At 380px and below, row icons move below the lights. Avoid
  horizontal scrolling at phone widths. Keep controls and suggestion panels within the viewport.
- Re-measure sticky offsets when the filter bar or list resizes, including when crossing the
  breakpoint. Preserve fractional pixel heights and overlap adjacent sticky layers by 1px so
  rows cannot peek through a rounding gap between the filters, column headings and month headings.

## Backend and live UI

- `worker/index.js` serves `/api/search` as NDJSON through one SQLite-backed Durable Object.
  `start` identifies the mode, each `progress` adds rows and a searched-through date, and `done`
  carries a reason, partial flag and oldest `checkedAt`. `error` includes a message and optional
  retry delay. See [docs/plan.md](../docs/plan.md) for the full stream contract and limits.
- Filtering, type IDs, status specificity, applicant columns, defaults and fragment/query parsing
  live in DOM-free `shared/courses.js`, imported by the page and Worker. Place and language
  metadata lives in `places.js`; `tools/build-places.js` regenerates it from saved HTML only.
- Pages are normalized, comments are sanitized on the server and again in the browser, and
  photos use `/photo/...`. The shared persisted cache lasts 24 hours; photos last seven days.
  No visitor's search response is cached by HTTP.
- The upstream request uses `OldStudents`, in-scope type IDs, place keys, an ISO language and
  a date range ending Dec 31 of the current UTC year plus two. NM/NF restricts requests to
  10D/EXEC, with zero requests when Course excludes both. As and availability are checked
  before a result counts; upstream attendee/gender filters cannot replace them.
- Rows arrive after every page. A search stops at 50 matches, end of pages, a cursor stop, or
  the 20-page cap. Partial results show “Searched through Dec 3” and suggest a later From or
  narrower filters. At 50, show “Showing the first 50 matches; change the filters to find others”.
- Show “Checked 12 min ago” from the oldest page. Empty, error, allowance, paused and visitor
  limit states are explicit; retry requires Search. Cancel, navigation and newer searches stop
  abandoned work. Edits during a search remain separate from its submitted filters and URL.
- `npm run dev` runs the simulator with persistence in `.wrangler/state`. `npm run dev:live`
  explicitly selects live upstream requests and requires a contact setting. Tests never contact
  dhamma.org. `worker/fixtures/dhamma/manifest.json` describes the recorded input and oracle.

## Status

The served page, streamed backend, simulator, persisted gate, local development commands and
unit/Worker/browser regression suites are implemented. Deployment, access restriction, metadata
refresh cadence and request-limit tuning remain. Browser execution depends on a local Chrome
or Playwright Chromium that can launch in the environment.
