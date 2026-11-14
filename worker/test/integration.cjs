const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./server.cjs');
const events = async response => (await response.text()).trim().split('\n').map(JSON.parse);

test('local Worker: static assets, NDJSON, validation, photos, and full restart persistence', { timeout: 60000 }, async t => {
  let server = await startServer();
  t.after(async () => { await server.stop(); await server.cleanup(); });
  const get = path => fetch(server.url + path);
  await t.test('serves the page and shared static modules; excludes tools and design', async () => {
    assert.match(await (await get('/')).text(), /<title>sitserve/);
    assert.equal((await get('/app.js')).status, 200); assert.equal((await get('/shared/courses.js')).status, 200);
    assert.equal((await get('/assets/flags/us.svg')).status, 200);
    for (const p of ['/tools/build-places.js', '/design.md']) assert.equal((await get(p)).status, 404);
  });
  let first;
  await t.test('streams start, progress and done, with no-store and 50 result limit', async () => {
    const r = await get('/api/search?from=2026-11-14'); assert.equal(r.status, 200);
    assert.equal(r.headers.get('Cache-Control'), 'no-store'); assert.match(r.headers.get('Content-Type'), /ndjson/);
    first = await events(r); assert.equal(first[0].type, 'start'); assert.equal(first[0].mode, 'simulator');
    assert.ok(first.some(e => e.type === 'progress')); assert.equal(first.at(-1).type, 'done');
    assert.equal(first.at(-1).count, 50); assert.ok(first.at(-1).checkedAt);
    const courses = first.filter(e => e.type === 'progress').flatMap(e => e.courses);
    assert.ok(courses.every(c => !c.loc.photo || c.loc.photo.startsWith('/photo/')));
  });
  await t.test('bad query parameters return 400 JSON; non-GET returns 405', async () => {
    const r=await get('/api/search?from=garbage');assert.equal(r.status,400);assert.match((await r.json()).message,/From/);
    assert.equal((await get('/api/search?as=wat')).status,400);
    assert.equal((await fetch(server.url+'/api/search',{method:'POST'})).status,405);
  });
  await t.test('same-origin photo placeholders and invalid photo paths', async () => {
    const r=await get('/photo/system/images/centers/test.jpg');assert.equal(r.status,200);assert.equal(r.headers.get('Content-Type'),'image/svg+xml');assert.equal(r.headers.get('Cache-Control'),'public, max-age=86400');assert.match(await r.text(),/simulated photo/);
    assert.equal((await get('/photo/not-an-image.txt')).status,400);
  });
  await t.test('complete shutdown/restart keeps pages, with zero simulator calls', async () => {
    assert.ok((await (await get('/api/debug')).json()).simulatorRequests>0);
    const persistTo=server.persistTo;await server.stop();server=await startServer({persistTo});
    assert.equal((await (await get('/api/debug')).json()).simulatorRequests,0);
    const second=await events(await get('/api/search?from=2026-11-14'));
    assert.equal(second.at(-1).checkedAt,first.at(-1).checkedAt);assert.equal(second.at(-1).count,50);
    assert.ok(second.filter(e=>e.type==='progress').every(e=>e.cacheHit));assert.equal((await (await get('/api/debug')).json()).simulatorRequests,0);
  });
});

test('real Worker streams sparse partial results and simulator failures never retry', { timeout: 60000 }, async t => {
  await t.test('twenty-page cap streams partial results with a searchedThrough date', async () => {
    const s=await startServer({vars:{SIMULATOR_SCENARIO:'sparse'}});
    try { const e=await events(await fetch(s.url+'/api/search?from=2026-11-14'));assert.equal(e.at(-1).reason,'cap');assert.equal(e.at(-1).partial,true);assert.equal(e.at(-1).pages,20);assert.equal(e.at(-1).count,1);assert.ok(e.at(-1).searchedThrough); }
    finally {await s.stop();await s.cleanup();}
  });
  for(const fault of ['429','503','html','malformed','slow']) await t.test(`fault ${fault} trips the persisted breaker`, async()=>{
    const s=await startServer({vars:{SIMULATOR_FAULT:fault,UPSTREAM_SLOW_MS:'10'}});
    try {
      const e=await events(await fetch(s.url+'/api/search?from=2026-11-14'));
      if (fault === 'slow') {
        assert.ok(e.some(e => e.type === 'progress' && e.courses.length));
        assert.equal(e.at(-1).reason, 'paused');
      } else assert.equal(e.at(-1).type,'error');
      const paused=await events(await fetch(s.url+'/api/search?from=2026-11-14'));assert.ok(paused.some(e=>e.code==='paused'));
      if (fault === 'slow') assert.ok(paused.some(e => e.type === 'progress' && e.cacheHit));
      assert.equal((await (await fetch(s.url+'/api/debug')).json()).simulatorRequests,1);
    }finally {await s.stop();await s.cleanup();}
  });
});

