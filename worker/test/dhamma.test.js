import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, requestParams, getDhammaPage, readResponse, retryAfter, rawPageFacts } from '../dhamma.js';
import { filterDefaults, parseFilters } from '../../web/shared/courses.js';
import { fixture, FakeClock, until } from './helpers.js';
const today = '2026-11-14', defaults = filterDefaults(today), env = { UPSTREAM: 'live', UPSTREAM_CONTACT: 'test@example.invalid', SITE_URL: 'https://sitserve.test' };
test('exact plain HTTP identity and deterministic form order', async () => {
  const r = buildRequest(requestParams({ ...defaults, types: '14D/TSC', lang: 'en', where: 'location_1542,region_402' }, { today, page: 2 }), env);
  assert.equal(r.url, 'https://www.dhamma.org/en-US/courses/do_search'); assert.equal(r.method, 'POST'); assert.equal(r.redirect, 'manual');
  assert.deepEqual(Object.fromEntries(r.headers), { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'sitserve/1.0.0 (+https://sitserve.test; test@example.invalid)', 'x-requested-with': 'XMLHttpRequest' });
  assert.equal(await r.text(), 'current_state=OldStudents&course_type_constraint%5B%5D=66&course_type_constraint%5B%5D=21&regions%5B%5D=location_1542&regions%5B%5D=region_402&languages%5B%5D=en&daterange=2026-11-14+-+2028-12-31&page=2&sort_column=dates&sort_direction=up&date_format=YYYY-MM-DD');
});
for (const [query, ids] of [ ['', [3,28,6,66,4,11,12,23,21,1,10,9]], ['as=NM', [3,1]], ['as=NF&types=10D', [3]], ['as=NF&types=EXEC', [1]], ['as=NM&types=20D', []], ['types=14D', [66,21]], ['types=TSC', [66,21]], ['as=OM&types=STP,3D', [10,9]], ['as=SF', [3,28,6,66,4,11,12,23,21,1,10,9]] ]) {
  test(`request types: ${query || 'all'}`, async () => {
    const p = requestParams(parseFilters(query, { today }), { today }); assert.deepEqual(p.types, ids);
    const request = buildRequest(p, env);
    if (ids.length) assert.deepEqual(new URLSearchParams(await request.text()).getAll('course_type_constraint[]').map(Number), ids); else assert.equal(request, null);
  });
}
test('end date uses current UTC year and contacts are mandatory only live', () => {
  assert.equal(requestParams({ ...defaults, from: '2032-01-01' }, { today: '2027-01-01' }).end, '2029-12-31');
  assert.throws(() => buildRequest(requestParams(defaults, { today }), { UPSTREAM: 'live' }), /UPSTREAM_CONTACT/);
  assert.ok(buildRequest(requestParams(defaults, { today }), { UPSTREAM: 'simulator' }));
});
test('no-request branch performs zero fetches', async () => {
  let count = 0; await getDhammaPage({ types: [] }, { env, fetch: () => { count++; } }); assert.equal(count, 0);
});
for (const f of fixture('manifest.json').files) test(`response fixture: ${f.file}`, async () => {
  const page = fixture(f.file); assert.deepEqual(await readResponse(Response.json(page)), { ...page, ...rawPageFacts(page.courses) });
});
for (const [status, code] of [[429,'429'], [500,'5xx'], [502,'5xx'], [503,'5xx'], [403,'http']]) test(`HTTP ${status}: no retries`, async () => {
  let calls = 0;
  await assert.rejects(getDhammaPage(requestParams(defaults, { today }), { env, fetch: async () => { calls++; return new Response('', { status, headers: { 'Retry-After': '600' } }); } }), e => e.code === code && (status !== 429 || e.retryAfter === 600));
  assert.equal(calls, 1);
});
test('Retry-After seconds and HTTP dates', async () => {
  const now = Date.parse('2026-11-14T12:00:00Z'); assert.equal(retryAfter('120', now), 120);
  assert.equal(retryAfter('Sat, 14 Nov 2026 12:05:00 GMT', now), 300); assert.equal(retryAfter('nonsense', now), 0); assert.equal(retryAfter('Sat, 14 Nov 2026 11:00:00 GMT', now), 0);
  await assert.rejects(readResponse(new Response('', { status: 429, headers: { 'Retry-After': 'Sat, 14 Nov 2026 12:05:00 GMT' } }), () => now), e => e.retryAfter === 300);
});
for (const [name, response, code] of [
  ['HTML', () => new Response('<html>challenge</html>', { headers: { 'Content-Type': 'text/html' } }), 'non-json'],
  ['malformed', () => new Response('{bad', { headers: { 'Content-Type': 'application/json' } }), 'malformed'],
  ['truncated', () => new Response('{"courses":[', { headers: { 'Content-Type': 'application/json' } }), 'malformed'],
  ['missing fields', () => Response.json({ courses: [] }), 'malformed'],
]) test(name, async () => assert.rejects(readResponse(response()), e => e.code === code));
test('timeout aborts once even when transport ignores abort', async () => {
  const c = new FakeClock(); let signal, calls = 0;
  const p = getDhammaPage(requestParams(defaults, { today }), { env, fetch: r => { calls++; signal = r.signal; return new Promise(() => {}); }, clock: c.clock, timers: c, timeout: 20 });
  const rejected = assert.rejects(p, e => e.code === 'timeout'); await until(() => !!signal); await c.advance(20); await rejected;
  assert.equal(signal.aborted, true); assert.equal(calls, 1); assert.equal(c.jobs.size, 0);
});
test('slow valid response is returned and reported without retry', async () => {
  const c = new FakeClock(), slow = []; let calls = 0;
  const page = await getDhammaPage(requestParams(defaults, { today }), { env, clock: c.clock, timers: c, slow: 10,
    onSlow: elapsed => slow.push(elapsed), fetch: async () => { calls++; c.now += 11; return Response.json(fixture('verbatim/2026-11-14-probe-base.json')); } });
  assert.equal(page.courses.length, 10); assert.deepEqual(slow, [11]); assert.equal(calls, 1); assert.equal(c.jobs.size, 0);
});
test('offline setup blocks remote fetches', async () => assert.rejects(fetch('https://example.invalid'), /Offline test blocked/));
for(const path of ['courses','page','pages','total_rows','pages_truncated','courses.0.id','courses.0.course_start_date','courses.0.course_end_date','courses.0.enrollment_open_date','courses.0.raw_course_type','courses.0.course_type','courses.0.course_instruction_languages','courses.0.status','courses.0.status.0.type','courses.0.location','courses.0.location.dhamma_name','courses.0.location.country_iso_code','courses.0.trans_apply_link_url','courses.0.comments']) test(`required response field: ${path}`,async()=>{
  const p=fixture('verbatim/2026-11-14-probe-base.json'),parts=path.split('.');let object=p;
  for(const k of parts.slice(0,-1))object=object[k];delete object[parts.at(-1)];
  if (parts.length === 1) await assert.rejects(readResponse(Response.json(p)), e => e.code === 'malformed');
  else {
    const logs = [], page = await readResponse(Response.json(p), Date.now, line => logs.push(JSON.parse(line)));
    assert.equal(page.courses.length, 9); assert.equal(page.rawCount, 10);
    assert.equal(logs.length, 1); assert.equal(logs[0].event, 'invalid-course'); assert.equal(logs[0].index, 0);
  }
});

test('invalid course objects are skipped without changing raw paging facts', async () => {
  const original = fixture('verbatim/2026-11-14-probe-base.json'), logs = [];
  const raw = { ...original, courses: [null, {}, ...original.courses.slice(2)] };
  const page = await readResponse(Response.json(raw), Date.now, line => logs.push(JSON.parse(line)));
  assert.equal(page.courses.length, 8); assert.equal(page.rawCount, 10);
  assert.deepEqual(page.rawIds, original.courses.slice(2).map(c => c.id));
  assert.equal(logs.length, 2); assert.deepEqual(raw.courses.slice(0, 2), [null, {}]);
});
