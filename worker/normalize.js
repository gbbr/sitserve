import { rawPageFacts } from './dhamma.js';
import { TYPE, venueCenters, escapeHTML } from '../web/shared/courses.js';
const BASE = 'https://www.dhamma.org';
export function safeURL(value, protocols = ['http:', 'https:']) {
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) return '';
  try { const u = new URL(value, BASE); return protocols.includes(u.protocol) ? u.href : ''; } catch { return ''; }
}
const KEEP = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'a']);
const decode = s => s.replace(/&(?:#(x[\da-f]+|\d+)|colon|tab|newline|amp|quot|apos);?/gi, (m, n) => {
  if (n) { const c = parseInt(n.replace(/^x/i, ''), /^x/i.test(n) ? 16 : 10); return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : ''; }
  return ({ '&colon;': ':', '&tab;': '\t', '&newline;': '\n', '&amp;': '&', '&quot;': '"', '&apos;': "'" })[m.toLowerCase()] || m;
});
// Tokenize quotes as part of a tag; rebuild permitted tags and attributes from scratch.
export function sanitize(html) {
  let out = '';
  const stack = [];
  for (const token of String(html || '').matchAll(/<!--[\s\S]*?(?:-->|$)|<\/?[a-zA-Z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>|[^<]+|</g)) {
    const t = token[0];
    if (t.startsWith('<!--')) continue;
    if (!/^<\/?[a-z]/i.test(t)) {
      out += t.replace(/&(?!(?:#\d+|#x[\da-f]+|[a-z]+);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      continue;
    }
    const m = /^<(\/?)\s*([\w-]+)/.exec(t), tag = m?.[2].toLowerCase();
    if (!KEEP.has(tag)) continue;
    if (m[1]) {
      const i = stack.lastIndexOf(tag);
      if (i >= 0) while (stack.length > i) out += `</${stack.pop()}>`;
      continue;
    }
    let attrs = '';
    if (tag === 'a') {
      const a = [...t.slice(m[0].length).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].find(a => a[1].toLowerCase() === 'href');
      const href = safeURL(decode(a?.[2] ?? a?.[3] ?? a?.[4] ?? ''), ['http:', 'https:', 'mailto:']);
      if (href) attrs = ` href="${escapeHTML(href)}"`;
    }
    out += `<${tag}${attrs}>`;
    if (tag !== 'br') stack.push(tag);
  }
  while (stack.length) out += `</${stack.pop()}>`;
  return out;
}
export function photoPath(value) {
  const u = safeURL(value);
  if (!u) return '';
  const url = new URL(u);
  return url.hostname === 'www.dhamma.org' && validPhotoPath(url.pathname) ? '/photo' + url.pathname : '';
}
export function validPhotoPath(path) {
  return /^\/(?:system\/images|assets)\/[a-zA-Z0-9_./%-]+\.(?:jpe?g|png|gif|webp|avif|svg)$/i.test(path)
    && !/\.\.|%|\/\//.test(path);
}
export const hasNotes = comments => !!decode(comments.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ')).trim();
export function normalize(c) {
  if (!TYPE.has(c.raw_course_type)) return null;
  const l = c.location, comments = sanitize(c.comments);
  return {
    id: c.id, start: c.course_start_date, end: c.course_end_date, enroll: c.enrollment_open_date,
    type: c.raw_course_type, label: c.course_type, langs: c.course_instruction_languages,
    status: c.status.map(s => Object.fromEntries(['type', 'label', 'status', 'color'].map(k => [k, s[k]]))),
    comments, hasNotes: hasNotes(comments),
    apply: safeURL(c.app_page_url || c.trans_apply_link_url || c.apply_link_url),
    loc: {
      id: l.id, subId: l.sub_location_id, name: l.dhamma_name.trim(), meaning: l.dhamma_name_meaning || '',
      // dhamma.org reports every course at a venue as non-center; a venue that names a center is one.
      state: l.state || '', country: l.country || '', center: l.center_noncenter === 'center' || venueCenters(l.sub_location).length > 0,
      cc: l.country_iso_code, place: l.city_province_country, venue: l.sub_location || '', venueUrl: safeURL(l.sub_location_url),
      // A venue image outside the proxied paths (dhamma.org keeps them under /images/) falls back to the location's photo.
      photo: photoPath(l.sub_loc_image) || photoPath(l.header_image_path),
      web: safeURL(l.website_url), schedule: safeURL(l.schedule_url),
    },
  };
}
export function normalizePage(p) {
  const { rawCount, rawFirstStart, rawLastStart, rawIds } = p.rawCount === undefined ? rawPageFacts(p.courses) : p;
  return { ...Object.fromEntries(['page', 'pages', 'total_rows', 'pages_truncated'].map(k => [k, p[k]])),
    rawCount, rawFirstStart, rawLastStart, rawIds, courses: p.courses.map(normalize).filter(Boolean) };
}
