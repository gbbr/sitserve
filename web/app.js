import { LANGUAGES } from './places.js';
import { COLUMNS, GROUPS, KEYS, COLUMN_NAME, LIGHTS, TYPE, FILTER_TYPES,
  typeClass, typeTip, filterTypeTip, fold, places, placeByKey, lights, availability,
  filterDefaults, parseFilters, serializeFilters } from './shared/courses.js';

'use strict';

// Use the viewer's local calendar date; a UTC conversion can shift it by a day.
const now = new Date();
const TODAY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTHS.map(m => m.slice(0, 3));

const svg = paths => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  search: svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
  check: svg('<path d="m5 12 4 4L19 6"/>'),
  refresh: svg('<path d="M20 7v5h-5M19.5 12a7.5 7.5 0 1 0-2 5.5M20 12l-3-4"/>'),
  warning: svg('<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5M12 17h.01"/>'),
  web: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>'),
  schedule: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  notes: svg('<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14 3.5V8h5M9 12.5h7M9 16h5"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>'),
};

const $ = sel => document.querySelector(sel);
const form = $('#filters'), list = $('#list'), summary = $('#summary'), photo = $('#photo');
const byId = new Map();

const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const inertHTML = html => { const el = document.createElement('template'); el.innerHTML = html; return el.content; };
const textOf = html => inertHTML(html).textContent.replace(/\s+/g, ' ').trim();
const FLAG_CODES = new Set(["ae","ar","au","be","br","ca","co","de","es","fr","gb","gr","id","il","in","it","kr","lk","mm","nl","np","pe","pl","ru","se","th","tw","us","vn"]);
const flag = cc => FLAG_CODES.has((cc || '').toLowerCase()) ? `<img src="assets/flags/${cc.toLowerCase()}.svg" alt="">` : esc(/^[a-z]{2}$/i.test(cc || '') ? cc.toUpperCase() : '?');

// The Where control stores stable place keys; typing only searches suggestions.
const placeInput = $('#place-search'), placeOptions = $('#place-options');
const PLACE_GROUPS = [
  ['region', 'Regions'], ['state', 'States and provinces'],
  ['location', 'Centers and non-centers'], ['sublocation', 'Venues'],
];
let suggestions = [], activePlace = -1;

function chosenPlaces() {
  return [...new Set(form.elements.where.value.split(','))].map(k => placeByKey.get(k)).filter(Boolean);
}

// Every word must match. Prefer an exact phrase, prefix, word starts, then substrings.
function placeRank(p, query, words) {
  if (!words.every(w => p.search.some(t => t.includes(w)))) return Infinity;
  if (p.search.includes(query)) return 0;
  if (p.search.some(t => t.startsWith(query))) return 1;
  if (words.every(w => p.search.some(t => t.split(/[^\p{L}\p{N}]+/u).some(s => s.startsWith(w))))) return 2;
  return 3;
}

// Fold each original character separately to retain its position when highlighting accents.
function highlightPlace(text, words) {
  if (!words.length) return esc(text);
  let folded = '', positions = [];
  for (let i = 0; i < text.length;) {
    const ch = String.fromCodePoint(text.codePointAt(i)), normalized = fold(ch);
    for (const ignored of normalized) positions.push([i, i + ch.length]);
    folded += normalized;
    i += ch.length;
  }
  const marked = new Set();
  for (const word of words) {
    let start = folded.indexOf(word);
    while (start !== -1) {
      for (let j = start; j < start + word.length; j++) {
        if (positions[j]) for (let k = positions[j][0]; k < positions[j][1]; k++) marked.add(k);
      }
      start = folded.indexOf(word, start + 1);
    }
  }
  let html = '', bold = false;
  for (let i = 0; i < text.length; i++) {
    const next = marked.has(i);
    if (next !== bold) html += next ? '<b>' : '</b>';
    bold = next;
    html += esc(text[i]);
  }
  return html + (bold ? '</b>' : '');
}

