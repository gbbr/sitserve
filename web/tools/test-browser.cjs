// Served-page regression checks. npm run test:browser boots an offline local Worker.
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { startServer } = require('../../worker/test/server.cjs');
const { chromium } = require('playwright');

async function main() {
  const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const server = await startServer();
  let browser;
  try { browser = await chromium.launch({
    args: ['--disable-background-networking'],
    headless: true,
    executablePath: process.env.CHROME_PATH || (existsSync(macChrome) ? macChrome : undefined),
  }); } catch (error) { await server.stop(); await server.cleanup(); throw error; }
  const safePage = async options => {
    const p = await browser.newPage(options);
    await p.route('**/*', route => ['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    return p;
  };
  let passed = 0;
  try {
    const page = await safePage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', timezoneId: 'UTC' });
    await page.clock.setFixedTime(new Date('2026-11-14T12:00:00Z'));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = server.url;
    const submit = async () => { await page.locator('#search').click(); await page.waitForFunction(() => !document.querySelector('#search').disabled); };
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
    const { normalize } = await import('../../worker/normalize.js');
    const courses = require('../../worker/fixtures/dhamma/corpus.json').map(normalize).filter(Boolean);
    const baseline = courses.filter(c => baselineIDs.includes(c.id));
    const { PLACES: places } = await import('../places.js');
    const defaultOrder = ['location', 'dates', 'type', 'lights', 'apply', 'links'];
    const expected = require('../../worker/fixtures/dhamma/browser-expected.json');

    await check('From defaults to the local day and preserves an explicit shared date', async () => {
      for (const [timezoneId, expected] of [['America/Los_Angeles', '2026-11-13'], ['Pacific/Auckland', '2026-11-14']]) {
        const localPage = await safePage({ timezoneId });
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
      assert.match(await page.locator('#search-limit').innerText(), /first 50 matches/);
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
      await page.locator('[name=lang]').selectOption('en');
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
      if (process.env.SITSERVE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SITSERVE_SCREENSHOT_DIR, 'sitserve-scroll.png') });
      await page.evaluate(() => scrollTo(0, 0));
    });

    await check('theme choice persists and both themes render', async () => {
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
      await page.locator('#theme').click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      await reload();
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      if (process.env.SITSERVE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SITSERVE_SCREENSHOT_DIR, 'sitserve-dark.png') });
      await page.locator('#theme').click();
      await page.locator('#theme').blur();
      if (process.env.SITSERVE_SCREENSHOT_DIR) {
        await page.screenshot({ path: path.join(process.env.SITSERVE_SCREENSHOT_DIR, 'sitserve-desktop.png') });
        await page.setViewportSize({ width: 390, height: 844 });
        await load();
        await page.screenshot({ path: path.join(process.env.SITSERVE_SCREENSHOT_DIR, 'sitserve-mobile.png') });
      }
      assert.deepEqual(errors, []);
    });
    await check('Search button states preserve pending edits in both themes', async () => {
      await page.goto(url);
      assert.equal(await page.locator('#search').getAttribute('data-state'), 'initial');
      await submit();
      assert.equal(await page.locator('#search').getAttribute('data-state'), 'complete');
      const original = await page.locator('[name=from]').inputValue();
      for (const theme of ['light', 'dark']) {
        if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#theme').click();
        await page.locator('[name=from]').fill('2027-01-01');
        assert.equal(await page.locator('#search').getAttribute('data-state'), 'pending');
        assert.match(await page.locator('#search-status').innerText(), /Filters changed/);
        await page.locator('[name=from]').fill(original);
        assert.equal(await page.locator('#search').getAttribute('data-state'), 'complete');
        assert.equal(await page.locator('#search').isEnabled(), true);
      }
    });
    await check('location photo hover uses the local proxy placeholder', async () => {
      await load();
      await page.locator('.row[data-id] .name[data-photo]').first().hover();
      assert.ok(await page.locator('#photo').isVisible());
      assert.match(await page.locator('#photo img').getAttribute('src'), /^\/photo\/(?:system\/images|assets)\//);
      await page.waitForFunction(() => document.querySelector('#photo img').complete && document.querySelector('#photo img').naturalWidth > 0);
    });
    await check('old language names restore ISO codes and empty results are clear', async () => {
      await load('lang=English&where=sublocation_2156');
      assert.equal(await page.locator('[name=lang]').inputValue(), 'en');
      assert.equal(await page.locator('.row[data-id]').count(), 0);
      assert.match(await page.locator('#list .empty').innerText(), /No courses/);
      assert.match(await page.locator('#checked').innerText(), /Checked/);
      assert.equal(await page.locator('#mode').innerText(), 'simulated data');
    });
    const hosted = async (vars, run) => {
      const local = await startServer({ vars });
      const p = await safePage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'UTC' });
      await p.clock.setFixedTime(new Date('2026-11-14T12:00:00Z'));
      try { await p.goto(local.url); await run(p, local); }
      finally { await p.close(); await local.stop(); await local.cleanup(); }
    };
    await check('streams rows during loading, disables Search, preserves submitted As while editing', async () => {
      await hosted({ SIMULATOR_DELAY_MS: '120', UPSTREAM_SPACING_MS: '150' }, async p => {
        await p.locator('#search').click();
        await p.waitForFunction(() => document.querySelector('#search').disabled);
        assert.equal(await p.locator('#search').getAttribute('data-state'), 'loading');
        await p.waitForFunction(() => document.querySelectorAll('.row[data-id]').length > 0 && document.querySelector('#search').disabled);
        assert.match(await p.locator('#search-status').innerText(), /Searching… through/);
        await p.locator('[name=as]').selectOption('SF');
        assert.equal(await p.locator('#list').getAttribute('data-as'), 'any');
        await p.waitForFunction(() => !document.querySelector('#search').disabled);
        assert.equal(await p.locator('.row[data-id]').count(), 50);
        assert.match(await p.locator('#search-limit').innerText(), /first 50 matches/);
        assert.equal(await p.locator('#search').getAttribute('data-state'), 'pending');
        assert.match(await p.locator('#search-status').innerText(), /Filters changed/);
        assert.equal(await p.locator('#list').getAttribute('data-as'), 'any');
      });
    });
    await check('Cancel aborts the stream; superseding submission cannot display stale rows', async () => {
      await hosted({ SIMULATOR_DELAY_MS: '100', UPSTREAM_SPACING_MS: '150' }, async (p, local) => {
        await p.locator('#search').click();
        await p.waitForFunction(() => document.querySelectorAll('.row[data-id]').length > 0 && document.querySelector('#search').disabled);
        await p.locator('#cancel').click();
        await p.waitForFunction(() => !document.querySelector('#search').disabled);
        assert.match(await p.locator('#search-limit').innerText(), /cancelled/i);
        const count = await p.locator('.row[data-id]').count();
        await p.waitForTimeout(350);
        assert.equal(await p.locator('.row[data-id]').count(), count);
        await p.locator('#search').click();
        await p.locator('[name=as]').selectOption('SF');
        await p.evaluate(() => document.querySelector('#filters').dispatchEvent(new Event('submit', { cancelable: true })));
        await p.waitForFunction(() => !document.querySelector('#search').disabled);
        assert.equal(await p.locator('#list').getAttribute('data-as'), 'SF');
        assert.equal(new URLSearchParams(new URL(p.url()).hash.slice(1)).get('as'), 'SF');
        assert.equal((await (await fetch(local.url + '/api/debug')).json()).activeSearches, 0);
      });
    });
    await check('page cap is clearly partial and suggests a later From or narrower filters', async () => {
      await hosted({ SIMULATOR_SCENARIO: 'sparse' }, async p => {
        await p.locator('#search').click(); await p.waitForFunction(() => !document.querySelector('#search').disabled);
        assert.equal(await p.locator('.row[data-id]').count(), 1);
        assert.match(await p.locator('#search-limit').innerText(), /Partial results.*Searched through.*later From.*narrower filters/);
      });
    });
    await check('SIMULATOR_FAULT errors and paused states require explicit Search retry', async () => {
      await hosted({ SIMULATOR_FAULT: 'html' }, async (p, local) => {
        const submitFault = async () => { await p.locator('#search').click(); await p.waitForFunction(() => !document.querySelector('#search').disabled); };
        await submitFault();
        assert.match(await p.locator('#search-limit').innerText(), /non-JSON/);
        assert.match(await p.locator('#search-status').innerText(), /Search to retry/);
        await p.waitForTimeout(150);
        assert.equal((await (await fetch(local.url + '/api/debug')).json()).simulatorRequests, 1);
        await submitFault();
        assert.match(await p.locator('#search-limit').innerText(), /paused/i);
        assert.equal((await (await fetch(local.url + '/api/debug')).json()).simulatorRequests, 1);
      });
    });
    console.log(`${passed} browser checks passed.`);
  } finally {
    await browser.close();
    await server.stop();
    await server.cleanup();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
