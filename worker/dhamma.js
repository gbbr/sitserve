import { searchTypeIDs, utcToday, validDate } from '../web/shared/courses.js';
export const SEARCH_URL = 'https://www.dhamma.org/en-US/courses/do_search';
export const VERSION = '1.0.0';
export class UpstreamError extends Error {
  constructor(code, message, retryAfter = 0) { super(message); this.name = 'UpstreamError'; this.code = code; this.retryAfter = retryAfter; }
}
export function requestParams(filters, { today = utcToday(), page = 1, from = filters.from } = {}) {
  return { types: searchTypeIDs(filters), regions: filters.where ? [...filters.where.split(',')].sort() : [],
    language: filters.lang, from, end: `${+today.slice(0, 4) + 2}-12-31`, page };
}
export function buildRequest(params, env = {}) {
  if (!params.types.length) return null;
  if (env.UPSTREAM === 'live' && !env.UPSTREAM_CONTACT?.trim())
    throw new UpstreamError('configuration', 'Live mode requires UPSTREAM_CONTACT. Set it in .dev.vars or a secret.');
  const body = new URLSearchParams();
  body.append('current_state', 'OldStudents');
  for (const id of params.types) body.append('course_type_constraint[]', String(id));
  for (const region of params.regions) body.append('regions[]', region);
  if (params.language) body.append('languages[]', params.language);
  body.append('daterange', `${params.from} - ${params.end}`);
  body.append('page', String(params.page));
  body.append('sort_column', 'dates'); body.append('sort_direction', 'up'); body.append('date_format', 'YYYY-MM-DD');
  return new Request(SEARCH_URL, { method: 'POST', redirect: 'manual', headers: {
    Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': `sitserve/${VERSION} (+${env.SITE_URL || 'http://localhost:8787'}; ${env.UPSTREAM_CONTACT || 'local simulator'})`,
  }, body });
}
export function retryAfter(value, now = Date.now()) {
  if (!value) return 0;
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) return Math.ceil(+value);
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.max(0, Math.ceil((time - now) / 1000)) : 0;
}
const string = x => typeof x === 'string';
const nullableString = x => x === null || string(x);
const owns = (o, keys) => keys.every(k => Object.hasOwn(o, k));
export function validCourse(c) {
  return !(!c || !Number.isInteger(c.id) || c.id <= 0 || !validDate(c.course_start_date) || !validDate(c.course_end_date)
      || !validDate(c.enrollment_open_date) || !string(c.raw_course_type) || !string(c.course_type)
      || !Array.isArray(c.course_instruction_languages) || !c.course_instruction_languages.every(string)
      || !Array.isArray(c.status) || !c.status.every(s => s && owns(s, ['type', 'label', 'status', 'color']) && string(s.status) && string(s.color) && nullableString(s.type) && nullableString(s.label))
      || !c.location || !Number.isInteger(c.location.id) || !string(c.location.dhamma_name)
      || !string(c.location.center_noncenter) || !string(c.location.city_province_country)
      || !owns(c, ['comments', 'app_page_url', 'trans_apply_link_url']) || !nullableString(c.comments)
      || !nullableString(c.app_page_url) || !nullableString(c.trans_apply_link_url)
      || !owns(c.location, ['sub_location_id', 'dhamma_name_meaning', 'country_iso_code', 'sub_location', 'sub_loc_image', 'header_image_path', 'website_url', 'schedule_url'])
      || !['center', 'noncenter'].includes(c.location.center_noncenter)
      || !['dhamma_name_meaning', 'country_iso_code', 'sub_location', 'sub_loc_image', 'header_image_path', 'website_url', 'schedule_url'].every(k => nullableString(c.location[k]))
      || !['state', 'country'].every(k => c.location[k] === undefined || nullableString(c.location[k]))
      || !(c.location.sub_location_id === null || Number.isInteger(c.location.sub_location_id)));
}
export function rawPageFacts(courses) {
  const dates = courses.map(c => c?.course_start_date).filter(validDate);
  return { rawCount: courses.length, rawFirstStart: dates[0] || null, rawLastStart: dates.at(-1) || null,
    rawIds: courses.filter(c => Number.isInteger(c?.id) && c.id > 0).map(c => c.id) };
}
export function validatePage(p, log = console.warn) {
  if (!p || !Array.isArray(p.courses) || p.courses.length > 10 || !Number.isInteger(p.page) || p.page < 1 || !Number.isInteger(p.pages)
    || p.pages < p.page || p.pages > 10 || !Number.isInteger(p.total_rows) || p.total_rows < 0 || typeof p.pages_truncated !== 'boolean' || p.total_rows < p.courses.length)
    throw new UpstreamError('malformed', 'The upstream search response has invalid or missing fields.');
  const facts = rawPageFacts(p.courses);
  const courses = p.courses.filter((c, index) => {
    if (validCourse(c)) return true;
    log(JSON.stringify({ event: 'invalid-course', page: p.page, index, id: Number.isInteger(c?.id) ? c.id : null }));
    return false;
  });
  return { ...p, ...facts, courses };
}
export async function readResponse(response, clock = Date.now, log = console.warn) {
  if (response.status === 429) throw new UpstreamError('429', 'dhamma.org is limiting requests.', retryAfter(response.headers.get('Retry-After'), clock()));
  if (response.status >= 500) throw new UpstreamError('5xx', `dhamma.org returned HTTP ${response.status}.`);
  if (!response.ok) throw new UpstreamError('http', `dhamma.org returned HTTP ${response.status}.`);
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') || '')) throw new UpstreamError('non-json', 'dhamma.org returned a non-JSON response.');
  let p;
  try { p = JSON.parse(await response.text()); } catch { throw new UpstreamError('malformed', 'dhamma.org returned malformed JSON.'); }
  return validatePage(p, log);
}
// Covers both headers and body; a stalled transport cannot hold the global queue forever.
export async function timedRequest(request, { fetch, clock = Date.now, timers = globalThis, timeout = 20000, slow = 10000, decode = readResponse, log = console.warn, onSlow = () => {} }) {
  const controller = new AbortController(), started = clock();
  let timer;
  const deadline = new Promise((_, reject) => { timer = timers.setTimeout(() => {
    controller.abort(); reject(new UpstreamError('timeout', 'dhamma.org did not respond in time.'));
  }, timeout); });
  try {
    const result = await Promise.race([Promise.resolve().then(() => fetch(new Request(request, { signal: controller.signal }))).then(r => decode(r, clock, log)), deadline]);
    const elapsed = clock() - started;
    if (elapsed > slow) await onSlow(elapsed);
    return result;
  } catch (e) {
    if (e instanceof UpstreamError) throw e;
    throw new UpstreamError(controller.signal.aborted ? 'timeout' : 'network', 'The upstream request failed.');
  } finally { timers.clearTimeout(timer); }
}
export async function getDhammaPage(params, options) {
  const request = buildRequest(params, options.env);
  if (!request) return { courses: [], page: 1, pages: 1, total_rows: 0, pages_truncated: false };
  return timedRequest(request, options);
}
