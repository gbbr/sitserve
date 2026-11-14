import corpus from './fixtures/dhamma/corpus.json' with { type: 'json' };
import { TYPES, placeByKey, placeMatches, languageNames, utcToday } from '../web/shared/courses.js';
const IDS = new Map(TYPES.map(([raw, , , id]) => [raw, id]).concat([
  ['1-DayOSC', 5], ['2-DayOSC', 19], ['4-hrOSC', 25], ['OSProgram', 24], ['OpenHouse', 15], ['Other', 26],
  ['ServicePeriod', 7], ['7-DayTeen', 30], ['Child', 13], ['Child-Teen', 14], ['Teen', 8],
]));
export const weekShift = today => Math.round((Date.parse(today) - Date.parse('2026-11-14')) / (7 * 86400000)) * 7;
export function shiftCorpus(rows, days) {
  const shift = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
    const date = new Date(value); if (!Number.isFinite(+date)) return value;
    date.setUTCDate(date.getUTCDate() + days);
    return value.length === 10 ? date.toISOString().slice(0, 10) : date.toISOString();
  };
  return rows.map(c => {
    const o = structuredClone(c);
    for (const k of Object.keys(o)) o[k] = shift(o[k]);
    o.location.local_time = shift(o.location.local_time);
    return o;
  });
}
export function sparseCorpus(rows = corpus) {
  const template = rows.find(c => c.raw_course_type === '10-Day');
  return Array.from({ length: 2000 }, (_, i) => {
    const start = new Date(Date.parse('2026-11-14') + i * 86400000).toISOString().slice(0, 10);
    return { ...structuredClone(template), id: 990000 + i, course_start_date: start, course_end_date: start,
      enrollment_open_date: '2026-01-01', course_instruction_languages: ['English'],
      status: [{ type: null, label: null, status: i === 105 ? 'Open' : 'Closed', color: i === 105 ? 'Green' : 'Red' }] };
  });
}
export function createSimulator({ rows = corpus, env = {}, clock = Date.now, timers = globalThis, onRequest = () => {} } = {}) {
  if (env.SIMULATOR_SCENARIO === 'sparse') rows = sparseCorpus(rows);
  const data = env.SIMULATOR_DATE_SHIFT === '1' ? shiftCorpus(rows, weekShift(utcToday(clock))) : rows;
  let requests = 0;
  const fetch = async request => {
    if (request.url !== 'https://www.dhamma.org/en-US/courses/do_search' || request.method !== 'POST') throw new Error('Simulator requires a real do_search POST Request');
    requests++; onRequest(requests);
    const delay = +(env.SIMULATOR_DELAY_MS || 0);
    if (delay) await new Promise((resolve, reject) => {
      const id = timers.setTimeout(resolve, delay);
      request.signal.addEventListener('abort', () => { timers.clearTimeout(id); reject(new Error('Aborted')); }, { once: true });
    });
    const fault = env.SIMULATOR_FAULT;
    if (fault === 'slow') await new Promise(resolve => timers.setTimeout(resolve, +(env.UPSTREAM_SLOW_MS || 10000) + 25));
    if (fault === '429' || fault === '503') return new Response('Unavailable', { status: +fault, headers: { 'Retry-After': '300' } });
    if (fault === 'html') return new Response('<html>Challenge</html>', { headers: { 'Content-Type': 'text/html' } });
    if (fault === 'malformed') return new Response('{"courses":', { headers: { 'Content-Type': 'application/json' } });
    const p = new URLSearchParams(await request.text());
    const types = p.getAll('course_type_constraint[]').map(Number), regions = p.getAll('regions[]'), languages = p.getAll('languages[]');
    const [from = '', end = '9999-12-31'] = (p.get('daterange') || '').split(' - ');
    const found = data.filter(c => types.includes(IDS.get(c.raw_course_type)) && c.course_start_date >= from && c.course_end_date <= end
      && (!languages.length || languages.some(code => c.course_instruction_languages.includes(languageNames.get(code))))
      && (!regions.length || regions.some(key => {
        const place = placeByKey.get(key);
        return place && placeMatches({ loc: { id: c.location.id, subId: c.location.sub_location_id, state: c.location.state, country: c.location.country } }, place);
      }))).sort((a, b) => a.course_start_date.localeCompare(b.course_start_date) || a.id - b.id);
    const pages = Math.max(1, Math.min(10, Math.ceil(found.length / 10)));
    const page = Math.min(pages, Math.max(1, +p.get('page') || 1));
    const saved = {};
    for (const [k, v] of p) if (!['daterange', 'page', 'sort_column', 'sort_direction', 'date_format', 'page_size', 'per_page', 'course_type_constraint[]'].includes(k)) {
      if (k.endsWith('[]')) (saved[k.slice(0, -2)] ||= []).push(v); else saved[k] = v;
    }
    return Response.json({ courses: found.slice((page - 1) * 10, page * 10), page, pages, total_rows: found.length,
      formatted_total_rows: found.length.toLocaleString('en-US'), pages_truncated: found.length > 100,
      saved_search_uuid: 'sitserve-simulator', saved_search_params: saved });
  };
  return { fetch, get requests() { return requests; } };
}
