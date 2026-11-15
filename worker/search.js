import { availability, matches, utcToday, venueCenters } from '../web/shared/courses.js';
import { requestParams } from './dhamma.js';
export function serverToday(env = {}, clock = Date.now) { return env.SITSERVE_TODAY || utcToday(clock); }
export function clampFilters(filters, today) {
  const yesterday = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10);
  return { ...filters, from: filters.from < yesterday ? yesterday : filters.from };
}
// Some locations also list another location's courses as records of their own: Dhamma Bhumi lists
// Dhamma Pāsāda's at its venue "Dhamma Pasada". A copy differs from the original only in its
// course ID, listing location and application link.
const COPY_FIELDS = ['start', 'end', 'type', 'label', 'enroll', 'langs', 'status', 'comments'];
const sameValue = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
const enrollmentForm = c => /\/initial_enrolment_form\/[\w-]+$/.test(c.apply) ? c.apply : '';
// Where a course is held: its listing location, or the one directory center its venue names.
export function heldAt(c) {
  if (!c.loc.venue) return c.loc.id;
  const ids = venueCenters(c.loc.venue);
  return ids.length === 1 ? ids[0] : null;
}
// Listings from two locations are one course when they match in every copied field and share an
// enrollment form, or, while either has no form, are held at the same center without conflicting
// venue URLs. Different enrollment forms always mean different courses.
export function sameCourse(a, b) {
  if (a.loc.id === b.loc.id || COPY_FIELDS.some(k => !sameValue(a[k], b[k]))) return false;
  const formA = enrollmentForm(a), formB = enrollmentForm(b);
  if (formA && formB) return formA === formB;
  const at = heldAt(a);
  return at !== null && at === heldAt(b) && (!a.loc.venueUrl || !b.loc.venueUrl || a.loc.venueUrl === b.loc.venueUrl);
}
export async function search(filters, { getPage, getCachedSequence = async () => null, emit = () => {}, signal, today = utcToday(), cap = 20, limit = 50 }) {
  const f = clampFilters(filters, today), seen = new Set(), seenRaw = new Set();
  // Matching courses already sent, and copies held while the listing of the center holding them can still arrive.
  const sent = [], held = [];
  let count = 0, pages = 0, checkedAt = null, searchedThrough = null, from = f.from, reason = 'end';
  const done = reason => ({ type: 'done', reason, partial: !['end', 'limit', 'cancelled'].includes(reason), searchedThrough, checkedAt, pages, count });
  const progress = (courses, extra = {}) => {
    courses.sort((a, b) => a.start.localeCompare(b.start)); sent.push(...courses);
    emit({ type: 'progress', courses, searchedThrough, checkedAt, pages, ...extra });
  };
  // Count each course once. A held copy gives way to the listing of the center holding the course.
  const take = (c, added) => {
    if (!matches(c, f) || !availability(c, f, today)) return;
    const twin = [...sent, ...added, ...held].find(d => sameCourse(c, d)), at = heldAt(c);
    if (twin && !(held.includes(twin) && at === c.loc.id)) return;
    if (twin) held.splice(held.indexOf(twin), 1); else count++;
    (at !== null && at !== c.loc.id ? held : added).push(c);
  };
  // Pages arrive in start-date order: a copy starting before `before` has no listing left to meet.
  const release = (added, before) => {
    for (const c of held.filter(c => !before || c.start < before)) { held.splice(held.indexOf(c), 1); added.push(c); }
  };
  const flush = () => { if (held.length) { const added = []; release(added); progress(added); } };
  const finish = reason => {
    if (reason !== 'cancelled') flush();
    const result = done(reason); emit(result); return result;
  };
  if (!requestParams(f, { today }).types.length) return finish('end');
  if (signal?.aborted) return finish('cancelled');
  let reused;
  try { reused = await getCachedSequence(requestParams(f, { today })); }
  catch (e) {
    if (!signal?.aborted && e.code !== 'cancelled') throw e;
    return finish('cancelled');
  }
  if (signal?.aborted) return finish('cancelled');
  if (reused) {
    for (const { page, fetchedAt } of reused.pages) {
      if (signal?.aborted) return finish('cancelled');
      if (pages >= cap) return finish('cap');
      pages++;
      if (!checkedAt || fetchedAt < checkedAt) checkedAt = fetchedAt;
      if (page.rawLastStart && (!searchedThrough || page.rawLastStart > searchedThrough)) searchedThrough = page.rawLastStart;
      const added = [];
      for (const c of page.courses) {
        if ((!reused.complete && c.start >= reused.coverageEnd) || seen.has(c.id)) continue;
        seen.add(c.id);
        take(c, added);
        if (count === limit) break;
      }
      if (page.rawLastStart) release(added, page.rawLastStart);
      progress(added, { cacheHit: true, reused: true });
      if (count === limit) return finish('limit');
    }
    if (reused.complete) return finish('end');
    from = reused.coverageEnd;
    reason = 'cap';
  }
  outer: while (pages < cap) {
    let queryFirst = null, queryLast = null, queryNew = false, querySize = 0;
    const previousThrough = searchedThrough;
    for (let number = 1; number <= 10 && pages < cap; number++) {
      if (signal?.aborted) { reason = 'cancelled'; break outer; }
      let result;
      try { result = await getPage(requestParams(f, { today, page: number, from })); }
      catch (e) {
        if (signal?.aborted || e.code === 'cancelled') reason = 'cancelled';
        else if (['allowance', 'paused', 'visitor-limit'].includes(e.code)) { reason = e.code; flush(); emit({ type: 'error', code: e.code, message: e.message, retryAfter: e.retryAfter || 0 }); }
        else { flush(); throw e; }
        break outer;
      }
      if (signal?.aborted) { reason = 'cancelled'; break outer; }
      const { page, fetchedAt } = result;
      pages++;
      if (!checkedAt || fetchedAt < checkedAt) checkedAt = fetchedAt;
      const { rawCount, rawFirstStart, rawLastStart, rawIds } = page;
      querySize += rawCount;
      queryFirst ||= rawFirstStart;
      if (rawLastStart) {
        queryLast = rawLastStart;
        if (!searchedThrough || rawLastStart > searchedThrough) searchedThrough = rawLastStart;
      }
      for (const id of rawIds) {
        if (!seenRaw.has(id)) { seenRaw.add(id); queryNew = true; }
      }
      // Rows without usable IDs can still establish progress through later dates.
      if (rawIds.length < rawCount && rawLastStart && (!previousThrough || rawLastStart > previousThrough)) queryNew = true;
      const added = [];
      for (const c of page.courses) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        take(c, added);
        if (count === limit) break;
      }
      if (rawLastStart) release(added, rawLastStart);
      progress(added, { cacheHit: !!result.cacheHit });
      if (count === limit) { reason = 'limit'; break outer; }
      if (!rawCount || page.page < number) { reason = from !== f.from && !queryNew ? 'nothing-new' : 'end'; break outer; }
      if (number >= page.pages) {
        if (from !== f.from && !queryNew) { reason = 'nothing-new'; break outer; }
        if (!page.pages_truncated) { reason = 'end'; break outer; }
        if (!queryNew) { reason = 'nothing-new'; break outer; }
        if (querySize >= 100 && queryFirst && queryFirst === queryLast) { reason = 'same-date'; break outer; }
        if (!queryLast || queryLast <= from) { reason = 'nothing-new'; break outer; }
        from = queryLast;
        break;
      }
    }
    if (pages >= cap) reason = 'cap';
  }
  return finish(reason);
}
