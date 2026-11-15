import test from 'node:test';
import assert from 'node:assert/strict';
import { UpstreamGate, cacheKey } from '../upstream.js';
import worker, { UpstreamDurableObject } from '../index.js';
import devWorker, { UpstreamDurableObject as DevUpstreamDurableObject } from '../dev.js';
import { requestParams } from '../dhamma.js';
import { queryParams } from '../query-cache.js';
import { filterDefaults } from '../../web/shared/courses.js';
import { FakeClock, MemoryStorage, fixture, until, tick } from './helpers.js';
const params=requestParams(filterDefaults('2026-11-14'),{today:'2026-11-14'});
const raw=fixture('verbatim/2026-11-14-probe-base.json');
function make({clock=new FakeClock(),storage=new MemoryStorage(),env={},fetch=async()=>Response.json(raw),log=()=>{}}={}) {
  let calls=0;
  const options={clock:clock.clock,timers:clock,storage,env:{UPSTREAM:'simulator',UPSTREAM_SPACING_MS:'0',...env},fetch:async r=>{calls++;return fetch(r);},log};
  return {gate:new UpstreamGate(options),clock,storage,options,get calls(){return calls;}};
}
test('the production DO requires a simulator factory for every non-live mode', () => {
  for (const env of [{}, { UPSTREAM: 'simulator' }, { UPSTREAM: 'invalid' }])
    assert.throws(() => new UpstreamDurableObject({ storage: new MemoryStorage() }, env), e => e.code === 'configuration' && /simulator factory/.test(e.message));
});
test('the dev entry shares the Worker and injects the simulator for searches, photos and debug', async () => {
  assert.equal(devWorker, worker);
  const tasks = [], object = new DevUpstreamDurableObject({ storage: new MemoryStorage(), waitUntil: task => tasks.push(task) },
    { UPSTREAM: 'simulator', SITSERVE_TODAY: '2026-11-14', SIMULATOR_DATE_SHIFT: '0', UPSTREAM_SPACING_MS: '0' });
  object.gate.log = () => {};
  const debug = () => object.fetch(new Request('https://sitserve.test/api/debug')).then(r => r.json());
  assert.deepEqual(await debug(), { simulatorRequests: 0, activeSearches: 0 });
  const response = await object.fetch(new Request('https://sitserve.test/api/search'));
  const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
  await Promise.all(tasks);
  assert.equal(events[0].mode, 'simulator'); assert.equal(events.at(-1).type, 'done'); assert.ok(events.at(-1).count > 0);
  const after = await debug(); assert.ok(after.simulatorRequests > 0); assert.equal(after.activeSearches, 0);
  const photo = await object.fetch(new Request('https://sitserve.test/photo/assets/test.png'));
  assert.equal(photo.headers.get('Content-Type'), 'image/svg+xml'); assert.match(await photo.text(), /simulated photo/);
  assert.deepEqual(await debug(), after);
});
test('page cache keys preserve the persisted parameter order and hashes', async () => {
  const today = '2026-11-14', defaults = filterDefaults(today), a = make({ env: { UPSTREAM: 'live', UPSTREAM_CONTACT: 'test@example.invalid' } });
  for (const [filters, options] of [
    [defaults, {}],
    [{ ...defaults, as: 'NM', where: 'region_402,location_1542', lang: 'en' }, { page: 2 }],
    [{ ...defaults, types: 'STP,3D,14D/TSC', from: '2027-02-01', lang: 'fr' }, { page: 10, today: '2027-01-01' }],
    [{ ...defaults, types: '10D', where: 'sublocation_13,region_24,location_1542' }, { from: '2026-12-01', page: 3 }],
  ]) {
    const p = requestParams(filters, { today, ...options });
    const old = { ...p, types: [...p.types].sort((a, b) => a - b), regions: [...p.regions].sort() };
    const normalized = { ...queryParams(p), page: p.page };
    assert.equal(JSON.stringify(normalized), JSON.stringify(old));
    const key = await cacheKey('page', old, a.gate.namespace);
    assert.equal(await cacheKey('page', normalized, a.gate.namespace), key);
    await a.gate.getPage(p); assert.ok(await a.storage.get(key));
  }
});
test('cache is normalized, lasts 24 hours, expires and survives new instances', async()=>{
  const a=make();const first=await a.gate.getPage(params);assert.equal(a.calls,1);assert.ok(first.page.courses[0].loc);assert.equal(first.cacheHit,false);
  await a.clock.advance(24*3600000-1);assert.equal((await a.gate.getPage(params)).cacheHit,true);assert.equal(a.calls,1);
  const next=new UpstreamGate(a.options);assert.equal((await next.getPage(params)).fetchedAt,first.fetchedAt);assert.equal(a.calls,1);
  await a.clock.advance(1);assert.equal((await next.getPage(params)).cacheHit,false);assert.equal(a.calls,2);
});
test('identical in-flight requests merge into one upstream request',async()=>{
  let release;const a=make({fetch:()=>new Promise(resolve=>{release=()=>resolve(Response.json(raw));})});
  const p=a.gate.getPage(params),q=a.gate.getPage({...params,types:[...params.types].reverse()});
  await until(()=>a.calls===1);await tick();assert.equal(a.calls,1);release();assert.deepEqual(await p,await q);
});
test('global FIFO, no overlapping requests and spacing between starts',async()=>{
  const starts=[],releases=[];let active=0,maxActive=0;const clock=new FakeClock();
  const a=make({clock,env:{UPSTREAM_SPACING_MS:'1500'},fetch:()=>new Promise(resolve=>{starts.push(clock.now);active++;maxActive=Math.max(maxActive,active);releases.push(()=>{active--;resolve(Response.json(raw));});})});
  const p=a.gate.getPage(params);await until(()=>a.calls===1);
  const q=a.gate.getPage({...params,page:2});const r=a.gate.getPage({...params,page:3});await tick();assert.equal(a.calls,1);
  releases.shift()();await p;await until(()=>clock.jobs.size>0);await clock.advance(1499);assert.equal(a.calls,1);await clock.advance(1);await until(()=>a.calls===2);
  releases.shift()();await q;await until(()=>clock.jobs.size>0);await clock.advance(1500);await until(()=>a.calls===3);releases.shift()();await r;
  assert.equal(maxActive,1);assert.deepEqual(starts,[Date.parse('2026-11-14T12:00:00Z'),Date.parse('2026-11-14T12:00:01.500Z'),Date.parse('2026-11-14T12:00:03Z')]);
});
test('spent rolling allowance permits cached pages only and persists',async()=>{
  const a=make({env:{UPSTREAM_ALLOWANCE:'1'}});await a.gate.getPage(params);
  const b=new UpstreamGate(a.options);assert.equal((await b.getPage(params)).cacheHit,true);
  await assert.rejects(b.getPage({...params,page:2}),e=>e.code==='allowance');assert.equal(a.calls,1);
  await a.clock.advance(3600000);await b.getPage({...params,page:2});assert.equal(a.calls,2);
});
test('new search cancels old same-IP requests, queued requests are dropped',async()=>{
  let release;const a=make({fetch:()=>new Promise(resolve=>{release=()=>resolve(Response.json(raw));})});
  const first=a.gate.beginSearch('a');const p=a.gate.getPage(params,first);await until(()=>a.calls===1);
  const queued=a.gate.beginSearch('b');const q=a.gate.getPage({...params,page:2},queued);const rejected=assert.rejects(q,e=>e.code==='cancelled');await until(()=>a.gate.queue.length===1);
  a.gate.beginSearch('b');await rejected;assert.equal(queued.controller.signal.aborted,true);
  release();await p;await tick();assert.equal(a.calls,1);assert.equal(a.gate.queue.length,0);
  a.gate.beginSearch('a');assert.equal(first.controller.signal.aborted,true);
});
test('cancelling one merged subscriber preserves the other',async()=>{
  let release;const a=make({fetch:()=>new Promise(resolve=>{release=()=>resolve(Response.json(raw));})});
  const one=a.gate.beginSearch('a'),two=a.gate.beginSearch('b');
  const p=a.gate.getPage(params,one),q=a.gate.getPage(params,two);const rejected=assert.rejects(p,e=>e.code==='cancelled');
  await until(()=>a.calls===1);await until(()=>[...a.gate.inflight.values()][0].waiters.length===2);one.controller.abort();await rejected;release();await q;assert.equal(a.calls,1);
});
test('three uncached searches per minute per IP; cached-only searches free',async()=>{
  const a=make();
  for(let i=1;i<=3;i++) {const s=a.gate.beginSearch('a');await a.gate.getPage({...params,page:i},s);await a.gate.getPage({...params,page:i+3},s);a.gate.endSearch(s);}
  await a.gate.getPage(params,a.gate.beginSearch('a'));
  const b=new UpstreamGate(a.options);await assert.rejects(b.getPage({...params,page:7},b.beginSearch('a')),e=>e.code==='visitor-limit');
  await b.getPage({...params,page:7},b.beginSearch('b'));
  await a.clock.advance(60000);await b.getPage({...params,page:8},b.beginSearch('a'));assert.equal(a.calls,8);
});
for(const code of ['429','5xx','http','non-json','malformed','timeout','network']) test(`breaker persists for ${code}, caches still served, no retry`,async()=>{
  let fail=false;const clock=new FakeClock();
  const a=make({clock,env:{UPSTREAM_TIMEOUT_MS:'20',UPSTREAM_SLOW_MS:'10'},fetch:async()=>{
    if(!fail)return Response.json(raw);
    if(code==='429')return new Response('',{status:429,headers:{'Retry-After':'900'}});
    if(code==='5xx')return new Response('',{status:503});
    if(code==='http')return new Response('<html>blocked</html>',{status:403,headers:{'Content-Type':'text/html'}});
    if(code==='non-json')return new Response('<html>challenge</html>',{headers:{'Content-Type':'text/html'}});
    if(code==='malformed')return Response.json({});
    if(code==='timeout')return new Promise(()=>{});
    throw new Error('transport');
  }});
  await a.gate.getPage(params);fail=true;
  const rejected=assert.rejects(a.gate.getPage({...params,page:2}),e=>e.code===code);
  if(code==='timeout'){await until(()=>a.calls===2);await clock.advance(20);}await rejected;
  const b=new UpstreamGate(a.options);assert.equal((await b.getPage(params)).cacheHit,true);
  await assert.rejects(b.getPage({...params,page:3}),e=>e.code==='paused'&&e.retryAfter===(code==='429'?900:300));assert.equal(a.calls,2);
  fail=false;await clock.advance(code==='429'?900000:300000);await b.getPage({...params,page:3});assert.equal(a.calls,3);
});
test('Retry-After breaker has a one-hour maximum',async()=>{
  const a=make({fetch:async()=>new Response('',{status:429,headers:{'Retry-After':'999999'}})});
  await assert.rejects(a.gate.getPage(params));assert.equal(a.gate.meta.pausedUntil-a.clock.now,3600000);
});
test('photo placeholders are offline, safe paths only',async()=>{
  const a=make();const image=await a.gate.photo('/system/images/centers/test.jpg');assert.equal(image.type,'image/svg+xml');assert.match(image.body,/simulated photo/);assert.equal(a.calls,0);
  for(const p of ['/evil.jpg','/assets/../x.jpg','/assets/%2f/x.jpg','/assets/x.html','//assets/x.png']) await assert.rejects(a.gate.photo(p),e=>e.code==='path');
});
test('photo cache persists seven days, has its own allowance and uses plain identity',async()=>{
  const a=make({env:{UPSTREAM:'live',UPSTREAM_CONTACT:'test@example.invalid',PHOTO_ALLOWANCE:'1'},fetch:async r=>{
    assert.match(r.headers.get('User-Agent'),/^sitserve\//);for(const h of ['Cookie','Origin','Referer'])assert.equal(r.headers.get(h),null);
    return new Response(new Uint8Array(140000).fill(42),{headers:{'Content-Type':'image/jpeg'}});
  }});
  const path='/system/images/centers/test.jpg';const first=await a.gate.photo(path);assert.equal(first.body.byteLength,140000);
  const key = await cacheKey('photo', path, 'live');
  assert.equal((await a.storage.get(key)).chunks, 3);
  for (let i = 0; i < 3; i++) {
    assert.ok(await a.storage.get(`chunk:${key}:${i}`)); assert.equal(await a.storage.get(`${key}:${i}`), undefined);
  }
  const next=new UpstreamGate(a.options);assert.deepEqual((await next.photo(path)).body,new Uint8Array(140000).fill(42));assert.equal(a.calls,1);
  await assert.rejects(next.photo('/assets/other.jpg'),e=>e.code==='allowance');
  await a.clock.advance(7*86400000-1);await next.photo(path);assert.equal(a.calls,1);await a.clock.advance(1);await next.photo(path);assert.equal(a.calls,2);
});
test('daily usage counts started requests per UTC day, without cache hits or refusals',async()=>{
  const a=make();await a.gate.getPage(params);await a.gate.getPage(params);await a.gate.getPage({...params,page:2});
  assert.deepEqual(a.gate.usage(),{date:'2026-11-14',requests:2,photos:0});
  const next=new UpstreamGate(a.options);await next.ready;assert.equal(next.usage().requests,2);
  await a.clock.advance(12*3600000);assert.deepEqual(a.gate.usage(),{date:'2026-11-15',requests:0,photos:0});
  const b=make({env:{UPSTREAM:'live',UPSTREAM_CONTACT:'test@example.invalid',PHOTO_ALLOWANCE:'1'},fetch:async()=>new Response(new Uint8Array(10),{headers:{'Content-Type':'image/jpeg'}})});
  await b.gate.photo('/assets/a.jpg');await b.gate.photo('/assets/a.jpg');await assert.rejects(b.gate.photo('/assets/b.jpg'),e=>e.code==='allowance');
  assert.deepEqual(b.gate.usage(),{date:'2026-11-14',requests:0,photos:1});
});
test('missing live identity sends no requests and spends no allowance',async()=>{
  const a=make({env:{UPSTREAM:'live'}});await assert.rejects(a.gate.getPage(params),e=>e.code==='configuration');
  await assert.rejects(a.gate.photo('/assets/test.png'), e => e.code === 'configuration');
  assert.equal(a.calls,0);assert.equal(a.gate.meta.requests.length,0);assert.equal(a.gate.meta.photos.length,0);
});
test('search-id cancellation is scoped to IP and handles cancellation before registration',async()=>{
  const a=make(),s=a.gate.beginSearch('a','first');
  a.gate.cancelSearch('other','a');a.gate.cancelSearch('first','b');assert.equal(s.controller.signal.aborted,false);
  a.gate.cancelSearch('first','a');assert.equal(s.controller.signal.aborted,true);
  a.gate.cancelSearch('later','a');assert.equal(a.gate.beginSearch('a','later').controller.signal.aborted,true);
  await a.clock.advance(60001);assert.equal(a.gate.beginSearch('a','later').controller.signal.aborted,false);
});
test('writes schedule only missing or earlier alarms and never scan stored entries', async () => {
  const a = make(), now = a.clock.now;
  await a.gate.put('page:first', { expiresAt: now + 100 });
  await a.gate.put('photo:later', { expiresAt: now + 200 });
  const restarted = new UpstreamGate(a.options);
  await restarted.put('page:later', { expiresAt: now + 150 });
  assert.deepEqual(a.storage.alarmWrites, [now + 100]);
  await restarted.put('page:earlier', { expiresAt: now + 50 });
  assert.deepEqual(a.storage.alarmWrites, [now + 100, now + 50]);
  assert.equal(a.storage.listCalls, 0);
});
test('alarms sweep expired pages and photo chunks, then reschedule until storage is empty', async () => {
  const a = make(), now = a.clock.now;
  await a.gate.put('photo:early', { expiresAt: now + 50, chunks: 2 });
  for (let i = 0; i < 2; i++) await a.storage.put(`chunk:photo:early:${i}`, new Uint8Array([i]));
  await a.gate.put('photo:legacy', { expiresAt: now + 100, chunks: 2 });
  for (let i = 0; i < 2; i++) await a.storage.put(`photo:legacy:${i}`, new Uint8Array([i]));
  await a.storage.put('photo:orphan:0', new Uint8Array([1]));
  await a.gate.put('page:middle', { expiresAt: now + 100 });
  await a.gate.put('photo:last', { expiresAt: now + 150, chunks: 1 });
  await a.storage.put('chunk:photo:last:0', new Uint8Array([2]));
  const listed = [], list = a.storage.list.bind(a.storage);
  a.storage.list = async options => { const values = await list(options); listed.push(...values.keys()); return values; };
  await a.clock.advance(50); await a.storage.fireAlarm(() => a.gate.expire());
  assert.equal(await a.storage.get('photo:early'), undefined);
  assert.equal(await a.storage.get('chunk:photo:early:0'), undefined);
  assert.equal(await a.storage.get('chunk:photo:early:1'), undefined);
  assert.equal(await a.storage.get('photo:orphan:0'), undefined);
  assert.ok(await a.storage.get('photo:legacy:0')); assert.ok(await a.storage.get('photo:legacy:1'));
  assert.ok(await a.storage.get('chunk:photo:last:0'));
  assert.equal(await a.storage.getAlarm(), now + 100);
  await a.clock.advance(50); await a.storage.fireAlarm(() => a.gate.expire());
  assert.equal(await a.storage.get('photo:legacy'), undefined);
  assert.equal(await a.storage.get('photo:legacy:0'), undefined); assert.equal(await a.storage.get('photo:legacy:1'), undefined);
  assert.equal(await a.storage.get('page:middle'), undefined); assert.equal(await a.storage.getAlarm(), now + 150);
  await a.clock.advance(50); await a.storage.fireAlarm(() => a.gate.expire());
  assert.ok(listed.every(key => !key.startsWith('chunk:')));
  assert.equal((await list()).size, 0); assert.equal(await a.storage.getAlarm(), null);
});
test('stored photos with legacy chunks remain readable through sweeps and are removed on expiry', async () => {
  const a = make({ env: { UPSTREAM: 'live', UPSTREAM_CONTACT: 'test@example.invalid' } }), path = '/assets/legacy.png';
  const key = await cacheKey('photo', path, 'live'), expiresAt = a.clock.now + 100;
  await a.storage.put(key, { chunks: 2, type: 'image/png', expiresAt });
  await a.storage.put(`${key}:0`, new Uint8Array([1, 2]).buffer); await a.storage.put(`${key}:1`, new Uint8Array([3]).buffer);
  const restarted = new UpstreamGate(a.options);
  assert.deepEqual((await restarted.photo(path)).body, new Uint8Array([1, 2, 3]));
  await restarted.expire();
  assert.deepEqual((await restarted.photo(path)).body, new Uint8Array([1, 2, 3])); assert.equal(a.calls, 0);
  await a.clock.advance(100); assert.equal(await restarted.cached(key), null);
  assert.equal(await a.storage.get(`${key}:0`), undefined); assert.equal(await a.storage.get(`${key}:1`), undefined);
});
test('reads delete an expired entry without sweeping other stored pages', async () => {
  const a = make(), now = a.clock.now;
  await a.gate.put('page:first', { expiresAt: now + 10 });
  await a.gate.put('page:second', { expiresAt: now + 10 });
  await a.clock.advance(10); assert.equal(await a.gate.cached('page:first'), null);
  assert.equal(await a.storage.get('page:first'), undefined);
  assert.ok(await a.storage.get('page:second')); assert.equal(a.storage.listCalls, 0);
});
test('photos and pages share the breaker and queue but have independent hourly allowances',async()=>{
  let fail=false;
  const a=make({env:{UPSTREAM:'live',UPSTREAM_CONTACT:'test@example.invalid',PHOTO_ALLOWANCE:'2',UPSTREAM_ALLOWANCE:'1'},fetch:async r=>{
    if(r.url.endsWith('/do_search'))return Response.json(raw);
    return fail?new Response('<html>challenge</html>',{headers:{'Content-Type':'text/html'}}):new Response('image',{headers:{'Content-Type':'image/png'}});
  }});
  const path='/assets/test.png';await a.gate.photo(path);await a.gate.getPage(params);
  await assert.rejects(a.gate.getPage({...params,page:2}),e=>e.code==='allowance');
  fail=true;await assert.rejects(a.gate.photo('/assets/fail.png'),e=>e.code==='non-json');
  assert.equal((await a.gate.getPage(params)).cacheHit,true);assert.equal((await a.gate.photo(path)).type,'image/png');
  await assert.rejects(a.gate.photo('/assets/new.png'),e=>e.code==='paused');
});

test('a malformed course is logged and skipped while its page is cached without a pause', async () => {
  const logs = [], page = structuredClone(raw); page.courses[0].location = null;
  const a = make({ fetch: async () => Response.json(page), log: line => logs.push(JSON.parse(line)) });
  const result = await a.gate.getPage(params);
  assert.equal(result.page.courses.length, 9); assert.equal(result.page.rawCount, 10);
  assert.equal(result.page.rawFirstStart, raw.courses[0].course_start_date);
  assert.equal(result.page.rawLastStart, raw.courses.at(-1).course_start_date);
  assert.equal(a.gate.meta.pausedUntil, 0); assert.equal(logs.filter(l => l.event === 'invalid-course').length, 1);
  assert.equal((await a.gate.getPage(params)).cacheHit, true);
  await a.gate.getPage({ ...params, page: 2 }); assert.equal(a.calls, 2);
});
test('slow valid pages are returned and persisted while subsequent uncached requests pause', async () => {
  const clock = new FakeClock(), logs = [];
  const a = make({ clock, env: { UPSTREAM_SLOW_MS: '10' }, log: line => logs.push(JSON.parse(line)), fetch: async () => {
    clock.now += 11; return Response.json(raw);
  } });
  const first = await a.gate.getPage(params);
  assert.equal(first.page.courses.length, 10); assert.equal(first.cacheHit, false);
  assert.equal(a.gate.meta.pausedUntil - clock.now, 300000); assert.equal(logs.filter(l => l.event === 'upstream-slow').length, 1);
  const restarted = new UpstreamGate(a.options), cached = await restarted.getPage(params);
  assert.equal(cached.cacheHit, true); assert.deepEqual(cached.page, first.page); assert.equal(cached.fetchedAt, first.fetchedAt);
  await assert.rejects(restarted.getPage({ ...params, page: 2 }), e => e.code === 'paused'); assert.equal(a.calls, 1);
});
test('slow valid photos are returned and persisted while the shared gate pauses', async () => {
  const clock = new FakeClock();
  const a = make({ clock, env: { UPSTREAM: 'live', UPSTREAM_CONTACT: 'test@example.invalid', UPSTREAM_SLOW_MS: '10' }, fetch: async () => {
    clock.now += 11; return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } });
  } });
  const path = '/assets/slow.png', photo = await a.gate.photo(path);
  assert.deepEqual(new Uint8Array(photo.body), new Uint8Array([1, 2, 3]));
  assert.equal(a.gate.meta.pausedUntil - clock.now, 300000);
  const restarted = new UpstreamGate(a.options);
  assert.deepEqual((await restarted.photo(path)).body, new Uint8Array([1, 2, 3]));
  await assert.rejects(restarted.photo('/assets/other.png'), e => e.code === 'paused'); assert.equal(a.calls, 1);
});
test('redirects and other unsuccessful statuses pause pages and photos', async () => {
  for (const [status, photo] of [[302, false], [404, false], [301, true], [403, true]]) {
    const a = make({ env: { UPSTREAM: 'live', UPSTREAM_CONTACT: 'test@example.invalid' },
      fetch: async () => new Response('', { status, headers: { Location: 'https://www.dhamma.org/challenge' } }) });
    await assert.rejects(photo ? a.gate.photo('/assets/a.png') : a.gate.getPage(params), e => e.code === 'http');
    assert.equal(a.gate.meta.pausedUntil - a.clock.now, 300000, `${status} ${photo ? 'photo' : 'page'}`);
  }
});
test('a missing or oversized photo is remembered for a day without pausing the gate', async () => {
  const a = make({ env: { UPSTREAM: 'live', UPSTREAM_CONTACT: 'test@example.invalid' }, fetch: async r => {
    if (r.url.endsWith('/do_search')) return Response.json(raw);
    if (r.url.endsWith('/large.png')) return new Response(new Uint8Array(2 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'image/png' } });
    return new Response('Not found', { status: r.url.endsWith('/gone.png') ? 410 : 404, headers: { 'Content-Type': 'text/html' } });
  } });
  for (const path of ['/assets/missing.png', '/assets/gone.png', '/assets/large.png'])
    await assert.rejects(a.gate.photo(path), e => e.code === 'missing', path);
  assert.equal(a.gate.meta.pausedUntil, 0); assert.equal((await a.gate.getPage(params)).cacheHit, false);
  const restarted = new UpstreamGate(a.options);
  await assert.rejects(restarted.photo('/assets/missing.png'), e => e.code === 'missing'); assert.equal(a.calls, 4);
  await a.clock.advance(24 * 3600000);
  await assert.rejects(restarted.photo('/assets/missing.png'), e => e.code === 'missing'); assert.equal(a.calls, 5);
});
test('the photo route answers 404 for a missing photo', async () => {
  const object = new UpstreamDurableObject({ storage: new MemoryStorage() }, { UPSTREAM: 'live', UPSTREAM_CONTACT: 'test@example.invalid', UPSTREAM_SPACING_MS: '0' });
  let calls = 0;
  object.gate.log = () => {}; object.gate.fetch = async () => { calls++; return new Response('', { status: 404 }); };
  for (let i = 0; i < 2; i++) assert.equal((await object.fetch(new Request('https://sitserve.test/photo/assets/missing.png'))).status, 404);
  assert.equal(calls, 1);
});
