const path = require('node:path');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
async function startServer({ persistTo, vars = {} } = {}) {
  await import('./setup.js');
  const { unstable_startWorker } = require('wrangler');
  const dir = persistTo || await mkdtemp(path.join(os.tmpdir(), 'sitserve-test-'));
  const values = { UPSTREAM: 'simulator', SIMULATOR_DATE_SHIFT: '0', SITSERVE_TODAY: '2026-11-14', UPSTREAM_SPACING_MS: '0', VISITOR_SEARCHES_PER_MINUTE: '1000', ...vars };
  let worker;
  try {
    worker = await unstable_startWorker({
      config: 'wrangler.jsonc', entrypoint: 'worker/index.js',
      bindings: Object.fromEntries(Object.entries(values).map(([k,value]) => [k,{type:'plain_text',value}])),
      dev: { remote: false, persist: dir, server: { hostname: '127.0.0.1', port: 0 }, inspector: false, logLevel: 'error',
        outboundService: request => globalThis.fetch(request.url, {
          method: request.method, headers: request.headers, body: request.body, duplex: 'half',
        }) },
    });
    await worker.ready;
    let runtime;
    while (!(runtime = worker.raw.runtimes.find(r => r.mf)?.mf))
      await new Promise(resolve => worker.raw.once('reloadComplete', resolve));
    return { worker, url: (await worker.url).origin, directUrl: (await runtime.ready).origin, persistTo: dir,
      stop: () => worker.dispose(), cleanup: () => rm(dir, { recursive: true, force: true }) };
  } catch (error) { await worker?.dispose(); if (!persistTo) await rm(dir, {recursive:true,force:true}); throw error; }
}
module.exports = { startServer };
