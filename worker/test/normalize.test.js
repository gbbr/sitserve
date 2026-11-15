import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { normalize, sanitize, photoPath, safeURL, hasNotes } from '../normalize.js';
import { fixture, rawTemplate } from './helpers.js';
import { PLACES, LOCATION_REGIONS, LOCATION_STATES, LANGUAGES, COURSE_TYPE_IDS } from '../../web/places.js';
import { buildPlaces, inlineJSON } from '../../web/tools/build-places.js';
import { venueCenters } from '../../web/shared/courses.js';
test('normalization oracle: every original course and field', () => {
  const input = fixture('oracle-input.json');
  // Dhamma Geha's own site is recorded as a venue, so its course 220827 is held at a center.
  const expected = fixture('oracle-expected.json').map((c, i) => ({ ...c, apply: safeURL(c.apply), comments: sanitize(c.comments), hasNotes: hasNotes(sanitize(c.comments)), loc: { ...c.loc, center: c.loc.center || c.id === 220827, venueUrl: safeURL(input[i].location.sub_location_url), web: safeURL(c.loc.web), schedule: safeURL(c.loc.schedule), photo: photoPath(c.loc.photo) } }));
  const actual = input.map(normalize);
  for (let i = 0; i < expected.length; i++) assert.deepEqual(actual[i], expected[i], `course ${expected[i].id}`); assert.equal(expected.length, 152);
});
test('a venue that names a directory center is a center; other venues keep the upstream flag', () => {
  const at = (sub_location, sub_location_url = null) => normalize({ ...rawTemplate, location: { ...rawTemplate.location, center_noncenter: 'noncenter', sub_location, sub_location_url } }).loc;
  for (const venue of ['Dhamma Pasada', 'Vipassana Long Course Centre (Dhamma Rasa)', 'Candeleda - Dhamma Sacca']) assert.equal(at(venue).center, true, venue);
  for (const venue of ['Montreal', 'Vipassana Meditation France - Paris', 'Dhamma']) assert.equal(at(venue).center, false, venue);
  assert.equal(at('Dhamma Pasada', 'https://maps.example/pasada').venueUrl, 'https://maps.example/pasada');
  assert.equal(at('Dhamma Pasada', 'javascript:alert(1)').venueUrl, '');
  assert.deepEqual(venueCenters('Dhamma Pasada'), [1770]); assert.deepEqual(venueCenters('Dhamma Nilaya, Jamdoli (Jaipur)'), [1399, 1848]);
});
test('out-of-scope courses dropped; unsafe URLs dropped', () => {
  assert.equal(normalize({ ...rawTemplate, raw_course_type: 'Other' }), null);
  const c = normalize({ ...rawTemplate, app_page_url: 'javascript:alert(1)', location: { ...rawTemplate.location, website_url: 'data:text/html,hi' } });
  assert.equal(c.apply, ''); assert.equal(c.loc.web, '');
  assert.equal(photoPath('https://evil.invalid/assets/a.png'), ''); assert.equal(photoPath('/assets/../evil.jpg'), '');
});
for (const html of [
  '<img src=x onerror=alert(1)><p onclick=alert(1)>ok</p>', '<script>alert(1)</script><style>body{}</style>',
  '<a href="javascript:alert(1)">x</a>', '<a href="jav&#x61;script:alert(1)">x</a>', '<a href="java&#10;script:alert(1)">x</a>',
  '<a href="data:text/html;base64,hi">x</a>', '<svg><a xlink:href="javascript:1">x</a></svg>',
  '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=1 onerror=alert(1)>">',
  '<a href="https://good.invalid/" onmouseover="alert(1)" style=x>x</a>', '<a href="javascript&colon;alert(1)">x</a>',
  '<p><iframe srcdoc="<script>evil</script>"></iframe></p>', '<a href="https://good.invalid/\" onclick=alert(1)">x</a>',
  '<!-- hidden <img src=x> --> <b>safe</b>', 'before < unfinished', '<a href="&#0;javascript:alert(1)">x</a>',
]) test(`sanitizer: ${html.slice(0, 65)}`, () => {
  const clean = sanitize(html);
  for (const tag of clean.matchAll(/<[^>]*>/g)) assert.match(tag[0], /^<\/?(?:p|br|b|strong|i|em|u|ul|ol|li|a)(?: href="(?:https?:|mailto:)[^"]*")?>$/);
  assert.doesNotMatch(clean, /href="(?:javascript|data):/i);
  assert.equal(sanitize(clean), clean, 'sanitizing twice is stable');
});
test('sanitizer retains useful allowed markup and links', () => {
  assert.equal(sanitize('<p>hi<br/><strong>there</strong> &amp; <a href="mailto:a@example.invalid" target=x>mail</a></p>'), '<p>hi<br><strong>there</strong> &amp; <a href="mailto:a@example.invalid">mail</a></p>');
});
test('metadata matches snapshot hashes, including tags and counts', () => {
  const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
  const expected = fixture('metadata-hashes.json'); assert.equal(hash(PLACES), expected.PLACES); assert.equal(hash(LOCATION_REGIONS), expected.LOCATION_REGIONS);
  assert.deepEqual(Object.fromEntries(['region','state','location','sublocation'].map(k => [k, PLACES.filter(p => p[0] === k).length])), { region:154, state:142, location:409, sublocation:465 });
  assert.equal(LOCATION_STATES[1542], 'Massachusetts'); assert.equal(LOCATION_STATES[1492], '');
  assert.ok(LANGUAGES.some(l => l[0] === 'en' && l[1] === 'English')); assert.ok(COURSE_TYPE_IDS.OldStudents.some(t => t.id === 66));
});
test('metadata parser uses directory nesting and pins without evaluating scripts', () => {
  const html = 'viewModel.search_regions([{text:"regions", children:[{"id":["region",1],"text":"World","texts":["World"]},{"id":["location",2],"text":"Place","texts":["Place"]}]}]); instructionLanguages = [{"iso_code":"en","description":"English"}]; viewModel.course_types({"OldStudents":[]});';
  const d = '<div id="region-1" data-id="1"></div><div class="region-children"><div id="location-2" data-id="2"><span class="noncenter-pin"></span></div></div>';
  const result = buildPlaces(html,d); assert.deepEqual(result.LOCATION_REGIONS, { 2:[1] }); assert.equal(result.PLACES[0][5], 1); assert.equal(result.PLACES[1][4], 'non-center');
  assert.throws(() => inlineJSON('evil()', 'missing'), /Missing/);
});
test('verbatim fixtures are byte-identical to the recorded hashes and under 800 KB', () => {
  const manifest = fixture('manifest.json'); let size = 0;
  for (const f of manifest.files) { const data = fs.readFileSync(new URL('../fixtures/dhamma/' + f.file, import.meta.url)); size += data.length; assert.equal(crypto.createHash('sha256').update(data).digest('hex'), f.sha256); }
  assert.equal(size, manifest.verbatimBytes); assert.ok(size < 800 * 1024);
});
