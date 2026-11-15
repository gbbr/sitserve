import { PLACES, LOCATION_REGIONS, LANGUAGES } from '../places.js';

// Light columns, and which columns each status entry type fills. A status entry
// without a type covers the whole course; more specific entries win over general ones.
export const COLUMNS = [['NM', 'New male'], ['NF', 'New female'], ['OM', 'Old male'], ['OF', 'Old female'], ['SM', 'Server, male'], ['SF', 'Server, female']];
export const GROUPS = [['NEW', 'New students', ['NM', 'NF']], ['OLD', 'Old students', ['OM', 'OF']], ['SRV', 'Servers', ['SM', 'SF']]];
export const KEYS = COLUMNS.map(([k]) => k);
export const COLUMN_NAME = Object.fromEntries(COLUMNS);
export const COVERS = { m: ['NM', 'OM'], w: ['NF', 'OF'], s: ['SM', 'SF'], nm: ['NM'], nw: ['NF'], om: ['OM'], ow: ['OF'], ms: ['SM'], fs: ['SF'] };
export const specificity = s => (s.type == null ? 0 : s.type.length === 1 ? 1 : 2);
export const LIGHTS = { Green: 'g', Yellow: 'y', Orange: 'o', Red: 'r' };

// Course types the page covers: dhamma.org's raw_course_type code, short and full name.
export const TYPES = [
  ['10-Day', '10D', '10-day', 3],
  ['10-DayOSC', '10D OS', '10-day for old students', 28],
  ['10-DaySpecial', '10D SPCL', 'Special 10-day', 6],
  ['14-DayGratitude', '14D', '14-day gratitude course', 66],
  ['20-DayOSC', '20D', '20-day', 4],
  ['30-DayOSC', '30D', '30-day', 11],
  ['45-DayOSC', '45D', '45-day', 12],
  ['60-DayOSC', '60D', '60-day', 23],
  ['TSC', 'TSC', "Teacher's self course", 21],
  ['10-DayExecutive', 'EXEC', 'Executive course', 1],
  ['Satipatthana', 'STP', 'Satipaṭṭhāna Sutta course', 10],
  ['3-DayOSC', '3D', '3-day', 9],
];
export const TYPE = new Map(TYPES.map(([raw, short, name, id]) => [raw, { short, name, id }]));
// Course types that take new students; the others are for old students only.
export const NEW_STUDENT_TYPES = new Set(['10-Day', '10-DayExecutive']);
export const LONG_TYPES = new Set(['10-DaySpecial', '20-DayOSC', '30-DayOSC', '45-DayOSC', '60-DayOSC']);
export const SPECIAL_TYPES = new Set(['TSC', '14-DayGratitude', 'Satipatthana']);
export const typeClass = raw => LONG_TYPES.has(raw) ? 'long' : SPECIAL_TYPES.has(raw) ? 'special' : 'regular';
export const typeTip = raw => [TYPE.get(raw).name, LONG_TYPES.has(raw) ? 'Long course' : ''].filter(Boolean).join(' · ');
// Combine the two upstream 14-day codes in one filter; retain their own codes in rows.
export const filterTypeCode = raw => ['14-DayGratitude', 'TSC'].includes(raw) ? '14D/TSC' : TYPE.get(raw).short;
export const filterTypeTip = raw => raw === '14-DayGratitude' ? "14-day gratitude / teacher's self course" : typeTip(raw);
// Keep like-colored chips together, shortest first, with teal before violet.
export const FILTER_GROUP_ORDER = { regular: 0, special: 1, long: 2 };
export const filterDuration = raw => raw === 'Satipatthana' ? 8 : parseInt(raw, 10) || Infinity;
export const FILTER_TYPES = TYPES.filter(([raw]) => raw !== 'TSC').map(([raw]) => [raw, filterTypeCode(raw)])
  .sort(([a], [b]) => FILTER_GROUP_ORDER[typeClass(a)] - FILTER_GROUP_ORDER[typeClass(b)] || filterDuration(a) - filterDuration(b));