function renderPlaceChips() {
  const chosen = chosenPlaces();
  form.elements.where.value = chosen.map(p => p.key).join(',');
  $('#place-chips').innerHTML = chosen.map(p => `<span class="place-chip" data-tip="${esc(p.text)}"><span>${esc(p.kind === 'region' ? p.text : p.texts[0])}</span><button type="button" class="place-remove" data-remove-place="${p.key}" aria-label="${esc(`Remove ${p.text}`)}">×</button></span>`).join('');
  placeInput.placeholder = chosen.length ? 'add a place' : 'country, state or center';
}

function activatePlace(index, scroll = false) {
  activePlace = index;
  for (const option of placeOptions.querySelectorAll('[role=option]')) {
    option.setAttribute('aria-selected', String(+option.dataset.index === index));
  }
  const option = placeOptions.querySelector(`[data-index="${index}"]`);
  if (option) {
    placeInput.setAttribute('aria-activedescendant', option.id);
    if (scroll) option.scrollIntoView({ block: 'nearest' });
  } else placeInput.removeAttribute('aria-activedescendant');
}

function showPlaces() {
  const query = fold(placeInput.value.trim()), words = query.split(/\s+/).filter(Boolean);
  const chosen = new Set(chosenPlaces().map(p => p.key));
  const ranked = places.filter(p => !chosen.has(p.key) && (words.length || p.tag === 'continent'))
    .map(p => ({ p, rank: words.length ? placeRank(p, query, words) : 0 }))
    .filter(item => Number.isFinite(item.rank))
    .sort((a, b) => a.rank - b.rank || (a.p.kind === 'region' ? 0 : 1) - (b.p.kind === 'region' ? 0 : 1)
      || (a.p.kind === 'region' && b.p.kind === 'region' ? b.p.count - a.p.count : 0) || a.p.text.localeCompare(b.p.text));
  suggestions = [];
  placeOptions.innerHTML = PLACE_GROUPS.map(([kind, label]) => {
    const group = ranked.filter(item => item.p.kind === kind);
    if (!group.length) return '';
    const options = group.slice(0, 8).map(({ p }) => {
      const index = suggestions.push(p) - 1;
      return `<div class="place-option" id="place-option-${p.key}" role="option" aria-selected="false" data-index="${index}"><span>${highlightPlace(p.text, words)}</span><span class="place-tag">${esc(p.tag)}${p.kind === 'region' ? `<br>${p.count} location${p.count === 1 ? '' : 's'}` : ''}</span></div>`;
    }).join('');
    return `<div role="group" aria-label="${label}"><div class="place-group" aria-hidden="true">${label}</div>${options}${group.length > 8 ? `<div class="place-more">${group.length - 8} more — keep typing</div>` : ''}</div>`;
  }).join('') || '<div class="place-empty">No matching places.</div>';
  placeOptions.hidden = false;
  placeInput.setAttribute('aria-expanded', 'true');
  activatePlace(suggestions.length ? 0 : -1);
  const r = $('#where-box').getBoundingClientRect();
  placeOptions.style.left = Math.min(0, innerWidth - r.left - placeOptions.offsetWidth - 16) + 'px';
  $('#place-status').textContent = `${ranked.length} place${ranked.length === 1 ? '' : 's'} found${ranked.length > suggestions.length ? `, ${suggestions.length} shown. Keep typing to narrow the list` : ''}.`;
}

function closePlaces() {
  placeOptions.hidden = true;
  placeInput.setAttribute('aria-expanded', 'false');
  placeInput.removeAttribute('aria-activedescendant');
  activePlace = -1;
}

function changePlaces(keys) {
  form.elements.where.value = keys.join(',');
  renderPlaceChips();
  updateSearchStatus();
}

function pickPlace(p) {
  if (!p) return;
  changePlaces([...chosenPlaces().map(p => p.key), p.key]);
  placeInput.value = '';
  placeInput.focus();
  closePlaces();
  $('#place-status').textContent = `${p.text} added.`;
}

