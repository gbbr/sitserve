import { readFileSync } from 'node:fs';
import corpus from '../fixtures/dhamma/corpus.json' with { type: 'json' };
import { rawPageFacts } from '../dhamma.js';
import { normalize } from '../normalize.js';
export const fixture = name => JSON.parse(readFileSync(new URL('../fixtures/dhamma/' + name, import.meta.url)));
export const rawTemplate = corpus.find(c => c.raw_course_type === '10-Day');
export const template = normalize(rawTemplate);
export class MemoryStorage {
  data = new Map(); alarm = null; alarmWrites = []; listCalls = 0;
  async get(key) { return structuredClone(this.data.get(key)); }
  async put(key, value) { this.data.set(key, structuredClone(value)); }
  async delete(key) { for (const k of Array.isArray(key) ? key : [key]) this.data.delete(k); }
  async list({ prefix = '', startAfter = '', limit = Infinity } = {}) { this.listCalls++; return new Map([...this.data].filter(([k]) => k.startsWith(prefix) && k > startAfter).sort(([a],[b]) => a.localeCompare(b)).slice(0,limit).map(([k, v]) => [k, structuredClone(v)])); }
  async getAlarm() { return this.alarm; }
  async setAlarm(at) { this.alarm = at; this.alarmWrites.push(at); }
  async fireAlarm(handler) { this.alarm = null; await handler(); }
}
export const tick = () => new Promise(resolve => setImmediate(resolve));
export async function until(fn) { for (let i = 0; i < 100; i++) { if (fn()) return; await tick(); } throw new Error('Condition not reached'); }
export class FakeClock {
  now = Date.parse('2026-11-14T12:00:00Z'); jobs = new Map(); id = 0;
  clock = () => this.now;
  setTimeout = (fn, ms) => { const id = ++this.id; this.jobs.set(id, { at: this.now + ms, fn }); return id; };
  clearTimeout = id => this.jobs.delete(id);
  async advance(ms) {
    const end = this.now + ms;
    while (true) {
      const next = [...this.jobs].sort((a, b) => a[1].at - b[1].at).find(([, j]) => j.at <= end);
      if (!next) break;
      this.now = next[1].at; this.jobs.delete(next[0]); next[1].fn(); await tick();
    }
    this.now = end; await tick();
  }
}
export const rawCourses = (n, { sameDate = false, closed = false } = {}) => Array.from({ length: n }, (_, i) => {
  const start = new Date(Date.parse('2026-11-15') + (sameDate ? 0 : i) * 86400000).toISOString().slice(0, 10);
  return { ...structuredClone(rawTemplate), id: 900000 + i, course_start_date: start, course_end_date: start,
    enrollment_open_date: '2026-01-01', status: [{ type: null, label: null, color: closed ? 'Red' : 'Green', status: closed ? 'Closed' : 'Open' }] };
});

export const pageWithFacts = page => ({ ...page, ...rawPageFacts(page.courses.map(c => ({ id: c.id, course_start_date: c.start }))) });
