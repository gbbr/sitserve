# sitserve design

A single page for finding Vipassana courses on dhamma.org that you can still sign up for.
`web/index.html` and `web/app.js` are plain HTML, CSS and ES modules, with no framework or build
step. This file records what the UI does and why; exact colors, sizes and timings live in the CSS
in `web/index.html`. The backend is described in [architecture.md](architecture.md).

## Filter bar

- **Layout**: on desktop, sticky at the top in two rows. The first holds dhamma.org's wheel
  (`assets/wheel/`, from its design standards), Where, From, As, Lang and Search, then the filter
  toggle and theme switch. The second holds the course chips, aligned with Where, then the Wait
  lists, Not open yet and Centers only checkboxes. Icons replace the Where, From, As and Lang
  labels. In development, a small amber dot on the wheel marks simulated data.
- **Where**: places as chips; see [Where box](#where-box).
- **From**: start date, defaulting to the viewer's local date unless the link supplies one. There
  is no end date: courses starting on or after From are searched, earliest first. The calendar
  icon opens the date picker (the browser's own icon is hidden).
- **Course**: toggle chips; any number can be on, and none means all. The page covers only these
  types, with chips in this order, grouped by color without separators:

  | Chip | Full name | `raw_course_type` | Search ID | Color |
  |---|---|---|---|---|
  | 3D | 3-day | `3-DayOSC` | 9 | neutral |
  | 10D | 10-day | `10-Day` | 3 | neutral |
  | 10D OS | 10-day for old students | `10-DayOSC` | 28 | neutral |
  | EXEC | Executive course | `10-DayExecutive` | 1 | neutral |
  | STP | Satipaṭṭhāna Sutta course | `Satipatthana` | 10 | teal |
  | 14D/TSC | 14-day gratitude / teacher's self course | `14-DayGratitude`, `TSC` | 66, 21 | teal |
  | 10D SPCL | Special 10-day | `10-DaySpecial` | 6 | violet |
  | 20D / 30D / 45D / 60D | 20/30/45/60-day | `20-DayOSC` … `60-DayOSC` | 4 / 11 / 12 / 23 | violet |

  `14D/TSC` matches both upstream types, and links with `types=14D` or `types=TSC` restore it.
  Result badges use shorter codes: 3, 10, 10OS, 10S, 10E (Executive), 14, 20, 30, 45 and 60,
  with STP and TSC unchanged. Rows keep their own 14 or TSC code and full name.
- **As**: anyone, or new / old / server × male / female. Choosing a position narrows "can sign up"
  to it, enlarges its lights and dims the others; column backgrounds, headings and the legend
  don't change. The control shows the position's short code (NM, NF, OM, OF, DWM and DWF for
  Dhamma workers, or "Anyone"); its list and tooltip use full names.
- **Lang** (one instruction language): the control shows its icon, a chevron and the chosen ISO
  code ("en"); the tooltip names the language. The list shows names and stores the upstream ISO
  codes; links such as `lang=English` restore as `lang=en`.
- **Wait lists** and **Not open yet** are on by default; **Centers only** is off.
- **Theme switch**: light or dark. The page follows the system until the switch is used, then
  remembers the choice in localStorage. Light is warm ivory with sepia text and dark is deep brown
  with beige text; controls, popovers, borders and hover surfaces share that warm palette. The
  accent is brown in light mode and golden beige in dark mode; availability keeps its familiar
  colors.
- **Search** submits all filters together. The last submitted filters are saved in this browser
  and searched automatically on return, using the normal cache and fetch behavior. Filter edits
  and place selection wait for Search. A first visit or a different shared link also waits for
  Search. The button always says Search, so the row doesn't
  shift: solid brown with a search icon before the first search, quiet and outlined with a
  checkmark when the results match the filters (it still runs the search again), solid amber with
  a refresh icon after the filters change, and disabled with a spinner while loading. Edits leave
  the submitted results in place and show "Filters changed. Press Search to update results." in
  yellow with a warning icon; restoring the submitted filters restores the completed state.
- **Status**: text for progress through the last searched date, pending edits, errors and
  cancellation sits under Search, at the right end of the second row (below Search on phones),
  only while there's something to say, with a Cancel link while loading. Empty, error, allowance,
  paused and visitor-limit states are explicit, and retrying always takes Search.
- **URL**: submitted filters live in the URL fragment, so a search can be bookmarked or shared.
  A link matching the saved search reruns it automatically; a different link restores the form
  and waits for Search. Edits during a search, column reordering and theme changes leave the
  submitted filters, saved search and URL alone. The saved search includes its explicit From
  date, even when that date was omitted from the URL.
- **Auto-collapse**: after a successful search, the filters collapse to a compact summary. Results
  appear first; after a short pause the bar slides shut while its contents fade, and they fade
  back in when it reopens (no animation with reduced motion). One filter button beside the theme
  switch toggles the controls, with **Edit filters** or **Hide filters** as its tooltip and
  accessible label; clicking anywhere else on the collapsed bar, except the theme switch, also
  reopens it. Neither changes results or selections. Search shows only while the controls are
  open. Errors, cancellation, edits during a search and reopening during a search keep the
  controls open. Page load and shared links start expanded.
- **Summary**: place pills with a location icon, a bordered date chip, course badges in their
  group colors, then quieter applicant, language and option chips. A long summary scrolls
  sideways; on phones it wraps after the wheel, using the space under the buttons from its second
  line.

## Course list

- **Which courses show**: only courses you can still sign up for, where a relevant position (any,
  or the **As** one) is green, or yellow/orange while Wait lists is on. Courses whose registration
  hasn't opened yet show while Not open yet is on, since registration opens only 2–3 months
  ahead. In-progress, full, closed and cancelled courses never show, and there's no "N hidden"
  count.
- **Before the first search**: only "Choose your filters and press Search to find up to 50
  matching courses." shows below the filters, and the footer stays hidden.
- **Results**: rows appear as each page arrives. There's no summary line: column headings follow
  the filter bar directly, year headings carry the counts, and a hidden status announces "N
  courses you can sign up for" to screen readers.
- **Result limit**: up to 50 courses that pass every filter, with no pagination or Load more.
  A centered note after the last row explains where results stop: "Showing the first 50 matches;
  change the filters to find others.", "Searched through Dec 3" with a suggestion to try a later
  From or narrower filters when a search is partial, or "Search cancelled. Results may be
  incomplete."
- **Footer**, centered: a legend (the blue non-center dot and the open / wait list / long wait
  list / closed lights), the dhamma.org credit, then "Checked 12 min ago · Requests to dhamma.org
  today (UTC): 37 pages, 5 photos" ("Simulated requests" in development). "Checked" uses the
  oldest page; the request counts update when a search finishes.
- **Grouping and order**: rows are grouped by start year under headings ("2026 63") aligned with
  the table's left edge. Within a year, rows sort by start date, then name; clicking the Type
  heading sorts by course type in chip order (14D and TSC together), then date and name, and
  Dates restores date order. The active heading is darker with a small
  chevron; the other shows a faint chevron on hover. The choice is stored in localStorage as
  `sit.sort`, and phones, which show only the lights' key, use it too.
- **Headings**: column headings stick under the filter bar and year headings under them,
  following the bar as it opens or collapses. Both heading bands span the full page width while
  rows keep their constrained width; year headings are a dimmer shade of the column headings'
  band, with their labels vertically centered. Each year is its own section, so an arriving
  year heading pushes the stuck one away. NEW / OLD / SRV each have a fine rule above their
  M / F labels, and year counts sit in a small muted pill.
- **Rows**: one compact line each on wide screens.
- **Columns**, in default order, can be rearranged by dragging their headings (a marker shows
  which side the column will land on) or with Alt + Left/Right on a focused heading. The order is
  stored in localStorage as `sit.columns`; an invalid saved order falls back to the default.
  Headings and rows share one column-to-HTML map and grid track order, so widths move with their
  columns. Location takes the remaining width; the others are fixed.
  1. **Location**: a rectangular flag, then the name without its "Dhamma " prefix. Courses away
     from a center (at a non-center or an outside venue) have a tiny faint blue dot. The heading
     aligns with the flag at the cell's left edge, and the flag stays inside the cell so it moves
     with the name.
     - Flags are local 4:3 SVGs from `flag-icons` in `assets/flags/`, with its MIT license and a
       source manifest. They're slightly faded to suit the quiet rows; hovering restores full
       color. Countries without a saved flag show their ISO code.
     - Hovering the flag shows the place ("Onalaska, Washington, United States"), with the venue
       on the line above when the course has one.
     - Resting on the name for 150 ms shows the location's photo with its full name and meaning.
       The photo is requested only then, so passing over names costs no upstream requests.
       Clicking the name opens the location's website.
  2. **Dates**: "Nov 18 – 29" or "Nov 25 – Dec 6", without the year (the year heading has it).
     The start's months and days line up down the list. The end is faded so the start stands
     out; hovering shows full dates with weekdays.
  3. **Type**: a compact badge with a short code, centered under the heading; see
     [Type badges](#type-badges). The column is as wide as the widest badge plus the notes icon.
     Hovering shows the full name and, on a second line, the
     languages. The notes icon follows the badge when comments exist; it toggles an inline
     panel under the row with the comments (sanitized by the Worker and again in the browser),
     languages, and the location's own course label when it says more than the standard type.
     Open panels survive filter changes and column reordering while their courses remain shown.
  4. **Lights**: six columns under a two-row heading, NEW / OLD / SRV over M F, with each pair
     closer together than the groups; see [Lights](#lights).
  5. **Schedule**: a quiet, accent-colored, button-style Apply link to the location's course
     schedule on dhamma.org, in another tab; hover strengthens it and keyboard focus shows an
     outline. Before registration opens, the same link shows the opening date instead, day
     first ("2 Mar"), in a muted style, with the full date on hover.
- **Tooltips**: every hover uses one instant custom tooltip (`data-tip`), because native `title`
  tooltips lag or don't show. Tooltips, the location photo and hover styles follow a mouse only,
  since touch browsers report a tap as a hover. On touch, tapping a row's flag, dates, type
  badge, light or non-center dot toggles its tooltip, and any other tap closes it; links and
  buttons show none, and names show no photo.

### Type badges

Badges, filter chips and summary tokens share three color groups, set as custom properties in
`web/index.html` (classes `regular`, `special` and `long`):

- **Neutral** (3D, 10D, 10D OS, EXEC): warm brown on neutral to sand, with a fine border and a
  crisp outline so they don't look disabled.
- **Teal** (STP, 14D, TSC): distinct from both other groups.
- **Violet** (10D SPCL, 20D, 30D, 45D, 60D): the long courses.

Within a group each badge has its own shade, deepening in chip order: the first half are tints
with the group's ink as text, the rest solid fills with the page background as text. That gives
3D and 10D tints, 10D OS and EXEC solid; STP and 14D tints, TSC solid; 10D SPCL, 20D and 30D
tints, 45D and 60D solid. Filter chips and summary tokens use one color per group, and a selected
chip fills with its foreground color. Rows are never tinted, so availability stays easy to scan.

### Lights

dhamma.org gives one status per applicant group, `{status, color, label, type}`. sitserve keeps
its color meanings as small round CSS lights with a subtle highlight and thin edge:

| Color | Statuses |
|---|---|
| Green | Open, Filling Up |
| Yellow | Wait List, Short Wait List |
| Orange | Long Wait List |
| Red | Closed, Course Full, FULL |
| none | In Progress |

Green has the strongest ring, emphasizing available seats; yellow and orange have softer rings.
Red stays clearly red and fully opaque, with no ring, never pale pink.

How a status's `type` fills the columns:

- `m` fills NM and OM; `w` fills NF and OF; `s` fills SM and SF.
- `nm`, `nw`, `om`, `ow`, `ms` and `fs` each fill their own column.
- A status with no type covers all six columns.
- When entries overlap, the more specific one wins.
- NM and NF stay empty unless the course takes new students (10D, EXEC).
- Courses whose registration isn't open yet show no lights.

## Where box

A native HTML and JavaScript version of dhamma.org's own search box (select2 over
`viewModel.search_regions`). Its places, in `web/places.js`, are regions (World, continents,
sub-regions, countries and Indian states), states and provinces, locations and venues; see
[dhamma-api.md](dhamma-api.md#place-ids). Each has a display text and search texts: name, state,
city, short name, subdomain and codes such as "WA" or "IN".

- Typing suggests places grouped as Regions / States and provinces / Centers and non-centers /
  Venues, up to 8 per group plus an "N more" hint. With nothing typed, it suggests the continents.
- Every typed word must appear in a place's texts, ignoring accents. Exact matches rank first,
  then prefixes, word starts and substrings; ties go to regions, then bigger regions. Matched
  words are bold.
- Each suggestion shows a tag (continent / region / country / state / center / non-center /
  venue); regions also show how many locations they contain.
- Chosen places are left out of the suggestions, and a clear empty state appears when nothing
  matches. A search takes up to 10 places; with 10 chosen, the list says "Up to 10 places. Remove
  one to add another."
- Arrow keys move through suggestions, Enter picks one, Escape closes the list, and Backspace in an
  empty box removes the last chip. Clicking outside or tabbing away closes the list. The input has
  combobox/listbox semantics with the active option, and result counts are announced.
- Each chip shows the place name, its full text on hover, and × to remove it.
- Chosen keys (`region_402,location_1542,…`) go in the hidden `where` value and, on Search, the
  URL fragment. Restoring a link drops duplicate and unknown keys, then keeps the first 10.
- Places combine with OR: a course matches a region it belongs to (`LOCATION_REGIONS`), a state
  with the same state and country, or its own location or venue.

## Responsive layout

- Above 820px: the full-width desktop grid with sticky filters, column headings and year
  headings. The phone layout never applies to wide screens.
- At 820px and below, the filter bar scrolls with the page. Where shares the first line with the
  wheel and the two buttons; From, As and Lang share the next when they fit. Chips and checkboxes
  wrap, and a full-width Search ends the controls.
- Phones keep only the lights column heading (NEW / OLD / SRV over M F), at the right of a band
  in the column headings' color that sticks at the top of the viewport. The current year's label
  sits at its left, so the year and the key share one band. Further down, year headings keep
  their dimmer band; as one arrives, its band slides under the sticky one and its label pushes
  the previous year's out. Rows run edge to edge with small insets, in two lines: the flag and name,
  with the lights at the right edge; then the dates, type, notes icon and Apply. The
  lights sit in six fixed, unlabeled slots under the key. A position a course doesn't offer leaves
  its slot empty, so each position lines up down the list. Flex order keeps this arrangement independent of the
  saved desktop column order.
- No horizontal scrolling at phone widths; controls and suggestion panels stay within the
  viewport.
- Sticky offsets are re-measured whenever the filter bar or list resizes, including across the
  breakpoint. They keep fractional pixel heights, and adjacent sticky layers overlap by 1px so
  rows can't peek through a rounding gap between the filters, column headings and year headings.

## Installed app

- **Install**: browsers offer to install sitserve to the home screen or desktop, where it opens
  in its own window and reruns the last submitted search.
- **Icon**: the header's gold dhamma wheel on a dark tile, with "OS" in large ivory letters over
  it. Favicons round the tile's corners.
- **Theme color**: the browser's and installed app's bars take the page background, following
  the theme switch.
- **Offline**: the page still opens with its filters. A search that can't connect says "You're
  offline." or, when the browser believes it's online, "Couldn't connect to sitserve.", followed
  by "Press Search to retry."
