import test from 'node:test';
import assert from 'node:assert/strict';
import { search, clampFilters } from '../search.js';
import { createSimulator } from '../simulator.js';
import { getDhammaPage } from '../dhamma.js';
import { normalizePage } from '../normalize.js';
import { filterDefaults } from '../../web/shared/courses.js';
import { rawCourses, template, pageWithFacts } from './helpers.js';
const today = '2026-11-14', f = filterDefaults(today);
async function run(rows, filters = f, extra = {}) {
  const simulator = createSimulator({ rows }), events = []; let calls = 0;
  const result = await search(filters,{ today, emit:e=>events.push(e), getPage:async p=>{
    calls++; return { page:normalizePage(await getDhammaPage(p,{ env:{ UPSTREAM:'simulator' },fetch:simulator.fetch,log:()=>{} })),fetchedAt:new Date(Date.parse('2026-11-14T12:00:00Z')-calls*60000).toISOString() };
  },...extra });
  return { result,events,calls,courses:events.filter(e=>e.type==='progress').flatMap(e=>e.courses) };
}
test('50 matches after filters, date order, progress each page and oldest checkedAt', async () => {
  const rows=rawCourses(200); rows.slice(0,30).forEach(c=>c.status=[{ type:null,label:null,status:'Closed',color:'Red' }]);
  const r=await run(rows); assert.equal(r.result.reason,'limit');assert.equal(r.courses.length,50);assert.equal(r.calls,8);
  assert.equal(r.events.filter(e=>e.type==='progress').length,8);assert.equal(r.result.checkedAt,'2026-11-14T11:52:00.000Z');
  assert.deepEqual(r.courses.map(c=>c.start),r.courses.map(c=>c.start).sort()); assert.equal(r.courses[0].id,900030);
});
test('cursor crosses query limit with inclusive-date dedupe', async () => {
  const rows=rawCourses(180);rows.slice(0,110).forEach(c=>c.status=[{ type:null,label:null,status:'Closed',color:'Red' }]);
  const r=await run(rows);assert.equal(r.result.reason,'limit');assert.equal(r.courses[0].id,900110);assert.equal(new Set(r.courses.map(c=>c.id)).size,50);assert.ok(r.calls>10);
});
test('300 courses on one date stop as partial, never loops', async () => {
  const r=await run(rawCourses(300,{ sameDate:true,closed:true }));assert.equal(r.result.reason,'same-date');assert.equal(r.calls,10);assert.equal(r.result.partial,true);assert.equal(r.result.searchedThrough,'2026-11-15');
});
test('2,000 courses with few matches hit the 20-page cap', async () => {
  const r=await run(rawCourses(2000,{ closed:true }));assert.equal(r.calls,20);assert.equal(r.result.reason,'cap');assert.equal(r.result.partial,true);
  assert.equal(r.result.searchedThrough,new Date(Date.parse('2026-11-15')+198*86400000).toISOString().slice(0,10));
});
test('cursor with no new ids stops partial', async () => {
  const rows=rawCourses(100,{closed:true}).map(c=>({ ...template,id:c.id,start:c.course_start_date,enroll:c.enrollment_open_date,status:c.status }));
  let calls=0;
  const r=await search(f,{today,getPage:async p=>{calls++;return {page:pageWithFacts({courses:rows.slice((p.page-1)*10,p.page*10),page:p.page,pages:10,pages_truncated:true}),fetchedAt:'2026-11-14T00:00:00Z'};}});
  assert.equal(r.reason,'nothing-new');assert.equal(calls,20);
});
test('end, empty, no applicable new-student types', async () => {
  for(const n of [0,1,13]) {const r=await run(rawCourses(n));assert.equal(r.result.reason,'end');assert.equal(r.courses.length,n);assert.equal(r.calls,Math.max(1,Math.ceil(n/10)));}
  const r=await run(rawCourses(3),{...f,types:'20D',as:'NM'});assert.equal(r.calls,0);
});
test('repeated last page does not loop or double count', async () => {
  let calls=0;const c={...template,start:'2026-12-01',enroll:'2026-01-01',status:[{type:null,status:'Open',color:'Green'}]};
  const r=await search(f,{today,getPage:async()=>({page:pageWithFacts({courses:[c],page:1,pages:2,pages_truncated:false}),fetchedAt:String(++calls)})});
  assert.equal(calls,2);assert.equal(r.count,1);assert.equal(r.reason,'end');
});
test('cancel before/during a page prevents any subsequent getPage calls', async () => {
  const controller=new AbortController();controller.abort();let calls=0;
  const r=await search(f,{today,signal:controller.signal,getPage:()=>{calls++;}});assert.equal(r.reason,'cancelled');assert.equal(calls,0);
  const active=new AbortController();
  const next=await run(rawCourses(200),f,{signal:active.signal,emit:e=>{if(e.type==='progress')active.abort();}});
  assert.equal(next.result.reason,'cancelled');assert.equal(next.calls,1);
});
test('clamp old From to yesterday, preserve future and leap dates', () => {
  assert.equal(clampFilters({...f,from:'2000-01-01'},today).from,'2026-11-13');assert.equal(clampFilters({...f,from:'2026-12-01'},today).from,'2026-12-01');assert.equal(clampFilters({...f,from:'2000-01-01'},'2028-03-01').from,'2028-02-29');
});
test('availability and language recheck happen before counting', async () => {
  const rows=rawCourses(60);rows.forEach(c=>{c.location.center_noncenter="center";c.course_instruction_languages=["English"];});rows.slice(0,10).forEach(c=>c.course_instruction_languages=['French']);rows.slice(10,20).forEach(c=>c.location.center_noncenter='noncenter');rows.slice(20,30).forEach(c=>c.status=[{type:'nm',label:null,status:'Open',color:'Green'}]);
  const r=await run(rows,{...f,lang:'en',centers:true,as:'OM'});assert.equal(r.courses.length,30);assert.equal(r.courses[0].id,900030);
});
test('limited cached-only responses retain earlier pages and checkedAt', async () => {
  let calls=0;
  const r=await search(f,{today,getPage:async()=>{if(++calls===2)throw Object.assign(new Error('allowance spent'),{code:'allowance'});return {page:pageWithFacts({courses:[{...template,start:'2026-12-01'}],page:1,pages:10}),fetchedAt:'2026-11-13T00:00:00Z'};}});
  assert.equal(r.reason,'allowance');assert.equal(r.partial,true);assert.equal(r.checkedAt,'2026-11-13T00:00:00Z');
});
test('empty cursor results stop as partial rather than claiming an exhausted search',async()=>{
  const rows=rawCourses(100,{closed:true}).map(c=>({...template,id:c.id,start:c.course_start_date,status:c.status,enroll:c.enrollment_open_date}));let calls=0;
  const result=await search(f,{today,getPage:async p=>({page:pageWithFacts(++calls>10?{courses:[],page:1,pages:1,pages_truncated:false}:{courses:rows.slice((p.page-1)*10,p.page*10),page:p.page,pages:10,pages_truncated:true}),fetchedAt:'2026-11-14T00:00:00Z'})});
  assert.equal(result.reason,'nothing-new');assert.equal(result.partial,true);assert.equal(calls,11);
});

