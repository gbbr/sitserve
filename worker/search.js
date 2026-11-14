import { availability, matches, utcToday } from '../web/shared/courses.js';
import { requestParams } from './dhamma.js';
export function serverToday(env = {}, clock = Date.now) { return env.SITSERVE_TODAY || utcToday(clock); }
export function clampFilters(filters, today) {
  const yesterday = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10);
  return { ...filters, from: filters.from < yesterday ? yesterday : filters.from };
}
export async function search(filters, { getPage, getCachedSequence = async () => null, emit = () => {}, signal, today = utcToday(), cap = 20, limit = 50 }) {
  const f = clampFilters(filters, today), seen = new Set(), seenRaw = new Set();
  let count = 0, pages = 0, checkedAt = null, searchedThrough = null, from = f.from, reason = 'end';
  const done = reason => ({ type: 'done', reason, partial: !['end', 'limit', 'cancelled'].includes(reason), searchedThrough, checkedAt, pages, count });
  if (!requestParams(f, { today }).types.length) { const result = done('end'); emit(result); return result; }
  if (signal?.aborted) { const result = done('cancelled'); emit(result); return result; }
  let reused;
  try { reused = await getCachedSequence(requestParams(f, { today })); }
  catch (e) {
    if (!signal?.aborted && e.code !== 'cancelled') throw e;
    const result = done('cancelled'); emit(result); return result;
  }
  if (signal?.aborted) { const result = done('cancelled'); emit(result); return result; }
  if (reused) {
    for (const { page, fetchedAt } of reused.pages) {
      if (signal?.aborted) { const result = done('cancelled'); emit(result); return result; }
      if (pages >= cap) { const result = done('cap'); emit(result); return result; }
      pages++;
      if (!checkedAt || fetchedAt < checkedAt) checkedAt = fetchedAt;
      if (page.rawLastStart && (!searchedThrough || page.rawLastStart > searchedThrough)) searchedThrough = page.rawLastStart;
      const added = [];
      for (const c of page.courses) {
        if ((!reused.complete && c.start >= reused.coverageEnd) || seen.has(c.id)) continue;
        seen.add(c.id);
        if (matches(c, f) && availability(c, f, today)) { added.push(c); count++; }
        if (count === limit) break;
      }
      emit({ type: 'progress', courses: added, searchedThrough, checkedAt, pages, cacheHit: true, reused: true });
      if (count === limit) { const result = done('limit'); emit(result); return result; }
    }
    if (reused.complete) { const result = done('end'); emit(result); return result; }
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
        else if (['allowance', 'paused', 'visitor-limit'].includes(e.code)) { reason = e.code; emit({ type: 'error', code: e.code, message: e.message, retryAfter: e.retryAfter || 0 }); }
        else throw e;
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
        if (matches(c, f) && availability(c, f, today)) { added.push(c); count++; }
        if (count === limit) break;
      }
      emit({ type: 'progress', courses: added, searchedThrough, checkedAt, pages, cacheHit: !!result.cacheHit });
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
  const result = done(reason); emit(result); return result;
}
