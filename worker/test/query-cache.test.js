import test from 'node:test';
import assert from 'node:assert/strict';
import corpus from '../fixtures/dhamma/corpus.json' with { type: 'json' };
import { placeByKey, filterDefaults, matches, availability } from '../../web/shared/courses.js';
import { queryCovers, placeWithin, QUERY_INDEX_KEY, MAX_QUERY_SEQUENCES } from '../query-cache.js';
import { UpstreamGate } from '../upstream.js';
import { createSimulator } from '../simulator.js';
import { requestParams } from '../dhamma.js';
import { normalize } from '../normalize.js';
import { search } from '../search.js';
import { FakeClock, MemoryStorage, rawCourses } from './helpers.js';
const today = '2026-11-14', defaults = filterDefaults(today), DAY = 86400000;
const dhara = corpus.find(c => c.location.id === 1542).location;
const hawaii = corpus.find(c => c.location.id === 1547 && c.location.sub_location_id).location;
const hawaiiState = [...placeByKey.values()].find(p => p.kind === 'state' && p.text === 'Hawaii, United States').key;
const rowsAtDhara = n => rawCourses(n).map(c => ({ ...c, course_instruction_languages: ['English'], location: structuredClone(dhara) }));
function make(rows, env = {}) {
  const clock = new FakeClock(), storage = new MemoryStorage(), requests = [];
  const simulator = createSimulator({ rows });
  const options = { storage, clock: clock.clock, timers: clock, env: { UPSTREAM: 'simulator', UPSTREAM_SPACING_MS: '0', ...env }, log: () => {},
    fetch: async request => { requests.push(new URLSearchParams(await request.clone().text())); return simulator.fetch(request); } };
  const a = { clock, storage, options, simulator, requests, gate: new UpstreamGate(options) };
  a.warm = async (filters, pages) => {
    const results = [];
    for (const page of pages) results.push(await a.gate.getPage(requestParams(filters, { today, page })));
    return results;
  };
  a.run = async (filters, extra = {}) => {
    const events = [];
    const result = await search(filters, { today, getPage: p => a.gate.getPage(p), getCachedSequence: p => a.gate.getCachedSequence(p), emit: e => events.push(e), ...extra });
    return { result, events, courses: events.filter(e => e.type === 'progress').flatMap(e => e.courses) };
  };
  return a;
}
const params = changes => ({ types: [3, 9], regions: [], language: '', from: today, end: '2028-12-31', ...changes });
for (const [key, parent] of [
  ['region_99', 'region_402'], ['state_3925', 'region_99'], ['state_3925', 'region_402'],
  ['location_1542', 'state_3925'], ['location_1542', 'region_402'], ['location_1542', 'region_122'],
  ['sublocation_15175', 'location_1547'], ['sublocation_15175', hawaiiState], ['sublocation_15175', 'region_402'],
]) test(`place containment ${key} within ${parent}`, () => {
  const venues = new Map([[15175, [{ id: 1547, state: 'Hawaii', country: 'United States' }]]]);
  assert.equal(placeWithin(key, parent, venues), true);
  assert.equal(placeWithin(parent, key, venues), false);
});
test('unknown venue parents and unrelated places never imply containment', () => {
  assert.equal(placeWithin('sublocation_15175', 'location_1547'), false);
  assert.equal(placeWithin('sublocation_15175', 'region_402'), false);
  assert.equal(placeWithin('location_1542', 'state_3951'), false);
  assert.equal(placeWithin('region_402', 'region_117'), false);
  assert.equal(placeWithin('location_1542', 'location_1442'), false);
});
for (const [name, q, s] of [
  ['types', params(), params({ types: [3] })], ['later From', params(), params({ from: '2026-12-01' })],
  ['language', params(), params({ language: 'en' })], ['same language', params({ language: 'en' }), params({ language: 'en', types: [3] })],
  ['worldwide to a place', params(), params({ regions: ['location_1542'] })],
  ['OR places', params({ regions: ['region_402', 'region_117'] }), params({ regions: ['state_3925', 'region_99'] })],
]) test(`query subset: ${name}`, () => assert.equal(queryCovers(q, s), true));
for (const [name, q, s] of [
  ['wider types', params({ types: [3] }), params()], ['earlier From', params({ from: '2026-12-01' }), params()],
  ['different language', params({ language: 'en' }), params({ language: 'fr' })],
  ['wider language', params({ language: 'en' }), params()], ['different end', params(), params({ end: '2029-12-31' })],
  ['worldwide from a place', params({ regions: ['region_402'] }), params()],
  ['wider place', params({ regions: ['location_1542'] }), params({ regions: ['region_402'] })],
  ['one OR place outside', params({ regions: ['region_402'] }), params({ regions: ['location_1542', 'region_117'] })],
]) test(`non-subset: ${name}`, () => assert.equal(queryCovers(q, s), false));
for (const [name, q, s] of [
  ['types', defaults, { ...defaults, types: '10D' }],
  ['later From', defaults, { ...defaults, from: '2026-11-20' }],
  ['language', defaults, { ...defaults, lang: 'en' }],
  ['region', defaults, { ...defaults, where: 'region_402' }],
  ['country in region', { ...defaults, where: 'region_402' }, { ...defaults, where: 'region_99' }],
  ['state in country', { ...defaults, where: 'region_99' }, { ...defaults, where: 'state_3925' }],
  ['location in state', { ...defaults, where: 'state_3925' }, { ...defaults, where: 'location_1542' }],
]) test(`complete cached sequence answers ${name} with zero upstream requests`, async () => {
  const rows = rowsAtDhara(20); rows[3].course_instruction_languages = ['French'];
  rows[7].raw_course_type = '3-DayOSC';
  const a = make(rows); await a.warm(q, [1, 2]); const before = a.simulator.requests;
  const result = await a.run(s);
  const expected = rows.map(normalize).filter(c => matches(c, s) && availability(c, s, today));
  assert.deepEqual(result.courses.map(c => c.id), expected.map(c => c.id));
  assert.equal(result.result.reason, 'end'); assert.equal(a.simulator.requests, before);
  assert.ok(result.events.filter(e => e.type === 'progress').every(e => e.reused));
});
for (const [name, q, s] of [
  ['types', { ...defaults, types: '3D' }, defaults],
  ['From', { ...defaults, from: '2026-11-20' }, defaults],
  ['language', { ...defaults, lang: 'fr' }, { ...defaults, lang: 'en' }],
  ['wider language', { ...defaults, lang: 'en' }, defaults],
  ['places', { ...defaults, where: 'state_3925' }, { ...defaults, where: 'region_402' }],
]) test(`a non-subset ${name} uses its own upstream query`, async () => {
  const a = make(rowsAtDhara(10)); await a.warm(q, [1]); const before = a.simulator.requests;
  const result = await a.run(s);
  assert.equal(result.events.some(e => e.reused), false); assert.ok(a.simulator.requests > before);
});
for (const parent of ['location_1547', hawaiiState, 'region_402']) test(`venue subset uses cached parent ${parent}`, async () => {
  const rows = rawCourses(10).map(c => ({ ...c, location: structuredClone(hawaii) }));
  const a = make(rows); await a.warm({ ...defaults, where: parent }, [1]); const before = a.simulator.requests;
  const result = await a.run({ ...defaults, where: 'sublocation_15175' });
  assert.equal(result.courses.length, 10); assert.equal(a.simulator.requests, before); assert.equal(result.result.reason, 'end');
});
test('partial coverage excludes the entire last date, then continues from that date using S', async () => {
  const rows = rowsAtDhara(40); rows.forEach((c, i) => { c.course_start_date = c.course_end_date = i < 10 ? '2026-11-15' : '2026-11-16'; });
  const a = make(rows); await a.warm(defaults, [1, 2]); const before = a.simulator.requests;
  const result = await a.run({ ...defaults, types: '10D' });
  const reused = result.events.filter(e => e.reused);
  assert.equal(reused.length, 2); assert.equal(reused[0].courses.length, 10); assert.equal(reused[1].courses.length, 0);
  assert.equal(reused.some(e => e.courses.some(c => c.start === '2026-11-16')), false);
  assert.equal(result.result.reason, 'end'); assert.equal(result.courses.length, 40); assert.equal(new Set(result.courses.map(c => c.id)).size, 40);
  for (const p of a.requests.slice(before)) { assert.equal(p.get('daterange'), '2026-11-16 - 2028-12-31'); assert.deepEqual(p.getAll('course_type_constraint[]'), ['3']); }
  assert.equal(result.result.pages, 5); assert.equal(a.simulator.requests - before, 3);
});
test('coverage sufficient for fifty matches uses no upstream requests and dates only pages used', async () => {
  const a = make(rowsAtDhara(80)); await a.warm(defaults, [6]); await a.clock.advance(60000);
  const warm = await a.warm(defaults, [1, 2, 3, 4, 5]); const before = a.simulator.requests;
  const result = await a.run({ ...defaults, types: '10D' });
  assert.equal(result.result.reason, 'limit'); assert.equal(result.result.count, 50); assert.equal(result.result.pages, 5);
  assert.equal(result.result.checkedAt, warm[0].fetchedAt); assert.equal(a.simulator.requests, before);
});
test('a covering query is selected by its furthest coverage, without fetching broad pages', async () => {
  const a = make(rowsAtDhara(40)); await a.warm(defaults, [1]);
  const regional = { ...defaults, where: 'region_402' }; await a.warm(regional, [1, 2, 3]);
  const before = a.simulator.requests, plan = await a.gate.getCachedSequence(requestParams({ ...defaults, types: '10D', where: 'location_1542' }, { today }));
  assert.equal(plan.pages.length, 3); assert.equal(plan.coverageEnd, '2026-12-14'); assert.equal(plan.complete, false);
  assert.equal(a.simulator.requests, before);
});
test('reused pages count toward the same twenty-page cap and preserve oldest checkedAt', async () => {
  const rows = rowsAtDhara(2000); rows.forEach(c => { c.status[0].status = 'Closed'; c.status[0].color = 'Red'; });
  const a = make(rows), cached = await a.warm(defaults, [1,2,3,4,5,6,7,8,9,10]); await a.clock.advance(60000);
  const before = a.simulator.requests, result = await a.run({ ...defaults, types: '10D' });
  assert.equal(result.result.reason, 'cap'); assert.equal(result.result.partial, true); assert.equal(result.result.pages, 20);
  assert.equal(result.events.filter(e => e.reused).length, 10); assert.equal(a.simulator.requests - before, 10);
  assert.equal(result.result.checkedAt, cached[0].fetchedAt);
  assert.equal(result.result.searchedThrough, new Date(Date.parse('2026-11-15') + 198 * DAY).toISOString().slice(0,10));
});
test('subset filtering applies As, centers, wait lists and not-open-yet before counting', async () => {
  const rows = rowsAtDhara(10);
  rows[0].location.center_noncenter = 'noncenter';
  rows[1].status = [{ type: 'nm', label: null, status: 'Open', color: 'Green' }];
  rows[2].status[0] = { type: 'om', label: null, status: 'Wait List', color: 'Yellow' };
  rows[3].enrollment_open_date = '2026-12-01';
  const a = make(rows); await a.warm(defaults, [1]); const before = a.simulator.requests;
  const filters = { ...defaults, types: '10D', as: 'OM', centers: true, wait: false, soon: false };
  const result = await a.run(filters);
  assert.deepEqual(result.courses.map(c => c.id), rows.slice(4).map(c => c.id)); assert.equal(a.simulator.requests, before);
});
test('the persisted index and venue evidence survive a new gate instance', async () => {
  const a = make(rawCourses(10).map(c => ({ ...c, location: structuredClone(hawaii) })));
  await a.warm({ ...defaults, where: 'location_1547' }, [1]);
  const index = await a.storage.get(QUERY_INDEX_KEY); assert.equal(index.length, 1);
  assert.equal(index[0].contiguous, 1); assert.equal(index[0].complete, true); assert.ok(index[0].oldestFetchedAt);
  a.gate = new UpstreamGate(a.options); const before = a.simulator.requests;
  const result = await a.run({ ...defaults, where: 'sublocation_15175' });
  assert.equal(result.courses.length, 10); assert.equal(a.simulator.requests, before);
});
test('expired pages cannot enable reuse, and alarms prune the index', async () => {
  const a = make(rowsAtDhara(10)); await a.warm(defaults, [1]); await a.clock.advance(DAY);
  assert.equal(await a.gate.getCachedSequence(requestParams({ ...defaults, types: '10D' }, { today })), null);
  await a.storage.fireAlarm(() => a.gate.expire()); assert.deepEqual(await a.storage.get(QUERY_INDEX_KEY), []);
  const before = a.simulator.requests; await a.run({ ...defaults, types: '10D' }); assert.equal(a.simulator.requests - before, 1);
});
test('a missing or expired first page cannot use a later cached tail as complete coverage', async () => {
  const a = make(rowsAtDhara(20)); await a.warm(defaults, [1]); await a.clock.advance(1000); await a.warm(defaults, [2]);
  await a.clock.advance(DAY - 1000);
  assert.equal(await a.gate.getCachedSequence(requestParams({ ...defaults, types: '10D' }, { today })), null);
  const index = await a.storage.get(QUERY_INDEX_KEY); assert.equal(index[0].contiguous, 0);
});
test('only the contiguous prefix contributes coverage when a cached middle page is missing', async () => {
  const a = make(rowsAtDhara(40)); await a.warm(defaults, [1,3,4]);
  const plan = await a.gate.getCachedSequence(requestParams({ ...defaults, types: '10D' }, { today }));
  assert.equal(plan.pages.length, 1); assert.equal(plan.coverageEnd, '2026-11-24'); assert.equal(plan.complete, false);
});
test('From at an incomplete coverage boundary has no range to reuse', async () => {
  const a = make(rowsAtDhara(40)); await a.warm(defaults, [1]);
  assert.equal(await a.gate.getCachedSequence(requestParams({ ...defaults, types: '10D', from: '2026-11-24' }, { today })), null);
});
test('an exhausted empty query covers narrower searches without any upstream requests', async () => {
  const a = make([]); await a.warm(defaults, [1]); const before = a.simulator.requests;
  const result = await a.run({ ...defaults, types: '10D', from: '2026-12-01' });
  assert.equal(result.result.reason, 'end'); assert.equal(result.result.count, 0); assert.equal(result.result.pages, 1); assert.equal(a.simulator.requests, before);
});
test('the persisted index is bounded and does not list/deserialise the page cache on writes', async () => {
  const a = make([]);
  for (let i = 0; i <= MAX_QUERY_SEQUENCES; i++) await a.warm({ ...defaults, from: new Date(Date.parse(today) + i * DAY).toISOString().slice(0,10) }, [1]);
  const index = await a.storage.get(QUERY_INDEX_KEY); assert.equal(index.length, MAX_QUERY_SEQUENCES);
  assert.equal(index.some(s => s.params.from === today), false); assert.equal(a.storage.listCalls, 0);
});
test('a cancelled reuse lookup does not fetch more pages', async () => {
  const a = make(rowsAtDhara(30)); await a.warm(defaults, [1,2,3]); const before = a.simulator.requests;
  const controller = new AbortController();
  const result = await a.run({ ...defaults, types: '10D' }, { signal: controller.signal, emit: () => controller.abort() });
  assert.equal(result.result.reason, 'cancelled'); assert.equal(result.result.pages, 1); assert.equal(a.simulator.requests, before);
});