test('pages containing only invalid courses still reach the raw page cap', async () => {
  const r = await run(rawCourses(2000).map(c => ({ ...c, location: null })));
  assert.equal(r.calls, 20); assert.equal(r.result.reason, 'cap'); assert.equal(r.result.count, 0); assert.equal(r.result.partial, true);
  assert.equal(r.result.searchedThrough, new Date(Date.parse('2026-11-15') + 198 * 86400000).toISOString().slice(0, 10));
});
test('same-date detection counts raw rows even when every normalized course is dropped', async () => {
  const r = await run(rawCourses(300, { sameDate: true }).map(c => ({ ...c, location: null })));
  assert.equal(r.calls, 10); assert.equal(r.result.reason, 'same-date'); assert.equal(r.result.partial, true);
  assert.equal(r.result.searchedThrough, '2026-11-15'); assert.equal(r.courses.length, 0);
});
test('an empty normalized page with raw rows does not end the search', async () => {
  const rows = rawCourses(11), events = []; let calls = 0;
  for (const [i, c] of rows.slice(0, 10).entries()) { if (i % 2) c.location = null; else c.raw_course_type = 'Unknown'; }
  const result = await search(f, { today, emit: e => events.push(e), getPage: async p => {
    calls++;
    const raw = { courses: rows.slice((p.page - 1) * 10, p.page * 10), page: p.page, pages: 2, total_rows: 11, pages_truncated: false };
    return { page: normalizePage(await getDhammaPage(p, { env: { UPSTREAM: 'simulator' }, fetch: async () => Response.json(raw), log: () => {} })), fetchedAt: '2026-11-14T00:00:00Z' };
  } });
  assert.equal(calls, 2); assert.equal(result.reason, 'end'); assert.equal(result.count, 1);
  assert.equal(events[0].courses.length, 0); assert.equal(events[0].searchedThrough, rows[9].course_start_date);
});
test('the cursor uses the last raw date when a truncated query contains only dropped courses', async () => {
  const rows = rawCourses(101), requests = [];
  rows.slice(0, 100).forEach(c => { c.raw_course_type = 'Unknown'; }); rows[99].location = null;
  const result = await search(f, { today, getPage: async p => {
    requests.push(p);
    const cursor = p.from === rows[99].course_start_date;
    const raw = { courses: cursor ? rows.slice(99) : rows.slice((p.page - 1) * 10, p.page * 10), page: p.page,
      pages: cursor ? 1 : 10, total_rows: cursor ? 2 : 101, pages_truncated: !cursor };
    return { page: normalizePage(await getDhammaPage(p, { env: { UPSTREAM: 'simulator' }, fetch: async () => Response.json(raw), log: () => {} })), fetchedAt: '2026-11-14T00:00:00Z' };
  } });
  assert.equal(requests.length, 11); assert.equal(requests[10].from, rows[99].course_start_date);
  assert.equal(result.reason, 'end'); assert.equal(result.count, 1); assert.equal(result.searchedThrough, rows[100].course_start_date);
});