placeInput.addEventListener('focus', showPlaces);
placeInput.addEventListener('input', e => { e.stopPropagation(); showPlaces(); });
placeInput.addEventListener('keydown', e => {
  if (e.isComposing) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (placeOptions.hidden) { showPlaces(); return; }
    if (suggestions.length) activatePlace((activePlace + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length, true);
  } else if (e.key === 'Enter') {
    if (!placeOptions.hidden) {
      e.preventDefault();
      pickPlace(suggestions[activePlace]);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closePlaces();
  } else if (e.key === 'Backspace' && !placeInput.value && chosenPlaces().length) {
    e.preventDefault();
    const chosen = chosenPlaces(), removed = chosen.pop();
    changePlaces(chosen.map(p => p.key));
    showPlaces();
    $('#place-status').textContent = `${removed.text} removed.`;
  }
});
placeOptions.addEventListener('pointerdown', e => { if (e.target.closest('[role=option]')) e.preventDefault(); });
placeOptions.addEventListener('click', e => {
  const option = e.target.closest('[role=option]');
  if (option) pickPlace(suggestions[+option.dataset.index]);
});
placeOptions.addEventListener('mousemove', e => {
  const option = e.target.closest('[role=option]');
  if (option && +option.dataset.index !== activePlace) activatePlace(+option.dataset.index);
});
$('#place-chips').addEventListener('click', e => {
  const button = e.target.closest('[data-remove-place]');
  if (!button) return;
  changePlaces(chosenPlaces().filter(p => p.key !== button.dataset.removePlace).map(p => p.key));
  placeInput.focus();
  closePlaces();
});
$('#where-box').addEventListener('focusout', e => { if (!e.currentTarget.contains(e.relatedTarget)) closePlaces(); });
document.addEventListener('pointerdown', e => { if (!e.target.closest('#where-box')) closePlaces(); });

// Desktop headings and rows use the same order and track widths. Phone rows use named areas.
const DISPLAY_COLUMNS = {
  location: { label: 'Location', width: 'minmax(0, 1fr)' },
  dates: { label: 'Dates', width: '120px' },
  type: { label: 'Type', width: '84px' },
  lights: { label: 'Availability', width: '108px' },
  apply: { label: 'Apply', width: '84px' },
  links: { label: 'Links', width: '48px' },
};
let columnOrder = Object.keys(DISPLAY_COLUMNS);
try {
  const saved = JSON.parse(localStorage.getItem('sit.columns'));
  if (Array.isArray(saved) && saved.length === columnOrder.length && new Set(saved).size === columnOrder.length && saved.every(k => Object.hasOwn(DISPLAY_COLUMNS, k))) columnOrder = saved;
} catch { /* blocked storage or an invalid saved order: use the default */ }

function saveColumnOrder(next, moved) {
  columnOrder = next;
  try { localStorage.setItem('sit.columns', JSON.stringify(next)); } catch { /* lasts until reload */ }
  render();
  list.querySelector(`.column-head[data-column="${moved}"]`)?.focus({ preventScroll: true });
  $('#column-status').textContent = `${DISPLAY_COLUMNS[moved].label} moved to column ${next.indexOf(moved) + 1} of ${next.length}.`;
}

let draggedColumn = null;
function clearDrag() {
  for (const el of list.querySelectorAll('.column-head')) { delete el.dataset.drop; el.classList.remove('dragging'); }
}
list.addEventListener('dragstart', e => {
  const heading = e.target.closest('.column-head');
  if (!heading) return;
  draggedColumn = heading.dataset.column;
  e.dataTransfer.setData('text/plain', draggedColumn);
  e.dataTransfer.effectAllowed = 'move';
  heading.classList.add('dragging');
  hideTip();
});
list.addEventListener('dragover', e => {
  const heading = e.target.closest('.column-head');
  if (!heading || !draggedColumn) return;
  e.preventDefault();
  for (const el of list.querySelectorAll('[data-drop]')) delete el.dataset.drop;
  if (heading.dataset.column === draggedColumn) return;
  const r = heading.getBoundingClientRect();
  heading.dataset.drop = e.clientX < r.left + r.width / 2 ? 'before' : 'after';
  e.dataTransfer.dropEffect = 'move';
});
list.addEventListener('dragleave', e => {
  const heading = e.target.closest('.column-head');
  if (heading && !heading.contains(e.relatedTarget)) delete heading.dataset.drop;
});
list.addEventListener('drop', e => {
  const heading = e.target.closest('.column-head');
  if (!heading || !draggedColumn) return;
  e.preventDefault();
  const moved = draggedColumn, side = heading.dataset.drop, target = heading.dataset.column;
  clearDrag();
  draggedColumn = null;
  if (moved === target || !side) return;
  const next = columnOrder.filter(k => k !== moved);
  next.splice(next.indexOf(target) + (side === 'after' ? 1 : 0), 0, moved);
  saveColumnOrder(next, moved);
});
list.addEventListener('dragend', () => { clearDrag(); draggedColumn = null; });
list.addEventListener('keydown', e => {
  const heading = e.target.closest('.column-head');
  if (!heading || !e.altKey || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  e.preventDefault();
  const key = heading.dataset.column, index = columnOrder.indexOf(key);
  const destination = index + (e.key === 'ArrowLeft' ? -1 : 1);
  if (destination < 0 || destination >= columnOrder.length) return;
  const next = [...columnOrder];
  [next[index], next[destination]] = [next[destination], next[index]];
  saveColumnOrder(next, key);
});

const ymd = s => s.split('-').map(Number);
// dateRange leaves out the year, which the month headings show: "Nov 18 – 29", "Nov 25 – Dec 6".
// The end is faded so the start date stands out.
function dateRange(a, b) {
  const [, am, ad] = ymd(a), [, bm, bd] = ymd(b);
  const start = `${MON[am - 1]} ${ad}`;
  if (a === b) return start;
  return `${start}<span class="end"> – ${am === bm ? bd : `${MON[bm - 1]} ${bd}`}</span>`;
}
function longDate(s) {
  const [y, m, d] = ymd(s);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// Draft filters stay in the form; only submitted filters go in the shareable URL.
const DEFAULTS = filterDefaults(TODAY);
// The course types are a set of checkboxes, kept as a comma-separated list of short names.
function readFilters() {
  const f = {};
  for (const [k, d] of Object.entries(DEFAULTS)) {
    f[k] = k === 'types' ? [...form.querySelectorAll('[name=types]:checked')].map(i => i.value).join(',')
      : typeof d === 'boolean' ? form.elements[k].checked : form.elements[k].value;
  }
  return f;
}
function setFilters(f) {
  const types = new Set(f.types.split(',').map(code => ['14D', 'TSC'].includes(code) ? '14D/TSC' : code));
  for (const i of form.querySelectorAll('[name=types]')) i.checked = types.has(i.value);
  for (const [k, d] of Object.entries(DEFAULTS)) {
    if (k === 'types') continue;
    if (typeof d === 'boolean') form.elements[k].checked = f[k];
    else form.elements[k].value = f[k];
  }
  renderPlaceChips();
  placeInput.value = '';
  closePlaces();
}
const toFragment = f => serializeFilters(f, { today: TODAY });
const fromFragment = () => parseFilters(location.hash, { today: TODAY });

const link = (href, label, icon) => href ? `<a class="icon" href="${esc(href)}" target="_blank" rel="noopener" data-tip="${label}" aria-label="${label}">${icon}</a>` : '<span></span>';

function rowHTML(c, avail, f) {
  const l = c.loc;
  const statuses = avail === 'soon' ? {} : lights(c);
  const reg = avail === 'soon'
    ? `<button type="button" class="opens" disabled aria-label="Registration opens ${esc(longDate(c.enroll))}">${ymd(c.enroll)[2]} ${MON[ymd(c.enroll)[1] - 1]}</button>`
    : `<a href="${esc(c.apply)}" target="_blank" rel="noopener" aria-label="${esc(`Apply for ${TYPE.get(c.type).name} at ${l.name}, ${longDate(c.start)}`)}">Apply</a>`;
  const cell = k => {
    const s = statuses[k], hl = k === f.as ? ' hl' : '';
    return s
      ? `<span class="l${hl}" data-k="${k}" data-tip="${esc(`${COLUMN_NAME[k]}: ${s.status}`)}"><i class="light ${LIGHTS[s.color] || ''}"></i></span>`
      : `<span class="l${hl}" data-k="${k}"></span>`;
  };
  const lightCells = GROUPS.map(([, , keys]) => `<span class="grp">${keys.map(cell).join('')}</span>`).join('');
  const cells = {
    location: `<span class="who" data-column="location"><span class="flag" role="img" aria-label="${esc(l.venue ? `${l.venue}, ${l.place}` : l.place)}" data-tip="${esc(l.venue ? `${l.venue}\n${l.place}` : l.place)}">${flag(l.cc)}</span>${l.web ? `<a class="name" href="${esc(l.web)}" target="_blank" rel="noopener"${l.photo ? ` data-photo="${esc(l.photo)}"` : ''}>${esc(l.name.replace(/^Dhamma\s+/, ''))}</a>` : `<span class="name"${l.photo ? ` data-photo="${esc(l.photo)}"` : ''}>${esc(l.name.replace(/^Dhamma\s+/, ''))}</span>`}${l.center ? '' : '<span class="kind noncenter" data-tip="non-center"></span>'}</span>`,
    dates: `<span class="dates" data-column="dates" data-tip="${esc(`${longDate(c.start)} – ${longDate(c.end)}`)}">${dateRange(c.start, c.end)}</span>`,
    type: `<span class="type" data-column="type"><span class="type-code ${typeClass(c.type)}" data-tip="${esc(`${typeTip(c.type)}\n${c.langs.join(', ')}`)}">${esc(TYPE.get(c.type).short)}</span></span>`,
    lights: `<span class="lights" data-column="lights">${lightCells}</span>`,
    apply: `<span class="reg" data-column="apply"${avail === 'soon' ? ` data-tip="Registration opens ${esc(longDate(c.enroll))}"` : ''}>${reg}</span>`,
    links: `<span class="links" data-column="links">${link(l.schedule, 'Course schedule', ICONS.schedule)}${c.hasNotes ? `<button type="button" class="icon note" data-tip="Notes" aria-label="Notes" aria-expanded="false">${ICONS.notes}</button>` : ''}</span>`,
  };
  return `<div class="row" data-id="${c.id}">${columnOrder.map(key => cells[key]).join('')}</div>`;
}

function headHTML(f) {
  const cols = GROUPS.map(([label, title, keys]) => `<span class="grp"><b data-tip="${title}">${label}</b>${keys.map(k =>
    `<span class="l${k === f.as ? ' hl' : ''}" data-tip="${COLUMN_NAME[k]}">${k.slice(-1)}</span>`).join('')}</span>`).join('');
  return `<div class="row head">${columnOrder.map(key => {
    const label = DISPLAY_COLUMNS[key].label;
    return `<button type="button" class="column-head${key === 'lights' ? ' lights' : ''}" data-column="${key}" draggable="true" aria-label="${label}. Drag to reorder, or use Alt and left or right arrow." aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight" data-tip="${label}\nDrag to reorder · Alt + ← / →">${key === 'lights' ? cols : esc(label)}</button>`;
  }).join('')}</div>`;
}

const openNotes = new Set();
const RESULT_LIMIT = 50;
let searchResult = null, controller = null;

function updateSearchStatus() {
  const pending = searchResult && toFragment(readFilters()) !== toFragment(searchResult.filters);
  const state = searchResult?.loading ? 'loading' : !searchResult ? 'initial' : pending ? 'pending' : 'complete';
  const icon = { initial: ICONS.search, complete: ICONS.check, pending: ICONS.refresh, loading: ICONS.refresh }[state];
  const button = $('#search');
  button.dataset.state = state;
  button.disabled = state === 'loading';
  button.innerHTML = `${icon}<span>${state === 'loading' ? 'Searching…' : 'Search'}</span>`;
  $('#cancel').hidden = state !== 'loading';
  const status = $('#search-status');
  status.dataset.state = pending ? 'pending' : state;
  const progress = searchResult?.searchedThrough ? ` through ${shortDate(searchResult.searchedThrough)}` : '';
  status.innerHTML = pending
    ? `${ICONS.warning}<span>Filters changed. Press Search to update results.${state === 'loading' ? ` Searching…${progress}` : ''}</span>`
    : state === 'loading' ? `Searching…${progress}`
    : searchResult?.error ? 'Press Search to retry.'
    : searchResult?.reason === 'cancelled' ? 'Search cancelled. Press Search to try again.'
    : searchResult ? 'Results match your filters.' : 'Up to 50 matching courses per search.';
}
const shortDate = date => new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
function checkedText(iso) {
  if (!iso) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));
  return minutes < 1 ? 'Checked just now' : minutes < 60 ? `Checked ${minutes} min ago` : `Checked ${Math.floor(minutes / 60)} h ago`;
}
async function searchCourses() {
  controller?.abort();
  const active = new AbortController(); controller = active;
  active.id = crypto.randomUUID();
  active.signal.addEventListener('abort', () => {
    void fetch('/api/cancel?id=' + encodeURIComponent(active.id), { method: 'POST', keepalive: true }).catch(() => {});
  }, { once: true });
  const f = readFilters(), result = { filters: f, shown: [], loading: true, partial: false, searchedThrough: null, checkedAt: null };
  searchResult = result;
  byId.clear();
  history.replaceState(null, '', '#' + toFragment(f));
  closePlaces(); render(); updateSearchStatus();
  let reader;
  try {
    const response = await fetch('/api/search?' + serializeFilters(f, { today: TODAY, includeDefaults: true }), { signal: active.signal, headers: { 'X-Sitserve-Search-Id': active.id } });
    if (!response.ok) throw new Error((await response.json()).message || `Search failed (${response.status}).`);
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', finished = false;
    const event = data => {
      if (searchResult !== result || active.signal.aborted) return;
      if (data.type === 'start') { result.today = data.today; $('#mode').hidden = data.mode !== 'simulator'; }
      if (data.type === 'progress') {
        for (const c of data.courses) if (!byId.has(c.id)) { byId.set(c.id, c); result.shown.push([c, availability(c, f, result.today)]); }
        result.shown.sort(([a], [b]) => a.start.localeCompare(b.start) || a.loc.name.localeCompare(b.loc.name));
        result.searchedThrough = data.searchedThrough;
        result.checkedAt = data.checkedAt || result.checkedAt;
      }
      if (data.type === 'done') { Object.assign(result, data); result.loading = false; finished = true; }
      if (data.type === 'error') { result.partial = result.shown.length > 0; result.error = data.message + (data.retryAfter ? ` Try again in ${Math.ceil(data.retryAfter / 60)} min.` : ''); finished = true; }
      render(); updateSearchStatus();
    };
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); if (line) event(JSON.parse(line)); }
      if (done) { if (buffer.trim()) event(JSON.parse(buffer)); break; }
    }
    if (!finished && !active.signal.aborted) throw new Error('Search connection ended. Press Search to retry.');
  } catch (e) {
    if (active.signal.aborted) result.reason = 'cancelled';
    else { result.error = e.message; result.partial = result.shown.length > 0; }
  } finally {
    reader?.releaseLock(); result.loading = false;
    if (searchResult === result) { render(); updateSearchStatus(); }
    if (controller === active) controller = null;
  }
}
$('#cancel').addEventListener('click', () => controller?.abort());
addEventListener('pagehide', () => controller?.abort());

function render() {
  hidePhoto();
  hideTip();
  list.style.setProperty('--columns', columnOrder.map(k => DISPLAY_COLUMNS[k].width).join(' '));
  const limit = $('#search-limit');
  if (!searchResult) {
    summary.textContent = 'Ready to search';
    list.innerHTML = '<p class="empty">Choose your filters and press Search to find up to 50 matching courses.</p>';
    limit.hidden = true;
    return;
  }
  const { filters: f, shown, partial, loading, error, reason } = searchResult;
  list.dataset.as = f.as;

  const months = new Map();
  for (const item of shown) {
    const key = item[0].start.slice(0, 7);
    if (!months.has(key)) months.set(key, []);
    months.get(key).push(item);
  }
  list.innerHTML = shown.length
    ? headHTML(f) + [...months].map(([key, items]) => {
        const [y, m] = ymd(key);
        return `<h2>${y} ${MONTHS[m - 1]}<span class="count">${items.length}</span></h2>${items.map(([c, avail]) => rowHTML(c, avail, f)).join('')}`;
      }).join('')
    : loading ? '<p class="empty">Searching…</p>' : error ? '<p class="empty">Search unavailable. Press Search to retry.</p>' : reason === 'cancelled' ? '<p class="empty">Search cancelled.</p>' : '<p class="empty">No courses you can sign up for were found. Change the filters and search again.</p>';
  // Month headings stick just below the column headings.
  document.documentElement.style.setProperty('--head-h', (list.querySelector('.head')?.getBoundingClientRect().height ?? 0) + 'px');
  for (const id of openNotes) {
    const row = list.querySelector(`.row[data-id="${id}"]`);
    if (row) toggleNotes(row, true);
  }

  summary.innerHTML = `<b>${shown.length}</b> course${shown.length === 1 ? '' : 's'} you can sign up for`;
  $('#checked').textContent = checkedText(searchResult.checkedAt);
  const detail = partial
    ? `Partial results. Searched through ${searchResult.searchedThrough ? shortDate(searchResult.searchedThrough) : 'the available cached pages'}. Try a later From date or narrower filters.`
    : reason === 'cancelled' ? 'Search cancelled. Results may be incomplete.'
    : shown.length === RESULT_LIMIT ? 'Showing the first 50 matches; change the filters to find others.' : '';
  limit.textContent = [error, detail].filter(Boolean).join(' ');
  limit.hidden = !limit.textContent;
}

// Notes: the location's comments, sanitized to a few harmless tags.
const KEEP = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'a']);
function sanitize(html) {
  const out = document.createDocumentFragment();
  (function copy(from, to) {
    for (const n of from.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) { to.append(n.data); continue; }
      if (n.nodeType !== Node.ELEMENT_NODE || n.localName === 'script' || n.localName === 'style') continue;
      if (!KEEP.has(n.localName)) { copy(n, to); continue; }
      const el = document.createElement(n.localName);
      if (n.localName === 'a') {
        try {
          const u = new URL(n.getAttribute('href') || '', 'https://www.dhamma.org');
          if (['http:', 'https:', 'mailto:'].includes(u.protocol)) Object.assign(el, { href: u.href, target: '_blank', rel: 'noopener' });
        } catch { /* leave the link text without a link */ }
      }
      copy(n, el);
      to.append(el);
    }
  })(inertHTML(html), out);
  return out;
}

const squash = s => fold(s).replace(/courses?|[^a-z0-9]/g, '');
function toggleNotes(row, open) {
  const c = byId.get(+row.dataset.id), btn = row.querySelector('.note');
  const panel = row.nextElementSibling?.classList.contains('notes') ? row.nextElementSibling : null;
  open ??= !panel;
  btn?.setAttribute('aria-expanded', String(open));
  if (!open) { panel?.remove(); openNotes.delete(c.id); return; }
  openNotes.add(c.id);
  if (panel) return;
  const label = textOf(c.label);
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = [
    label && squash(label) !== squash(TYPE.get(c.type).name) ? `Listed as “${label}”` : '',
    c.langs.join(', '),
  ].filter(Boolean).join(' · ');
  const notes = document.createElement('div');
  notes.className = 'notes';
  notes.append(meta, sanitize(c.comments));
  row.after(notes);
}

// Photo popover for location names.
let photoFor = null;
function showPhoto(name) {
  const c = byId.get(+name.closest('.row').dataset.id);
  const img = new Image(284, 200);
  img.alt = '';
  img.onerror = hidePhoto;
  img.src = c.loc.photo;
  photo.querySelector('img').replaceWith(img);
  photo.querySelector('div').innerHTML = `<b>${esc(c.loc.name)}</b>${c.loc.meaning ? ` <span>· ${esc(c.loc.meaning)}</span>` : ''}`;
  photo.hidden = false;
  const r = name.getBoundingClientRect(), h = photo.offsetHeight, w = photo.offsetWidth;
  photo.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
  photo.style.top = (r.bottom + 6 + h < innerHeight ? r.bottom + 6 : Math.max(8, r.top - 6 - h)) + 'px';
  photoFor = name;
}
function hidePhoto() {
  photo.hidden = true;
  photoFor = null;
}
// Tooltips for anything with a data-tip attribute, shown at once (native titles lag or don't show).
const tip = $('#tip');
let tipFor = null;
function showTip(el) {
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  const r = el.getBoundingClientRect(), h = tip.offsetHeight;
  tip.style.left = Math.max(8, Math.min(r.left, innerWidth - tip.offsetWidth - 8)) + 'px';
  tip.style.top = (r.bottom + 6 + h < innerHeight ? r.bottom + 6 : r.top - 6 - h) + 'px';
  tipFor = el;
}
function hideTip() {
  tip.hidden = true;
  tipFor = null;
}

document.addEventListener('mouseover', e => {
  const name = e.target.closest('.name[data-photo]');
  if (name && name !== photoFor) showPhoto(name);
  const el = e.target.closest('[data-tip]');
  if (el && el !== tipFor) showTip(el);
});
document.addEventListener('mouseout', e => {
  if (photoFor && !photoFor.contains(e.relatedTarget)) hidePhoto();
  if (tipFor && !tipFor.contains(e.relatedTarget)) hideTip();
});
addEventListener('scroll', () => { hidePhoto(); hideTip(); }, { passive: true });

list.addEventListener('click', e => {
  const btn = e.target.closest('.note');
  if (btn) toggleNotes(btn.closest('.row'));
});

form.addEventListener('input', updateSearchStatus);
form.addEventListener('submit', e => {
  e.preventDefault();
  void searchCourses();
});
addEventListener('hashchange', () => { setFilters(fromFragment()); updateSearchStatus(); });

// Keep the column header row just below the filter bar while scrolling.
const measureHeaders = () => {
  // Preserve fractional pixels, and overlap sticky layers by 1px to prevent scroll-through seams.
  document.documentElement.style.setProperty('--bar-h', $('.bar').getBoundingClientRect().height + 'px');
  document.documentElement.style.setProperty('--head-h', (list.querySelector('.head')?.getBoundingClientRect().height ?? 0) + 'px');
};
const layoutObserver = new ResizeObserver(measureHeaders);
layoutObserver.observe($('.bar'));
layoutObserver.observe(list);

// Theme switch. The choice is remembered in this browser; without one the page follows the system.
const themeButton = $('#theme');
function showThemeButton() {
  const dark = document.documentElement.dataset.theme === 'dark';
  themeButton.innerHTML = dark ? ICONS.sun : ICONS.moon;
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
  themeButton.dataset.tip = label;
  themeButton.setAttribute('aria-label', label);
}
themeButton.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('theme', theme); } catch { /* the choice lasts until reload */ }
  showThemeButton();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
  let saved = null;
  try { saved = localStorage.getItem('theme'); } catch { /* no saved choice */ }
  if (!saved) {
    document.documentElement.dataset.theme = e.matches ? 'dark' : 'light';
    showThemeButton();
  }
});
showThemeButton();

$('#types').innerHTML = FILTER_TYPES.map(([raw, short]) =>
  `<label class="chip ${typeClass(raw)}" data-tip="${esc(filterTypeTip(raw))}"><input type="checkbox" name="types" value="${esc(short)}"><span>${esc(short)}</span></label>`).join('');
form.elements.lang.innerHTML = '<option value="">any</option>'
  + LANGUAGES.map(([code, name]) => `<option value="${esc(code)}">${esc(name)}</option>`).join('');
setFilters(fromFragment());
updateSearchStatus();
render();