test('a reused complete sequence remains available with a spent allowance and charges no visitor search', async () => {
  const a = make(rowsAtDhara(20), { UPSTREAM_ALLOWANCE: '2' }); await a.warm(defaults, [1, 2]);
  const session = a.gate.beginSearch('visitor'), before = a.simulator.requests;
  const result = await a.run({ ...defaults, types: '10D' }, { getPage: p => a.gate.getPage(p, session), getCachedSequence: p => a.gate.getCachedSequence(p, session) });
  assert.equal(result.result.reason, 'end'); assert.equal(result.result.count, 20);
  assert.equal(a.simulator.requests, before); assert.equal(session.charged, false);
});
test('expiry during a covering-page read cannot turn a sequence into false complete coverage', async () => {
  const a = make(rowsAtDhara(20)); await a.warm(defaults, [1]); await a.clock.advance(1000); await a.warm(defaults, [2]);
  await a.clock.advance(DAY - 1001);
  const cached = a.gate.cached.bind(a.gate);
  a.gate.cached = async key => { await a.clock.advance(1); return cached(key); };
  const plan = await a.gate.getCachedSequence(requestParams({ ...defaults, types: '10D' }, { today }));
  assert.equal(plan, null);
});
test('cache-hit pages can populate an index without refetching cached responses', async () => {
  const a = make(rowsAtDhara(10)); await a.warm(defaults, [1]);
  await a.storage.delete(QUERY_INDEX_KEY); a.gate = new UpstreamGate(a.options);
  const before = a.simulator.requests; await a.warm(defaults, [1]);
  const result = await a.run({ ...defaults, types: '10D' });
  assert.equal(result.result.count, 10); assert.equal(a.simulator.requests, before);
});

test('a city named after a state cannot make an unspecified location state a subset', async () => {
  assert.equal(placeWithin('location_1492', 'state_1334'), false);
  const location = corpus.find(c => c.location.id === 1492).location;
  const a = make(rawCourses(10).map(c => ({ ...c, location: structuredClone(location) })));
  await a.warm({ ...defaults, where: 'state_1334' }, [1]); const before = a.simulator.requests;
  const result = await a.run({ ...defaults, where: 'location_1492' });
  assert.equal(result.courses.length, 10); assert.equal(result.events.some(e => e.reused), false); assert.equal(a.simulator.requests - before, 1);
});

test('a refreshed last-page marker stops coverage before an older cached tail', async () => {
  const rows = rowsAtDhara(40), a = make(rows);
  await a.warm(defaults, [1]); await a.clock.advance(1000); await a.warm(defaults, [2,3,4]);
  await a.clock.advance(DAY - 1000); rows.splice(0);
  await a.warm(defaults, [1]); const before = a.simulator.requests;
  const result = await a.run({ ...defaults, types: '10D' });
  assert.equal(result.result.reason, 'end'); assert.equal(result.result.count, 0); assert.equal(result.result.pages, 1);
  assert.equal(a.simulator.requests, before);
});
