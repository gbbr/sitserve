// Browser regression checks; no dependencies or build step are needed to use the page.
// Test setup: npm install --prefix /tmp/sit-web-test playwright
// Run: NODE_PATH=/tmp/sit-web-test/node_modules node web/tools/test-mockup.cjs
// Uses local Chrome on macOS, or Playwright's Chromium. CHROME_PATH can override it.
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

async function main() {
  const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || (existsSync(macChrome) ? macChrome : undefined),
  });
  let passed = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', timezoneId: 'UTC' });
    await page.clock.setFixedTime(new Date('2026-11-13T12:00:00Z'));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = pathToFileURL(path.join(__dirname, '..', 'mockup.html')).href;
    const submit = () => page.locator('#search').click();
    const load = async fragment => { await page.goto(url + (fragment ? '#' + fragment : '')); await submit(); };
    const reload = async () => { await page.reload(); await submit(); };
    const rowIDs = () => page.locator('.row[data-id]').evaluateAll(rows => rows.map(r => +r.dataset.id).sort((a, b) => a - b));
    const order = () => page.locator('.head > [data-column]').evaluateAll(cells => cells.map(c => c.dataset.column));
    const search = page.locator('#place-search');
    const check = async (name, run) => {
      await run();
      passed++;
      console.log('PASS ' + name);
    };
    const pick = async (query, key) => {
      await search.fill(query);
      await page.locator('#place-option-' + key).click();
    };
    await check('page load waits for an explicit Search', async () => {
      await page.goto(url);
      assert.equal(await page.locator('.row[data-id]').count(), 0);
      assert.equal(await page.locator('#summary').innerText(), 'Ready to search');
      assert.match(await page.locator('#list').innerText(), /press Search/);
      assert.ok(await page.locator('#search').isVisible());
      await submit();
    });
    const baselineIDs = await rowIDs();
    const courses = await page.evaluate(() => SAMPLE_COURSES);
    const baseline = courses.filter(c => baselineIDs.includes(c.id));
    const places = await page.evaluate(() => PLACES);
    const defaultOrder = ['location', 'dates', 'type', 'lights', 'apply', 'links'];
    // Expected results for the fixed 2026-11-13 snapshot, after availability filtering.
    const expected = {
      default: [170812,173480,178579,178834,179699,184342,189006,189553,192996,195567,196047,203260,211777,212474,212514,212539,212733,213112,213436,213573,213611,215697,216596,220827,221889,222097,225337,226538,238047,238950],
      combined: [186197,211409,213436,214853,222755,223233,225046,227058,229566,231500,231635,232202,232669,233340,233762,234406,235631,236563,236807,237910],
      americas: [178579,178686,179699,189006,189101,196047,203260,211777,212474,212514,212733,213112,213611,214565,226538,231067,231792,232202,232703,232950,233511,233938,234406,235258,235631,235832,236563,236791,237338,237910],
      americasEurope: [170812,170814,177208,178579,178686,178834,179699,184006,184342,189006,189553,189554,191225,196047,197325,203260,203771,211409,211777,212474,212514,212733,213112,213611,214565,219344,222243,226538,232492,233193],
      europe: [170812,170814,177208,178834,184006,184342,189553,189554,191225,197325,203771,211409,219344,222243,227058,232492,233193,233340,238401],
      washington: [178686,232703],
      dhara: [189006,189101,233511],
      venue: [226538],
    };

    await check('From defaults to the local day and preserves an explicit shared date', async () => {
      for (const [timezoneId, expected] of [['America/Los_Angeles', '2026-11-13'], ['Pacific/Auckland', '2026-11-14']]) {
        const localPage = await browser.newPage({ timezoneId });
        try {
          await localPage.clock.setFixedTime(new Date('2026-11-14T00:30:00Z'));
          await localPage.goto(url);
          assert.equal(await localPage.locator('[name=from]').inputValue(), expected);
          await localPage.goto(url + '#from=2026-12-01');
          assert.equal(await localPage.locator('[name=from]').inputValue(), '2026-12-01');
          assert.equal(await localPage.locator('.row[data-id]').count(), 0);
        } finally { await localPage.close(); }
      }
    });

    await check('desktop grid, type groups, buttons, icons and local square flags', async () => {
      assert.deepEqual(baselineIDs, expected.default);
      assert.match(await page.locator('#search-limit').innerText(), /first 30 matches/);
      assert.deepEqual(await order(), defaultOrder);
      assert.deepEqual(await page.locator('#types input').evaluateAll(inputs => inputs.map(i => i.value)),
        ['3D', '10D', '10D OS', 'EXEC', 'STP', '14D/TSC', '10D SPCL', '20D', '30D', '45D', '60D']);
      assert.equal(await page.locator('.kind.center').count(), 0);
      assert.equal(await page.locator('.row[data-id] .kind.noncenter').count(), baseline.filter(c => !c.loc.center).length);
      assert.ok(await page.locator('.reg a').first().evaluate(a => getComputedStyle(a).height === '24px'));
      assert.ok(await page.locator('.row[data-id]').evaluateAll(rows => rows.every(row => {
        const note = row.querySelector('.note');
        return !note || (note.parentElement.dataset.column === 'links' && note === note.parentElement.lastElementChild);
      })));
      await page.waitForFunction(() => [...document.querySelectorAll('.flag img')].every(img => img.complete));
      assert.ok(await page.locator('.flag img').evaluateAll(imgs => imgs.every(img => img.naturalWidth > 0 && img.naturalWidth === img.naturalHeight)));
      assert.ok(await page.locator('.type').first().evaluate(el => getComputedStyle(el).justifyContent === 'center'));
    });

    await check('all filter edits and column reordering preserve the submitted results', async () => {
      const submittedURL = page.url();
      const submittedSummary = await page.locator('#summary').innerText();
      await page.locator('[name=from]').fill('2026-12-01');
      await page.locator('[name=as]').selectOption('OM');
      await page.locator('[name=lang]').selectOption('English');
      await page.locator('[name=centers]').check();
      await page.locator('[name=wait]').uncheck();
      await page.locator('[name=soon]').uncheck();
      await page.locator('#types').getByText('20D', { exact: true }).click();
      await pick('Americas', 'region_402');
      assert.deepEqual(await rowIDs(), baselineIDs);
      assert.equal(page.url(), submittedURL);
      assert.equal(await page.locator('#summary').innerText(), submittedSummary);
      assert.match(await page.locator('#search-status').innerText(), /Filters changed/);
      await page.locator('.column-head[data-column=location]').focus();
      await page.keyboard.press('Alt+ArrowRight');
      assert.deepEqual(await rowIDs(), baselineIDs);
      assert.equal(await page.locator('#list').getAttribute('data-as'), 'any');
      await page.keyboard.press('Alt+ArrowLeft');
      await submit();
      const submitted = new URLSearchParams(new URL(page.url()).hash.slice(1));
      assert.equal(submitted.get('where'), 'region_402');
      assert.equal(submitted.get('types'), '20D');
      assert.equal(submitted.get('as'), 'OM');
      assert.equal(submitted.get('from'), '2026-12-01');
      assert.doesNotMatch(await page.locator('#search-status').innerText(), /Filters changed/);
      await load();
    });

    await check('Search keeps scanning after three pages, caps matches, and runs afresh', async () => {
      await page.evaluate(() => {
        const base = SAMPLE_COURSES.find(c => c.type === '10-Day');
        const fixture = Array.from({ length: 105 }, (_, i) => ({
          ...base, id: 999000 + i, start: '2026-11-20', end: '2026-12-01', enroll: '2026-10-01',
          comments: '', hasNotes: false,
          langs: i >= 10 && i < 20 ? ['French'] : ['English'],
          loc: { ...base.loc, center: !(i >= 20 && i < 30), name: 'Fixture ' + String(i).padStart(3, '0') },
          status: i < 10 ? [{ type: null, status: 'In Progress', color: 'NONE' }]
            : i >= 30 && i < 40 ? [{ type: 'om', status: 'Wait List', color: 'Yellow' }]
            : [{ type: i >= 40 && i < 50 ? 'nm' : 'om', status: 'Open', color: 'Green' }],
        }));
        SAMPLE_COURSES.splice(0, SAMPLE_COURSES.length, ...fixture);
      });
      await page.locator('[name=as]').selectOption('OM');
      await page.locator('[name=lang]').selectOption('English');
      await page.locator('[name=centers]').check();
      await page.locator('[name=wait]').uncheck();
      await page.locator('[name=soon]').uncheck();
      await submit();
      assert.deepEqual(await rowIDs(), Array.from({ length: 30 }, (_, i) => 999050 + i));
      await page.evaluate(() => { SAMPLE_COURSES[50].status = [{ type: null, status: 'Closed', color: 'Red' }]; });
      await submit();
      assert.deepEqual(await rowIDs(), Array.from({ length: 30 }, (_, i) => 999051 + i));
    });

    await check('target truncation is partial; exhausted and empty searches are clear', async () => {
      await page.evaluate(() => {
        for (const [i, course] of SAMPLE_COURSES.entries()) {
          course.status = [{ type: null, status: i < 90 ? 'Closed' : 'Open', color: i < 90 ? 'Red' : 'Green' }];
        }
      });
      await submit();
      assert.deepEqual(await rowIDs(), Array.from({ length: 10 }, (_, i) => 999090 + i));
      assert.match(await page.locator('#search-limit').innerText(), /Partial results/);
      await page.evaluate(() => {
        const courses = SAMPLE_COURSES.slice(90, 92);
        SAMPLE_COURSES.splice(0, SAMPLE_COURSES.length, courses[0], courses[0], courses[1]);
      });
      await submit();
      assert.deepEqual(await rowIDs(), [999090, 999091], 'duplicate course IDs must count once');
      assert.ok(await page.locator('#search-limit').isHidden());
      await page.evaluate(() => {
        for (const course of SAMPLE_COURSES) course.status = [{ type: null, status: 'Closed', color: 'Red' }];
      });
      await submit();
      assert.equal(await page.locator('.row[data-id]').count(), 0);
      assert.match(await page.locator('#list .empty').innerText(), /No courses/);
      await reload();
      await load();
    });

    await check('combined 14D/TSC filter and legacy links select both course types', async () => {
      const combinedIDs = expected.combined;
      await page.locator('#types').getByText('14D/TSC', { exact: true }).click();
      await submit();
      await page.waitForFunction(() => [...document.querySelectorAll('.type-code')].every(el => ['14D', 'TSC'].includes(el.textContent)));
      assert.deepEqual(await rowIDs(), combinedIDs);
      await reload();
      assert.equal(await page.locator('[name=types][value="14D/TSC"]').isChecked(), true);
      assert.deepEqual(await rowIDs(), combinedIDs);
      for (const code of ['14D', 'TSC']) {
        await load('types=' + code);
        assert.equal(await page.locator('[name=types][value="14D/TSC"]').isChecked(), true);
        assert.deepEqual(await rowIDs(), combinedIDs);
      }
      await load();
    });

    await check('grouped suggestions, accents, multiword matching and no matches', async () => {
      await search.focus();
      assert.equal(await page.locator('#place-options [role=option]').count(), 5);
      await search.fill('dhara');
      assert.match(await page.locator('#place-option-location_1542').innerHTML(), /<b>Dharā<\/b>/);
      assert.deepEqual(await rowIDs(), baselineIDs, 'typing must not apply a place filter');
      await search.fill('dhara mass');
      assert.ok(await page.locator('#place-option-location_1542').isVisible());
      await search.fill('india');
      assert.ok(await page.locator('.place-more').count() > 0);
      for (const group of await page.locator('#place-options [role=group]').all()) {
        assert.ok(await group.locator('[role=option]').count() <= 8);
      }
      await search.fill('no-such-place-123456789');
      assert.equal(await page.locator('#place-options [role=option]').count(), 0);
      assert.equal(await page.locator('.place-empty').innerText(), 'No matching places.');
      await search.press('Escape');
      assert.equal(await search.getAttribute('aria-expanded'), 'false');
    });

    await check('region selection, OR matching and URL restoration', async () => {
      await pick('Americas', 'region_402');
      await submit();
      assert.deepEqual(await rowIDs(), expected.americas);
      const europe = places.find(p => p[0] === 'region' && p[2] === 'Europe');
      assert.ok(europe);
      await pick('Europe', 'region_' + europe[1]);
      await submit();
      assert.deepEqual(await rowIDs(), expected.americasEurope);
      const selected = await page.locator('[name=where]').inputValue();
      assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('where'), selected);
      await reload();
      assert.equal(await page.locator('.place-chip').count(), 2);
      assert.equal(await page.locator('[name=where]').inputValue(), selected);
      await page.locator('[data-remove-place=region_402]').click();
      assert.equal(await search.getAttribute('aria-expanded'), 'false');
      assert.deepEqual(await rowIDs(), expected.americasEurope);
      await submit();
      assert.deepEqual(await rowIDs(), expected.europe);
    });

    await check('state, location and venue membership', async () => {
      await load();
      await pick('Washington', 'state_3951');
      await submit();
      assert.deepEqual(await rowIDs(), expected.washington);
      await load();
      await pick('dhara', 'location_1542');
      await submit();
      assert.deepEqual(await rowIDs(), expected.dhara);
      await load('where=sublocation_2156');
      assert.deepEqual(await rowIDs(), expected.venue);
      await load('where=unknown_1,location_1542,location_1542');
      assert.equal(await page.locator('[name=where]').inputValue(), 'location_1542');
    });

    await check('place picker keyboard navigation, removal and focus', async () => {
      await load();
      await search.focus();
      const first = await search.getAttribute('aria-activedescendant');
      await search.press('ArrowDown');
      const second = await search.getAttribute('aria-activedescendant');
      assert.notEqual(first, second);
      await search.press('ArrowUp');
      assert.equal(await search.getAttribute('aria-activedescendant'), first);
      await search.press('Enter');
      assert.equal(await page.locator('.place-chip').count(), 1);
      assert.equal(await search.getAttribute('aria-expanded'), 'false');
      await search.press('Backspace');
      assert.equal(await page.locator('.place-chip').count(), 0);
      assert.deepEqual(await rowIDs(), baselineIDs);
      await page.locator('[name=from]').focus();
      assert.equal(await search.getAttribute('aria-expanded'), 'false');
    });

    await check('As emphasizes the selected lights and anyone restores them', async () => {
      await page.locator('[name=as]').selectOption('OM');
      await submit();
      await page.waitForFunction(() => document.querySelector('#list').dataset.as === 'OM');
      assert.ok(await page.locator('.l.hl i.light').count() > 0);
      assert.ok(await page.locator('.l.hl i.light').evaluateAll(lights => lights.every(el => getComputedStyle(el).width === '10px' && getComputedStyle(el).opacity === '1')));
      assert.ok(await page.locator('.lights .l:not(.hl) i.light').evaluateAll(lights => lights.every(el => getComputedStyle(el).width === '8px' && getComputedStyle(el).opacity === '0.28')));
      await page.locator('[name=as]').selectOption('any');
      await submit();
      await page.waitForFunction(() => document.querySelector('#list').dataset.as === 'any');
      assert.ok(await page.locator('.lights i.light').evaluateAll(lights => lights.every(el => getComputedStyle(el).width === '8px' && getComputedStyle(el).opacity === '1')));
    });

    await check('notes survive column dragging and order persists on reload', async () => {
      const note = page.locator('.row[data-id] .note').first();
      const courseID = await note.evaluate(el => el.closest('.row').dataset.id);
      await note.click();
      assert.ok(await page.locator(`.row[data-id="${courseID}"] + .notes`).isVisible());
      await page.locator('.column-head[data-column=type]').dragTo(page.locator('.column-head[data-column=location]'), { targetPosition: { x: 2, y: 8 } });
      assert.equal((await order())[0], 'type');
      assert.ok(await page.locator(`.row[data-id="${courseID}"] + .notes`).isVisible());
      const draggedOrder = await order();
      assert.ok(await page.locator('.row[data-id]').evaluateAll((rows, expected) => rows.every(row => JSON.stringify([...row.children].map(c => c.dataset.column)) === JSON.stringify(expected)), draggedOrder));
      await reload();
      assert.deepEqual(await order(), draggedOrder);
      await page.locator('.column-head[data-column=type]').focus();
      await page.keyboard.press('Alt+ArrowRight');
      assert.equal((await order())[1], 'type');
      assert.equal(await page.locator('.column-head[data-column=type]').evaluate(el => el === document.activeElement), true);
      await page.evaluate(() => localStorage.removeItem('sit.columns'));
      await reload();
    });

    await check('no horizontal overflow at phone, breakpoint and desktop widths', async () => {
      for (const width of [320, 375, 390, 600, 820, 821, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.waitForFunction(() => Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--head-h')) - (document.querySelector('.head')?.getBoundingClientRect().height || 0)) < .01);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}px`);
        assert.equal(await page.locator('.head').isVisible(), width > 820);
        await search.focus();
        assert.ok(await page.locator('#place-options').evaluate(el => {
          const r = el.getBoundingClientRect();
          return r.left >= 0 && r.right <= innerWidth;
        }), `suggestion overflow at ${width}px`);
        await search.press('Escape');
      }
      assert.ok(await page.locator('.row[data-id]').first().evaluate(row => {
        const first = row.firstElementChild.getBoundingClientRect();
        const center = first.top + first.height / 2;
        return [...row.children].every(cell => {
          const r = cell.getBoundingClientRect();
          return Math.abs(r.top + r.height / 2 - center) < 1;
        });
      }));
    });

    await check('sticky headers overlap without a seam and titles stay aligned', async () => {
      for (const width of [821, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        const position = await page.evaluate(() => Math.min(300, document.documentElement.scrollHeight - innerHeight));
        await page.evaluate(position => scrollTo(0, position), position);
        await page.waitForFunction(position => scrollY === position
          && Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bar-h')) - document.querySelector('.bar').getBoundingClientRect().height) < .01, position);
        const dimensions = await page.evaluate(() => {
          const bar = document.querySelector('.bar').getBoundingClientRect();
          const head = document.querySelector('.head').getBoundingClientRect();
          const month = document.querySelector('h2').getBoundingClientRect();
          const location = document.querySelector('.column-head[data-column=location]').getBoundingClientRect();
          const flag = document.querySelector('.row[data-id] .flag').getBoundingClientRect();
          return { barGap: head.top - bar.bottom, monthGap: month.top - head.bottom, locationX: location.left, flagX: flag.left };
        });
        assert.ok(dimensions.barGap <= 0 && dimensions.barGap >= -1.1, `filter seam at ${width}px: ${JSON.stringify(dimensions)}`);
        assert.ok(dimensions.monthGap <= 0 && dimensions.monthGap >= -1.1, `month seam at ${width}px: ${JSON.stringify(dimensions)}`);
        assert.equal(dimensions.locationX, dimensions.flagX);
      }
      assert.match(await page.locator('h2').first().textContent(), /^2026 November/);
      if (process.env.SIT_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SIT_SCREENSHOT_DIR, 'sit-scroll.png') });
      await page.evaluate(() => scrollTo(0, 0));
    });

    await check('theme choice persists and both themes render', async () => {
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
      await page.locator('#theme').click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      await reload();
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      if (process.env.SIT_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SIT_SCREENSHOT_DIR, 'sit-dark.png') });
      await page.locator('#theme').click();
      await page.locator('#theme').blur();
      if (process.env.SIT_SCREENSHOT_DIR) {
        await page.screenshot({ path: path.join(process.env.SIT_SCREENSHOT_DIR, 'sit-desktop.png') });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: path.join(process.env.SIT_SCREENSHOT_DIR, 'sit-mobile.png') });
      }
      assert.deepEqual(errors, []);
    });
    console.log(`${passed} browser checks passed.`);
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
