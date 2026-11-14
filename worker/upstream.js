import { buildRequest, getDhammaPage, timedRequest, UpstreamError } from './dhamma.js';
import { normalizePage, escapeHTML, validPhotoPath } from './normalize.js';
import { createSimulator } from './simulator.js';
import { parseFilters } from '../web/shared/courses.js';
import { QueryIndex, queryParams } from './query-cache.js';
import { search, serverToday } from './search.js';
const HOUR = 3600000, DAY = 24 * HOUR;
const BREAKS = new Set(['429', '5xx', 'non-json', 'malformed', 'slow', 'timeout', 'network']);
export const CACHE_SCHEMA = 2;
export async function cacheKey(kind, params, namespace = 'simulator') {
  const bytes = new TextEncoder().encode(JSON.stringify([CACHE_SCHEMA, namespace, kind, params]));
  return `${kind}:` + [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export class UpstreamGate {
  constructor({ storage, fetch, clock = Date.now, timers = globalThis, env = {}, log = console.log }) {
    this.storage = storage; this.fetch = fetch; this.clock = clock; this.timers = timers; this.env = env; this.log = log;
    this.memory = new Map(); this.inflight = new Map(); this.queue = []; this.active = new Map(); this.running = false; this.cancelledSearches = new Map();
    this.namespace = `${env.UPSTREAM || 'simulator'}:${env.UPSTREAM !== 'live' && env.SIMULATOR_DATE_SHIFT === '1' ? serverToday(env, clock) : 'fixed'}:${env.SIMULATOR_SCENARIO || 'corpus'}`;
    this.queries = new QueryIndex({ storage, clock, namespace: this.namespace, schema: CACHE_SCHEMA });
    this.ready = this.load();
  }
  async load() {
    await this.queries.ready;
    this.meta = (await this.storage.get('meta')) || { requests: [], photos: [], visitors: {}, pausedUntil: 0, lastStarted: 0 };
  }
  prune() {
    const now = this.clock();
    this.meta.requests = this.meta.requests.filter(t => t > now - HOUR);
    this.meta.photos = this.meta.photos.filter(t => t > now - HOUR);
    for (const [ip, times] of Object.entries(this.meta.visitors)) {
      this.meta.visitors[ip] = times.filter(t => t > now - 60000);
      if (!this.meta.visitors[ip].length) delete this.meta.visitors[ip];
    }
  }
  async save() { await this.storage.put('meta', this.meta); }
  beginSearch(ip, id) {
    this.active.get(ip)?.controller.abort();
    const session = { ip, id, controller: new AbortController(), charged: false };
    for (const [key, at] of this.cancelledSearches) if (at <= this.clock()) this.cancelledSearches.delete(key);
    if (id && this.cancelledSearches.has(`${ip}:${id}`)) session.controller.abort();
    this.active.set(ip, session); return session;
  }
  cancelSearch(id, ip) {
    if (!id) return;
    for (const [key, at] of this.cancelledSearches) if (at <= this.clock()) this.cancelledSearches.delete(key);
    this.cancelledSearches.set(`${ip}:${id}`, this.clock() + 60000);
    if (this.cancelledSearches.size > 1000) this.cancelledSearches.delete(this.cancelledSearches.keys().next().value);
    for (const s of this.active.values()) if (s.id === id && s.ip === ip) s.controller.abort();
  }
  endSearch(session) { if (this.active.get(session.ip) === session) this.active.delete(session.ip); }
  cancelled(session) { if (session?.controller.signal.aborted) throw new UpstreamError('cancelled', 'Search cancelled.'); }
  async cached(key) {
    let value = this.memory.get(key) || await this.storage.get(key);
    if (value && value.expiresAt <= this.clock()) {
      await this.remove(key, value); value = null;
    }
    if (value) this.remember(key, value);
    return value;
  }
  remember(key, value) {
    this.memory.delete(key); this.memory.set(key, value);
    if (this.memory.size > 128) this.memory.delete(this.memory.keys().next().value);
  }
  async remove(key, value) {
    this.memory.delete(key); await this.storage.delete(key);
    if (key.startsWith('page:')) await this.queries.remove(key);
    if (value?.chunks) await this.storage.delete(Array.from({ length: value.chunks }, (_, i) => `${key}:${i}`));
  }
  async expire() {
    let next = Infinity;
    for (const prefix of ['page:', 'photo:']) {
      let startAfter;
      while (true) {
        const values = await this.storage.list({ prefix, limit: 64, ...(startAfter ? { startAfter } : {}) });
        for (const [key, value] of values) {
          if (value?.expiresAt <= this.clock()) await this.remove(key, value);
          else if (value?.expiresAt) next = Math.min(next, value.expiresAt);
        }
        if (values.size < 64) break;
        startAfter = [...values.keys()].at(-1);
      }
    }
    await this.queries.expire();
    if (Number.isFinite(next)) await this.scheduleExpiry(next);
  }
  async scheduleExpiry(expiresAt) {
    const pending = await this.storage.getAlarm();
    if (pending === null || expiresAt < pending) await this.storage.setAlarm(expiresAt);
  }
  async put(key, value) {
    await this.storage.put(key, value); this.remember(key, value);
    await this.scheduleExpiry(value.expiresAt);
  }
  async pause(retryAfter = 0) {
    this.meta.pausedUntil = this.clock() + Math.min(HOUR, Math.max(300000, retryAfter * 1000));
    await this.save();
  }
  async slowResponse(elapsedMs) {
    this.log(JSON.stringify({ event: 'upstream-slow', elapsedMs, at: new Date(this.clock()).toISOString() }));
    await this.pause();
  }
  async charge(session) {
    if (!session || session.charged) return;
    this.cancelled(session); this.prune();
    const times = this.meta.visitors[session.ip] || [];
    if (times.length >= +(this.env.VISITOR_SEARCHES_PER_MINUTE || 3))
      throw new UpstreamError('visitor-limit', 'Too many uncached searches. Wait a minute, then press Search.', Math.max(1, Math.ceil((times[0] + 60000 - this.clock()) / 1000)));
    times.push(this.clock()); this.meta.visitors[session.ip] = times; session.charged = true; await this.save();
  }
  async getPage(params, session) {
    await this.ready; this.cancelled(session);
    const normalized = { ...params, types: [...params.types].sort((a, b) => a - b), regions: [...params.regions].sort() };
    const key = await cacheKey('page', normalized, this.namespace), hit = await this.cached(key);
    this.cancelled(session);
    if (hit) {
      await this.queries.record(params, key, hit);
      this.cancelled(session);
      return { page: hit.page, fetchedAt: hit.fetchedAt, cacheHit: true };
    }
    await this.charge(session);
    return this.enqueue(key, session, 'requests', async () => {
      const page = normalizePage(await getDhammaPage(params, { env: this.env, fetch: this.fetch, clock: this.clock, timers: this.timers,
        timeout: +(this.env.UPSTREAM_TIMEOUT_MS || 20000), slow: +(this.env.UPSTREAM_SLOW_MS || 10000),
        log: this.log, onSlow: elapsed => this.slowResponse(elapsed) }));
      const fetchedAt = new Date(this.clock()).toISOString();
      const entry = { page, fetchedAt, expiresAt: this.clock() + DAY };
      await this.put(key, entry);
      await this.queries.record(params, key, entry);
      return { page, fetchedAt, cacheHit: false };
    });
  }
  async getCachedSequence(params, session) {
    await this.ready; this.cancelled(session);
    const candidates = await this.queries.covering(params);
    for (const sequence of candidates) {
      // Exact queries use their ordinary page cache, including the boundary date.
      if (JSON.stringify(sequence.params) === JSON.stringify(queryParams(params))) return null;
      const { contiguous, complete, coverageEnd } = sequence;
      const refs = sequence.pages.filter(p => p.number <= contiguous).sort((a, b) => a.number - b.number);
      const pages = [];
      for (const ref of refs) {
        this.cancelled(session);
        const entry = await this.cached(ref.key);
        if (!entry) break;
        pages.push({ page: entry.page, fetchedAt: entry.fetchedAt, cacheHit: true });
      }
      this.cancelled(session);
      if (pages.length === contiguous) return { pages, complete, coverageEnd };
    }
    return null;
  }
  enqueue(key, session, bucket, run) {
    this.cancelled(session);
    return new Promise((resolve, reject) => {
      let job = this.inflight.get(key);
      if (!job) { job = { key, bucket, run, waiters: [] }; this.inflight.set(key, job); this.queue.push(job); }
      const waiter = { resolve, reject, session };
      waiter.abort = () => {
        const i = job.waiters.indexOf(waiter); if (i >= 0) job.waiters.splice(i, 1);
        reject(new UpstreamError('cancelled', 'Search cancelled.'));
      };
      session?.controller.signal.addEventListener('abort', waiter.abort, { once: true });
      job.waiters.push(waiter);
      void this.pump();
    });
  }
  async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift();
        try {
          if (!job.waiters.length) continue;
          const spacing = +(this.env.UPSTREAM_SPACING_MS ?? (this.env.UPSTREAM === 'live' ? 1500 : 250));
          const wait = this.meta.lastStarted + spacing - this.clock();
          if (wait > 0) await new Promise(resolve => this.timers.setTimeout(resolve, wait));
          if (!job.waiters.length) continue;
          this.prune();
          if (this.meta.pausedUntil > this.clock()) throw new UpstreamError('paused', 'Upstream searches are paused. Try Search again later.', Math.ceil((this.meta.pausedUntil - this.clock()) / 1000));
          const times = this.meta[job.bucket], limit = +(job.bucket === 'photos' ? this.env.PHOTO_ALLOWANCE || 60 : this.env.UPSTREAM_ALLOWANCE || 100);
          if (times.length >= limit) throw new UpstreamError('allowance', 'The hourly upstream allowance is spent. Cached pages are still available.', Math.max(1, Math.ceil((times[0] + HOUR - this.clock()) / 1000)));
          // Configuration failures must not consume the allowance.
          if (this.env.UPSTREAM === 'live') buildRequest({ types: [3], regions: [], language: '', from: '2000-01-01', end: '2000-12-31', page: 1 }, this.env);
          this.meta.lastStarted = this.clock(); times.push(this.clock()); await this.save();
          this.log(JSON.stringify({ event: 'upstream', mode: this.env.UPSTREAM || 'simulator', bucket: job.bucket, requestsInHour: times.length, at: new Date(this.clock()).toISOString() }));
          const value = await job.run();
          for (const w of job.waiters) w.resolve(value);
        } catch (e) {
          if (BREAKS.has(e.code)) await this.pause(e.retryAfter || 0);
          for (const w of job.waiters) w.reject(e);
        } finally {
          for (const w of job.waiters) w.session?.controller.signal.removeEventListener('abort', w.abort);
          this.inflight.delete(job.key);
        }
      }
    } finally { this.running = false; }
  }
  async photo(path, session) {
    if (!validPhotoPath(path)) throw new UpstreamError('path', 'Invalid photo path.');
    if (this.env.UPSTREAM !== 'live') return { type: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="284" height="200" viewBox="0 0 284 200"><rect width="284" height="200" fill="#e8edf0"/><text x="142" y="90" text-anchor="middle" fill="#586171" font-family="sans-serif" font-size="13">simulated photo</text><text x="142" y="115" text-anchor="middle" fill="#586171" font-family="sans-serif" font-size="10">${escapeHTML(path.split('/').at(-1))}</text></svg>` };
    await this.ready;
    const key = await cacheKey('photo', path, 'live');
    const read = async hit => {
      const chunks = await Promise.all(Array.from({ length: hit.chunks }, (_, i) => this.storage.get(`${key}:${i}`)));
      const body = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
      let offset = 0; for (const c of chunks) { body.set(new Uint8Array(c), offset); offset += c.byteLength; }
      return { body, type: hit.type };
    };
    const hit = await this.cached(key); if (hit) return read(hit);
    return this.enqueue(key, session, 'photos', async () => {
      const identity = buildRequest({ types: [3], regions: [], language: '', from: '', end: '', page: 1 }, this.env).headers.get('User-Agent');
      const value = await timedRequest(new Request('https://www.dhamma.org' + path, { redirect: 'manual', headers: { 'User-Agent': identity, Accept: 'image/*' } }), {
        fetch: this.fetch, clock: this.clock, timers: this.timers, timeout: +(this.env.UPSTREAM_TIMEOUT_MS || 20000), slow: +(this.env.UPSTREAM_SLOW_MS || 10000),
        onSlow: elapsed => this.slowResponse(elapsed),
        decode: async r => {
          if (r.status === 429 || r.status >= 500) {
            const { readResponse } = await import('./dhamma.js'); await readResponse(r, this.clock);
          }
          if (!r.ok || !/^image\/(?:jpeg|png|gif|webp|avif|svg\+xml)(?:;|$)/i.test(r.headers.get('Content-Type') || ''))
            throw new UpstreamError('non-json', 'Upstream returned an invalid photo.');
          const body = await r.arrayBuffer();
          if (body.byteLength > 2 * 1024 * 1024) throw new UpstreamError('malformed', 'Upstream photo is too large.');
          return { type: r.headers.get('Content-Type'), body };
        },
      });
      const chunks = Math.ceil(value.body.byteLength / 65536);
      for (let i = 0; i < chunks; i++) await this.storage.put(`${key}:${i}`, value.body.slice(i * 65536, (i + 1) * 65536));
      await this.put(key, { chunks, type: value.type, expiresAt: this.clock() + 7 * DAY });
      return value;
    });
  }
}

export class UpstreamDurableObject {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env;
    this.simulator = env.UPSTREAM === 'live' ? null : createSimulator({ env });
    this.gate = new UpstreamGate({ storage: ctx.storage, env, fetch: this.simulator ? this.simulator.fetch : globalThis.fetch.bind(globalThis) });
  }
  async alarm() { await this.gate.ready; await this.gate.expire(); }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/internal/cancel' && request.method === 'POST') {
      this.gate.cancelSearch(request.headers.get('X-Sitserve-Search-Id'), request.headers.get('CF-Connecting-IP') || 'local');
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    }
    if (url.pathname === '/api/debug' && this.simulator) {
      await this.gate.ready;
      return Response.json({ simulatorRequests: this.simulator.requests, activeSearches: this.gate.active.size });
    }
    if (url.pathname.startsWith('/photo/')) {
      try {
        const photo = await this.gate.photo(url.pathname.slice('/photo'.length));
        return new Response(photo.body, { headers: { 'Content-Type': photo.type, 'Cache-Control': 'public, max-age=86400', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
      } catch (e) { return Response.json({ code: e.code, message: e.message }, { status: e.code === 'path' ? 400 : 503 }); }
    }
    let filters;
    try { filters = parseFilters(url.searchParams, { today: serverToday(this.env), strict: true }); }
    catch (e) { return Response.json({ message: e.message }, { status: 400, headers: { 'Cache-Control': 'no-store' } }); }
    const session = this.gate.beginSearch(request.headers.get('CF-Connecting-IP') || 'local', request.headers.get('X-Sitserve-Search-Id'));
    const abort = () => session.controller.abort();
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) abort();
    let closed = false;
    const stream = new ReadableStream({
      start: controller => {
        const emit = event => { if (!closed && !session.controller.signal.aborted) controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n')); };
        emit({ type: 'start', mode: this.simulator ? 'simulator' : 'live', searchId: session.id, today: serverToday(this.env), filters });
        const task = search(filters, { today: serverToday(this.env), signal: session.controller.signal,
          getPage: p => this.gate.getPage(p, session), getCachedSequence: p => this.gate.getCachedSequence(p, session), emit }).catch(e => {
          emit({ type: 'error', code: e.code || 'internal', message: e.message, retryAfter: e.retryAfter || 0 });
        }).finally(() => {
          this.gate.endSearch(session); request.signal.removeEventListener('abort', abort);
          if (!closed) { closed = true; controller.close(); }
        });
        this.ctx.waitUntil(task);
      },
      cancel: () => { closed = true; abort(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
}
