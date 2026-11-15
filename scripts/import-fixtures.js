import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PLACES, LOCATION_REGIONS, LANGUAGES } from '../web/places.js';
const [root, snapshot] = process.argv.slice(2);
if (!root) throw new Error('Usage: node scripts/import-fixtures.js SAVED_ROOT [ORIGINAL_MOCKUP_DATA_JS]');
const dest = 'worker/fixtures/dhamma/';
const expected = snapshot ? JSON.parse(vm.runInNewContext(fs.readFileSync(snapshot, 'utf8') + ';JSON.stringify({PLACES,LOCATION_REGIONS,SAMPLE_COURSES})')) : { PLACES, LOCATION_REGIONS, SAMPLE_COURSES: JSON.parse(fs.readFileSync(dest + 'oracle-expected.json')) };
assert.deepEqual(PLACES, expected.PLACES);
assert.deepEqual(LOCATION_REGIONS, expected.LOCATION_REGIONS);
const hash = v => crypto.createHash('sha256').update(v).digest('hex');
fs.writeFileSync(dest + 'oracle-expected.json', JSON.stringify(expected.SAMPLE_COURSES));
fs.writeFileSync(dest + 'metadata-hashes.json', JSON.stringify({ PLACES: hash(JSON.stringify(PLACES)), LOCATION_REGIONS: hash(JSON.stringify(LOCATION_REGIONS)) }));
const trim = c => {
  const o = structuredClone(c);
  for (const k of ['instruction_languages_tooltip', 'course_type_hint']) delete o[k];
  for (const k of ['contact', 'about', 'instructions']) delete o.location[k];
  return o;
};
const corpus = new Map();
for (const f of fs.readdirSync(root, { recursive: true }).filter(f => f.endsWith('.json')).sort()) {
  const p = JSON.parse(fs.readFileSync(root + '/' + f));
  if (p.courses) for (const c of p.courses) corpus.set(c.id, trim(c));
}
fs.writeFileSync(dest + 'corpus.json', JSON.stringify([...corpus.values()]));
const sources = ['americas-p1', 'americas-later', 'long', 'sati-short', 'asia', 'europe'].map(f => '2026-11-13-data/' + f + '.json')
  .concat(fs.readdirSync(root + '/2026-11-13-data/types').sort().map(f => '2026-11-13-data/types/' + f));
const raw = new Map();
for (const f of sources) for (const c of JSON.parse(fs.readFileSync(root + '/' + f)).courses)
  if (expected.SAMPLE_COURSES.some(x => x.id === c.id) && !raw.has(c.id)) raw.set(c.id, trim(c));
fs.writeFileSync(dest + 'oracle-input.json', JSON.stringify([...raw.values()]));
const selection = ['base', 'p11', 'later', 'lang', 'am', 'f_win', 'd_base1', 'a_base', 't_new', 't_old'].map(f => '2026-11-14-probe/' + f + '.json')
  .concat(['66', '21', '28'].map(f => '2026-11-13-data/types/' + f + '.json'));
const roles = ['Worldwide 10-day; truncated; in progress; Indian app_page_url; HTML notes', 'Page 11 returns page 10',
  'Later start-date cursor', 'English language filter', 'Americas region; non-center venues', '64 rows; seven pages; not truncated',
  'Empty date window', 'All in-scope types; cancelled and status coverage', 'NewStudents type-3 query', 'OldStudents type-3 query', 'Gratitude courses; registration opening statuses',
  'Teacher self courses', 'Old-student 10-day courses'];
let size = 0;
const files = selection.map((source, i) => {
  const bytes = fs.readFileSync(root + '/' + source), p = JSON.parse(bytes), file = source.replaceAll('/', '-');
  fs.writeFileSync(dest + 'verbatim/' + file, bytes); size += bytes.length;
  return { file: 'verbatim/' + file, source, captured: source.slice(0, 10), sha256: hash(bytes), request: {
    ...p.saved_search_params,
    course_type_constraint: source.includes('/types/') ? [+source.match(/types\/(\d+)/)[1]] : source.includes('a_base') ? [3, 28, 6, 66, 4, 11, 12, 23, 21, 1, 10, 9] : [3],
    page: source.includes('p11') ? 11 : 1,
    daterange: /\/(base|p11|lang|am)\.json$/.test(source) ? '2026-11-14 - 2028-11-14' : null,
    sort_column: 'dates', sort_direction: 'up', date_format: 'YYYY-MM-DD',
  }, demonstrates: roles[i] };
});
assert.ok(size < 800 * 1024);
const facts = {};
for (const name of fs.readdirSync(root + '/2026-11-14-probe').filter(f => f.endsWith('.json'))) {
  const bytes = fs.readFileSync(root + '/2026-11-14-probe/' + name), p = JSON.parse(bytes);
  facts[name] = { sha256: hash(bytes), accepted: p.saved_search_params, page: p.page, pages: p.pages, total_rows: p.total_rows, pages_truncated: p.pages_truncated, ids: p.courses.map(c => c.id) };
}
fs.writeFileSync(dest + 'probe-facts.json', JSON.stringify(facts, null, 2));
fs.writeFileSync(dest + 'manifest.json', JSON.stringify({ snapshot: '2026-11-14',
  notes: 'daterange is null where not recorded. Corpus deduplicates all saved do_search pages by id; later captures win. Only course_type_hint, instruction_languages_tooltip and location.contact/about/instructions are dropped. Oracle input uses original 2026-11-13 source order. Oracle differences: sanitized comments, safe canonical URLs (including trailing slashes), same-origin photos, hasNotes, venue URLs, and centers at venues that name a directory center (course 220827). Search location 1699 has no directory pin and is treated as non-center. Metadata hashes verify equality with the original snapshot.',
  probeFacts: 'probe-facts.json records paging, accepted filters, ids and hashes for every 2026-11-14 probe. Page size probes return the same IDs and paging as base.', verbatimBytes: size, corpusCourses: corpus.size, files }, null, 2));
console.log({ places: PLACES.length, languages: LANGUAGES.length, probeFacts: 'probe-facts.json records paging, accepted filters, ids and hashes for every 2026-11-14 probe. Page size probes return the same IDs and paging as base.', verbatimBytes: size, corpusCourses: corpus.size, oracleCourses: raw.size });
