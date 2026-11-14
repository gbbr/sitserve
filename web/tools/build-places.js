import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Extract balanced inline JSON without executing the saved page's scripts.
export function inlineJSON(html, marker) {
  const offset = html.indexOf(marker);
  if (offset < 0) throw new Error(`Missing ${marker}`);
  const tail = html.slice(offset + marker.length);
  const start = tail.search(/[\[{]/);
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < tail.length; i++) {
    const c = tail[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === '[' || c === '{') depth++;
    else if ((c === ']' || c === '}') && --depth === 0) {
      return JSON.parse(tail.slice(start, i + 1).replace(/([{,]\s*)(text|children)\s*:/g, '$1"$2":'));
    }
  }
  throw new Error(`Unterminated ${marker}`);
}
export function buildPlaces(search, directory) {
  const stack = [], regions = {}, depths = {}, centers = {};
  let lastRegion;
  for (const match of directory.matchAll(/<\/?div\b[^>]*>/gi)) {
    const tag = match[0];
    if (tag.startsWith('</')) { stack.pop(); continue; }
    const attrs = Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => [m[1], m[2] ?? m[3]]));
    let held = null;
    if (attrs.id?.startsWith('region-') && attrs['data-id']) {
      lastRegion = +attrs['data-id']; depths[lastRegion] = stack.filter(x => x != null).length;
    } else if (attrs.class?.split(/\s+/).includes('region-children')) held = lastRegion;
    else if (attrs.id?.startsWith('location-') && attrs['data-id']) {
      const id = +attrs['data-id']; regions[id] = stack.filter(x => x != null);
      const content = directory.slice(match.index, directory.indexOf('</div>', match.index));
      centers[id] = !content.includes('noncenter-pin');
    }
    stack.push(held);
  }
  const counts = {};
  for (const rs of Object.values(regions)) for (const r of rs) counts[r] = (counts[r] || 0) + 1;
  const entries = inlineJSON(search, 'viewModel.search_regions(').flatMap(g => g.children);
  const locationStates = Object.fromEntries(entries.filter(e => e.id[0] === 'location').map(e => [e.id[1], e.texts[1] || '']));
  const places = entries.map(e => {
    const [kind, id] = e.id, texts = [...new Set(e.texts.filter(Boolean))];
    const tag = kind === 'region' ? depths[id] === 0 ? 'world' : depths[id] === 1 ? 'continent'
      : /^[A-Z]{2}$/.test(e.texts[2] || '') ? 'country' : (e.texts[2] || '').includes('.') ? 'state' : 'region'
      : kind === 'location' ? centers[id] ? 'center' : 'non-center' : kind === 'state' ? 'state' : 'venue';
    return [kind, id, e.text, texts, tag, kind === 'region' ? counts[id] || 0 : 0];
  });
  const languages = inlineJSON(search, 'instructionLanguages =').map(l => [l.iso_code, l.description]);
  const courseTypes = inlineJSON(search, 'viewModel.course_types(');
  return { PLACES: places, LOCATION_REGIONS: regions, LOCATION_STATES: locationStates, LANGUAGES: languages, COURSE_TYPE_IDS: courseTypes };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [search, directory, output = 'web/places.js'] = process.argv.slice(2);
  if (!search || !directory) throw new Error('Usage: node web/tools/build-places.js SEARCH_HTML DIRECTORY_HTML [OUTPUT]');
  const result = buildPlaces(readFileSync(search, 'utf8'), readFileSync(directory, 'utf8'));
  writeFileSync(output, '// Place metadata from saved dhamma.org search and directory pages (2026-11-13).\n'
    + Object.entries(result).map(([key, value]) => `export const ${key} = ${JSON.stringify(value)};\n`).join(''));
}