// Listings of one course by two locations, like Dhamma Bhumi's copies of Dhamma Pāsāda's courses.
const BHUMI = { id: 1494, name: 'Dhamma Bhumi', venue: 'Dhamma Pasada', venueUrl: 'https://maps.example/pasada' };
const PASADA = { id: 1770, name: 'Dhamma Pāsāda', venue: 'Dhamma Pasada', venueUrl: 'https://maps.example/pasada' };
const FORM = 'https://mycourses.dhamma.org/en/enrolment/initial_enrolment_form/';
const listing = (id, loc, start = '2026-12-02', extra = {}) => ({ ...template, id, start, end: start, enroll: '2026-01-01', apply: '', comments: '',
  status: [{ type: null, label: null, status: 'Open', color: 'Green' }], ...extra, loc: { ...template.loc, ...loc } });
async function listed(pages, extra = {}) {
  const events = [];
  const result = await search(f, { today, emit: e => events.push(e), ...extra, getPage: async p => {
    const number = Math.min(p.page, pages.length);
    return { page: pageWithFacts({ courses: pages[number - 1], page: number, pages: pages.length, pages_truncated: false }), fetchedAt: '2026-11-14T00:00:00Z' };
  } });
  const progress = events.filter(e => e.type === 'progress');
  return { result, progress, ids: progress.flatMap(e => e.courses.map(c => c.id)) };
}
test('a copy and the listing of the center holding it count as one course, in either order and across pages', async () => {
  for (const page of [[listing(1, BHUMI), listing(2, PASADA)], [listing(2, PASADA), listing(1, BHUMI)]]) {
    const r = await listed([page]); assert.deepEqual(r.ids, [2]); assert.equal(r.result.count, 1);
  }
  const fillers = Array.from({ length: 9 }, (_, i) => listing(10 + i, {}, '2026-12-01'));
  const r = await listed([[...fillers, listing(1, BHUMI)], [listing(2, PASADA), listing(20, {}, '2026-12-03')]]);
  assert.deepEqual(r.progress[0].courses.map(c => c.id), fillers.map(c => c.id));
  assert.deepEqual(r.ids, [...fillers.map(c => c.id), 2, 20]); assert.equal(r.result.count, 11);
});
test('a copy without its center\'s listing appears once later dates are read, or when the search ends', async () => {
  let r = await listed([[listing(1, BHUMI), listing(3, {}, '2026-12-03')]]);
  assert.deepEqual(r.progress.map(e => e.courses.map(c => c.id)), [[1, 3]]);
  r = await listed([[listing(1, BHUMI)]]);
  assert.deepEqual(r.progress.map(e => e.courses.map(c => c.id)), [[], [1]]); assert.equal(r.result.count, 1); assert.equal(r.result.reason, 'end');
  r = await listed([[listing(1, BHUMI), listing(2, PASADA), listing(3, {}, '2026-12-03'), listing(4, {}, '2026-12-04')]], { limit: 2 });
  assert.deepEqual(r.ids, [2, 3]); assert.equal(r.result.reason, 'limit');
});
test('matching type and dates alone never merge listings', async () => {
  const other = { ...BHUMI, id: 1342, name: 'Dhamma Rasmi' }, form = { apply: FORM + 'A' };
  for (const pair of [
    [listing(1, { ...BHUMI, venue: '' }), listing(2, { ...PASADA, venue: '' })],
    [listing(1, BHUMI, undefined, { comments: '<p>Male students only</p>' }), listing(2, PASADA)],
    [listing(1, BHUMI, undefined, { status: [{ type: null, label: null, status: 'Wait List', color: 'Yellow' }] }), listing(2, PASADA)],
    [listing(1, BHUMI, undefined, { langs: ['Hindi'] }), listing(2, PASADA)],
    [listing(1, BHUMI, undefined, form), listing(2, PASADA, undefined, { apply: FORM + 'B' })],
    [listing(1, { ...BHUMI, venueUrl: 'https://maps.example/elsewhere' }), listing(2, PASADA)],
    [listing(1, { ...BHUMI, venue: 'Dhamma Nilaya' }), listing(2, { ...other, venue: 'Dhamma Nilaya' })],
    [listing(1, { ...BHUMI, venue: 'Moscow', venueUrl: '' }), listing(2, { ...other, venue: 'Moscow', venueUrl: '' })],
  ]) assert.deepEqual((await listed([pair])).ids.sort(), [1, 2], JSON.stringify(pair.map(c => c.loc.venue)));
});
test('a shared enrollment form merges listings whatever their venues', async () => {
  const form = { apply: FORM + 'Y3F1E2YbmHvAsIJ' };
  let r = await listed([[listing(1, { id: 1615, name: 'Southwest Vipassana Group', venue: 'Hohritt' }, undefined, form), listing(2, { id: 2607, name: 'Dhamma Sampatti', venue: '' }, undefined, form)]]);
  assert.deepEqual(r.ids, [1]);
  r = await listed([[listing(1, { id: 1615, name: 'Southwest Vipassana Group', venue: 'Dhamma Sampatti' }, undefined, form), listing(2, { id: 2607, name: 'Dhamma Sampatti', venue: '' }, undefined, form)]]);
  assert.deepEqual(r.ids, [2]);
});
