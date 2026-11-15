import { LOCATION_REGIONS, LOCATION_STATES } from '../web/places.js';
import { fold, places, placeByKey } from '../web/shared/courses.js';

export const QUERY_INDEX_KEY = 'query-index:v1';
export const MAX_QUERY_SEQUENCES = 32;
export function queryParams({ types, regions, language, from, end }) {
  return { types: [...new Set(types)].sort((a, b) => a - b), regions: [...new Set(regions)].sort(), language, from, end };
}
const countries = places.filter(p => p.kind === 'region' && p.tag === 'country');
const ancestors = new Map();
for (const path of Object.values(LOCATION_REGIONS)) for (const [i, id] of path.entries()) {
  if (!ancestors.has(id)) ancestors.set(id, new Set());
  for (const parent of path.slice(0, i)) ancestors.get(id).add(parent);
}
const countryOf = p => {
  if (p.kind === 'region') {
    if (p.tag === 'country') return p;
    return countries.find(c => ancestors.get(p.id)?.has(c.id))
      || countries.find(c => p.texts.some(t => /\.[a-z]{2}$/i.test(t) && c.texts.some(code => fold(code) === fold(t.split('.').at(-1)))));
  }
  if (p.kind === 'location') {
    const country = countries.find(c => LOCATION_REGIONS[p.id]?.includes(c.id));
    if (country) return country;
  }
  return countries.find(c => fold(p.text).endsWith(', ' + fold(c.text)));
};
const stateName = p => p.kind === 'region' ? p.text : p.texts[0];
const sameState = (a, b) => fold(stateName(a)) === fold(stateName(b)) && countryOf(a)?.id === countryOf(b)?.id && !!countryOf(a);
export function placeWithin(key, broaderKey, venues = new Map()) {
  if (key === broaderKey) return true;
  const s = placeByKey.get(key), q = placeByKey.get(broaderKey);
  if (!s || !q) return false;
  if (s.kind === 'region') {
    if (q.kind === 'region') {
      const country = s.tag === 'state' && countryOf(s);
      return ancestors.get(s.id)?.has(q.id) || !!country && (country.id === q.id || ancestors.get(country.id)?.has(q.id)) || false;
    }
    return q.kind === 'state' && s.tag === 'state' && sameState(s, q);
  }
  if (s.kind === 'location') {
    if (q.kind === 'region') return (LOCATION_REGIONS[s.id] || []).includes(q.id);
    return q.kind === 'state' && fold(LOCATION_STATES[s.id]) === fold(stateName(q)) && !!countryOf(s) && countryOf(s)?.id === countryOf(q)?.id;
  }
  if (s.kind === 'state' && q.tag === 'state' && q.kind === 'region') return sameState(s, q);
  if (s.kind === 'sublocation') {
    const parents = venues.get(s.id) || [];
    if (q.kind === 'location') return parents.length > 0 && parents.every(p => p.id === q.id);
    if (q.kind === 'state') return parents.length > 0 && parents.every(p => fold(p.state) === fold(stateName(q)) && fold(p.country) === fold(countryOf(q)?.text));
    if (q.kind === 'region' && parents.length) return parents.every(p => (LOCATION_REGIONS[p.id] || []).includes(q.id));
  }
  if (s.kind === 'state' && q.kind === 'region') {
    const country = countryOf(s);
    return !!country && (country.id === q.id || ancestors.get(country.id)?.has(q.id)) || false;
  }
  return false;
}
export function queryCovers(q, s, venues) {
  return q.end === s.end && s.from >= q.from && s.types.every(id => q.types.includes(id))
    && (!q.language || q.language === s.language)
    && (!q.regions.length || s.regions.length > 0 && s.regions.every(key => q.regions.some(parent => placeWithin(key, parent, venues))));
}
function summarize(sequence) {
  const prefix = [];
  for (let number = 1; number <= 10; number++) {
    const page = sequence.pages.find(p => p.number === number);
    if (!page) break;
    prefix.push(page);
    if (number >= page.lastPage) break;
  }
  const last = prefix.at(-1);
  sequence.contiguous = prefix.length;
  sequence.complete = !!last && last.number === last.lastPage && !last.truncated;
  sequence.coverageEnd = sequence.complete ? sequence.params.end : prefix.map(p => p.lastStart).filter(Boolean).at(-1) || null;
}
export class QueryIndex {
  constructor({ storage, clock, namespace, schema }) {
    Object.assign(this, { storage, clock, namespace, schema });
    this.ready = this.load();
  }
  async load() { this.sequences = await this.storage.get(QUERY_INDEX_KEY) || []; }
  prune() {
    const before = JSON.stringify(this.sequences);
    for (const sequence of this.sequences) {
      sequence.pages = sequence.pages.filter(p => p.expiresAt > this.clock());
      summarize(sequence);
    }
    this.sequences = this.sequences.filter(s => s.pages.length);
    return before !== JSON.stringify(this.sequences);
  }
  async save() { await this.storage.put(QUERY_INDEX_KEY, this.sequences); }
  async expire() { await this.ready; if (this.prune()) await this.save(); }
  async remove(key) {
    await this.ready;
    let changed = false;
    for (const sequence of this.sequences) {
      const pages = sequence.pages.filter(p => p.key !== key);
      if (pages.length !== sequence.pages.length) { sequence.pages = pages; summarize(sequence); changed = true; }
    }
    this.sequences = this.sequences.filter(s => s.pages.length);
    if (changed) await this.save();
  }
  async record(params, key, entry) {
    await this.ready;
    if (entry.page.page !== params.page || params.page > 10) return;
    this.prune();
    const normalized = queryParams(params), identity = JSON.stringify(normalized);
    let sequence = this.sequences.find(s => s.schema === this.schema && s.namespace === this.namespace && JSON.stringify(s.params) === identity);
    if (!sequence) sequence = { schema: this.schema, namespace: this.namespace, params: normalized, pages: [] };
    const venues = [];
    for (const { loc } of entry.page.courses) if (loc.subId && !venues.some(v => v.subId === loc.subId && v.id === loc.id && v.state === loc.state && v.country === loc.country))
      venues.push({ subId: loc.subId, id: loc.id, state: loc.state, country: loc.country });
    sequence.pages = sequence.pages.filter(p => p.number !== params.page);
    sequence.pages.push({ number: params.page, key, lastStart: entry.page.rawLastStart, lastPage: entry.page.pages,
      truncated: entry.page.pages_truncated, expiresAt: entry.expiresAt, venues });
    summarize(sequence);
    this.sequences = this.sequences.filter(s => s !== sequence);
    this.sequences.push(sequence);
    this.sequences = this.sequences.slice(-MAX_QUERY_SEQUENCES);
    await this.save();
  }
  async covering(params) {
    await this.expire();
    const venues = new Map();
    const current = this.sequences.filter(s => s.schema === this.schema && s.namespace === this.namespace);
    for (const s of current) for (const page of s.pages) for (const venue of page.venues) {
      if (!venues.has(venue.subId)) venues.set(venue.subId, []);
      venues.get(venue.subId).push(venue);
    }
    return current.filter(s => s.contiguous && s.coverageEnd && (s.complete || s.coverageEnd > params.from) && queryCovers(s.params, params, venues))
      .sort((a, b) => b.coverageEnd.localeCompare(a.coverageEnd) || Number(b.complete) - Number(a.complete) || a.contiguous - b.contiguous);
  }
}