test('disconnect and newer same-IP searches stop subsequent upstream pages', { timeout: 30000 }, async()=>{
  const s=await startServer({vars:{SIMULATOR_DELAY_MS:'150',UPSTREAM_SPACING_MS:'200'}});
  try {
    const controller=new AbortController();
    const response=await fetch(s.directUrl+'/api/search?from=2026-11-14',{signal:controller.signal});const reader=response.body.getReader();
    await reader.read();controller.abort();await reader.cancel().catch(()=>{});
    await new Promise(resolve=>setTimeout(resolve,500));
    const debug=await (await fetch(s.directUrl+'/api/debug')).json();
    assert.ok(debug.simulatorRequests<=1);assert.equal(debug.activeSearches,0);
    const old=await fetch(s.directUrl+'/api/search?from=2026-12-01');const oldEvents=events(old);
    const newer=await events(await fetch(s.directUrl+'/api/search?from=2026-12-01&as=NM&types=20D'));
    assert.equal(newer.at(-1).count,0);assert.equal(newer.at(-1).reason,'end');
    const interrupted=await oldEvents;assert.equal(interrupted.filter(e=>e.type==='progress').length,0);
  }finally {await s.stop();await s.cleanup();}
});

test('explicit cancellation works through Wrangler proxy and is scoped to visitor and search id', {timeout:30000}, async()=>{
  const s=await startServer({vars:{SIMULATOR_DELAY_MS:'150',UPSTREAM_SPACING_MS:'200'}});
  const id='12345678-1234-1234-1234-123456789abc';
  try {
    const response=await fetch(s.url+'/api/search?from=2026-11-14',{headers:{'X-Sitserve-Search-Id':id}});
    const reading=events(response);
    const cancelled=await fetch(s.url+'/api/cancel?id='+id,{method:'POST'});assert.equal(cancelled.status,204);
    await reading;await new Promise(resolve=>setTimeout(resolve,250));
    const debug=await(await fetch(s.url+'/api/debug')).json();assert.equal(debug.activeSearches,0);assert.ok(debug.simulatorRequests<=1);
    assert.equal((await fetch(s.url+'/api/cancel?id=bad',{method:'POST'})).status,400);
  }finally {await s.stop();await s.cleanup();}
});

test('a persisted broader query answers a subset after full restart without simulator requests', { timeout: 30000 }, async () => {
  let s = await startServer();
  try {
    const broad = await events(await fetch(s.url + '/api/search?from=2026-11-14&where=region_117'));
    assert.equal(broad.at(-1).reason, 'end');
    assert.ok((await (await fetch(s.url + '/api/debug')).json()).simulatorRequests > 0);
    const persistTo = s.persistTo; await s.stop(); s = await startServer({ persistTo });
    const subset = await events(await fetch(s.url + '/api/search?from=2026-11-14&where=region_117&types=10D&lang=en'));
    assert.equal(subset.at(-1).reason, 'end'); assert.ok(subset.at(-1).count > 0);
    assert.equal(subset.at(-1).checkedAt, broad.at(-1).checkedAt);
    const progress = subset.filter(e => e.type === 'progress');
    assert.ok(progress.length > 0 && progress.every(e => e.cacheHit && e.reused));
    assert.ok(progress.flatMap(e => e.courses).every(c => c.type === '10-Day' && c.langs.includes('English')));
    assert.equal((await (await fetch(s.url + '/api/debug')).json()).simulatorRequests, 0);
  } finally { await s.stop(); await s.cleanup(); }
});