export const fold = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// Escapes text for HTML content and quoted attribute values.
export const escapeHTML = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const places = PLACES.map(([kind, id, text, texts, tag, count]) => ({
  kind, id, text, texts, tag, count, key: `${kind}_${id}`, search: [...texts, text].map(fold),
}));
export const placeByKey = new Map(places.map(p => [p.key, p]));
// Names compared without accents, case or punctuation: "Dhamma Pasada" matches "Dhamma Pāsāda".
export const nameKey = s => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();
const centerIDs = new Map();
for (const p of places) if (p.kind === 'location' && p.tag === 'center') {
  const key = nameKey(p.texts[0]);
  centerIDs.set(key, [...centerIDs.get(key) || [], p.id]);
}
// Directory centers a venue name refers to: the whole name, or a "Dhamma …" center name inside it,
// as in "Vipassana Long Course Centre (Dhamma Rasa)". Two pairs of centers share a name. Other
// center names, such as "Vipassana Meditation France", are too generic to find inside a longer one.
export function venueCenters(venue) {
  const key = nameKey(venue);
  if (!key) return [];
  if (centerIDs.has(key)) return centerIDs.get(key);
  return [...centerIDs].filter(([name]) => name.startsWith('dhamma') && ` ${key} `.includes(` ${name} `)).flatMap(([, ids]) => ids);
}
export const languageNames = new Map(LANGUAGES);
export function placeMatches(c, p) {
  const l = c.loc;
  if (p.kind === 'region') return (LOCATION_REGIONS[l.id] || []).includes(p.id);
  if (p.kind === 'location') return l.id === p.id;
  if (p.kind === 'sublocation') return l.subId === p.id;
  if (p.kind === 'state') {
    const state = p.texts[0], country = p.text.slice(state.length).replace(/^,\s*/, '');
    return fold(l.state) === fold(state) && fold(l.country) === fold(country);
  }
  return false;
}
export function lights(c) {
  const cells = {};
  for (const s of [...c.status].sort((a, b) => specificity(a) - specificity(b)))
    for (const k of COVERS[s.type] || KEYS) cells[k] = s;
  if (!NEW_STUDENT_TYPES.has(c.type)) { delete cells.NM; delete cells.NF; }
  return cells;
}
export const utcToday = (clock = Date.now) => new Date(clock()).toISOString().slice(0, 10);
export const opensLater = (c, today = utcToday()) => c.enroll > today || c.status.some(s => /^applications accepted/i.test(s.status));
export function availability(c, f, today = utcToday()) {
  if (c.status.some(s => /cancelled|canceled|in progress/i.test(s.status))) return '';
  if (['NM', 'NF'].includes(f.as) && !NEW_STUDENT_TYPES.has(c.type)) return '';
  if (opensLater(c, today)) return f.soon ? 'soon' : '';
  const cells = lights(c);
  const ok = s => s && (s.color === 'Green' || (f.wait && ['Yellow', 'Orange'].includes(s.color)));
  return (f.as === 'any' ? KEYS : [f.as]).some(k => ok(cells[k])) ? 'open' : '';
}
export function matches(c, f) {
  return c.start >= f.from && TYPE.has(c.type)
    && (!f.types || f.types.split(',').includes(filterTypeCode(c.type)))
    && (!f.centers || c.loc.center)
    && (!f.lang || c.langs.includes(languageNames.get(f.lang)))
    && (!f.where || f.where.split(',').some(k => placeByKey.has(k) && placeMatches(c, placeByKey.get(k))));
}
// The most places one search combines; each is sent upstream and compared with cached queries.
export const MAX_PLACES = 10;
// The most matching courses one search returns.
export const RESULT_LIMIT = 50;
export const filterDefaults = (today = utcToday()) => ({ where: '', from: today, types: '', as: 'any', lang: '', centers: false, wait: true, soon: true });
export const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
export function parseFilters(input = '', { today = utcToday(), strict = false } = {}) {
  const p = input instanceof URLSearchParams ? input : new URLSearchParams(input.replace(/^[#?]/, ''));
  const f = filterDefaults(today), fail = message => { if (strict) throw new Error(message); };
  if (strict) for (const k of p.keys()) {
    if (!(k in f)) throw new Error(`Unknown filter: ${k}`);
    if (p.getAll(k).length > 1) throw new Error(`Repeated filter: ${k}`);
  }
  for (const [k, d] of Object.entries(f)) if (p.has(k)) {
    if (typeof d === 'boolean') {
      if (!['0', '1'].includes(p.get(k))) fail(`Invalid ${k}`);
      else f[k] = p.get(k) === '1';
    } else f[k] = p.get(k);
  }
  if (!validDate(f.from)) { fail('Invalid From date'); f.from = today; }
  if (![...KEYS, 'any'].includes(f.as)) { fail('Invalid As position'); f.as = 'any'; }
  if (f.lang && !languageNames.has(f.lang)) {
    const language = LANGUAGES.find(([, name]) => fold(name) === fold(f.lang));
    if (!language) fail('Unknown language');
    f.lang = language?.[0] || '';
  }
  const codes = new Set(f.types.split(',').filter(Boolean).map(c => ['14D', 'TSC'].includes(c) ? '14D/TSC' : c));
  for (const c of codes) if (!FILTER_TYPES.some(([, code]) => c === code)) fail(`Unknown course type: ${c}`);
  f.types = FILTER_TYPES.map(([, code]) => code).filter(code => codes.has(code)).join(',');
  const where = [...new Set(f.where.split(',').filter(k => placeByKey.has(k)))];
  if (where.length > MAX_PLACES) fail(`Too many places (at most ${MAX_PLACES})`);
  f.where = where.slice(0, MAX_PLACES).join(',');
  return f;
}
export function serializeFilters(f, { today = utcToday(), includeDefaults = false } = {}) {
  const p = new URLSearchParams();
  for (const [k, d] of Object.entries(filterDefaults(today))) if (includeDefaults || f[k] !== d)
    p.set(k, typeof d === 'boolean' ? (f[k] ? '1' : '0') : f[k]);
  return p.toString();
}
export function searchTypeIDs(f) {
  return TYPES.filter(([raw]) => (!f.types || f.types.split(',').includes(filterTypeCode(raw)))
    && (!['NM', 'NF'].includes(f.as) || NEW_STUDENT_TYPES.has(raw))).map(([, , , id]) => id);
}
