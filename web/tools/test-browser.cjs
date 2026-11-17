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
    const expandFilters = async () => {
      if (await page.locator('#filter-toggle').getAttribute('aria-expanded') === 'false') await page.locator('#filter-toggle').click();
      await page.waitForFunction(() => !document.querySelector('#filter-panel').hasAttribute('data-animating'));
    };
    const collapseFilters = async () => {
      if (await page.locator('#filter-toggle').getAttribute('aria-expanded') === 'true') await page.locator('#filter-toggle').click();
      await page.waitForFunction(() => !document.querySelector('#filter-panel').hasAttribute('data-animating'));
    };
    const submit = async ({ edit = true } = {}) => {
      await expandFilters();
      await page.locator('#search').click();
      await page.waitForFunction(() => !document.querySelector('#search').disabled && document.querySelector('#filter-controls').hidden);
      if (edit) await expandFilters();
    };
    const load = async fragment => {
      // These checks start a new search; returning to a saved search is checked separately.
      await page.evaluate(() => localStorage.removeItem('sit.search'));
      await page.goto(url + (fragment ? '#' + fragment : ''));
      await submit();
    };
    const reload = async () => {
      await page.reload();
      await page.waitForFunction(() => !document.querySelector('#search').disabled && document.querySelector('#filter-controls').hidden);
      await expandFilters();
    };
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
      assert.equal(await page.locator('.search-state').isVisible(), false);
      assert.equal(await page.locator('footer').isVisible(), false);
      assert.equal(await page.locator('#list').innerText(), 'Choose your filters and press Search to find up to 50 matching courses.');
      assert.match(await page.locator('#list').innerText(), /press Search/);
      assert.ok(await page.locator('#search').isVisible());
      assert.ok(await page.locator('#filter-toggle').isVisible());
      assert.equal(await page.locator('#filter-toggle svg').count(), 1);
      assert.equal(await page.locator('#filter-toggle').innerText(), '');
      assert.equal(await page.locator('#filter-toggle').getAttribute('aria-label'), 'Hide filters');
      if (process.env.SITSERVE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SITSERVE_SCREENSHOT_DIR, 'sitserve-initial.png') });
      const expandedHeight = (await page.locator('.bar').boundingBox()).height;
      await page.locator('#search').click();
      await page.waitForFunction(() => !document.querySelector('#search').disabled);
      assert.ok(await page.locator('.row[data-id]').count() > 0);
      assert.ok(await page.locator('#place-search').isVisible(), 'results appear before filters close');
      await page.waitForFunction(() => document.querySelector('#filter-panel').dataset.animating === 'true');
      await page.waitForFunction(() => {
        const opacity = +getComputedStyle(document.querySelector('#filter-controls')).opacity;
        return opacity > .05 && opacity < .95;
      });
      await page.waitForFunction(() => document.querySelector('#filter-controls').hidden);
      assert.equal(await page.locator('#filter-controls').isVisible(), false);
      assert.ok(await page.locator('footer').isVisible());
      assert.match(await page.locator('footer #checked').innerText(), /^Checked/);
      assert.equal(await page.locator('.search-state').isVisible(), false, 'a finished search has no status line');
      assert.match(await page.locator('#usage').innerText(), /^Simulated requests today \(UTC\): \d+ pages?, 0 photos$/);
      assert.equal(await page.locator('#search').isVisible(), false);
      assert.equal(await page.locator('#filter-toggle').getAttribute('aria-label'), 'Edit filters');
      assert.equal(await page.locator('#filter-summary [data-filter=where]').innerText(), 'Everywhere');
      assert.equal(await page.locator('#filter-summary [data-filter=from]').innerText(), 'From Nov 14, 2026');
      assert.equal(await page.locator('#filter-summary [data-filter=types]').innerText(), 'All courses');
      assert.ok((await page.locator('.bar').boundingBox()).height < expandedHeight - 20);
      await page.locator('#filter-summary [data-filter=types]').click();
      await page.waitForFunction(() => !document.querySelector('#filter-panel').hasAttribute('data-animating'));
      assert.equal(await page.locator('#filter-toggle').getAttribute('aria-expanded'), 'true', 'clicking the collapsed bar reopens the filters');
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

    await check('return visits rerun only the last submitted search and reuse cached results', async () => {
      const context = await browser.newContext({ timezoneId: 'UTC' });
      await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
      context.on('page', p => p.on('pageerror', error => errors.push(error.message)));
      let requests = 0;
      context.on('request', request => { if (new URL(request.url()).pathname === '/api/search') requests++; });
      const open = async (date = '2026-11-14T12:00:00Z') => {
        const p = await context.newPage();
        await p.clock.setFixedTime(new Date(date));
        return p;
      };
      let p = await open();
      const complete = () => p.waitForFunction(() => !document.querySelector('#search').disabled && document.querySelector('#filter-controls').hidden);
      const ids = () => p.locator('.row[data-id]').evaluateAll(rows => rows.map(row => row.dataset.id));
      try {
        await p.goto(url + '#where=region_402&types=10D');
        assert.equal(await p.locator('#search').getAttribute('data-state'), 'initial');
        assert.equal(requests, 0, 'a new shared link waits for Search');
        await p.locator('#search').click();
        await complete();
        const originalIDs = await ids(), submittedURL = p.url();
        assert.ok(originalIDs.length > 0);
        assert.equal(requests, 1);
        await p.locator('#filter-toggle').click();
        await p.waitForFunction(() => !document.querySelector('#filter-panel').hasAttribute('data-animating'));
        await p.locator('[name=from]').fill('2027-01-01');
        await p.locator('[name=as]').selectOption('OM');
        await p.close();

        p = await open();
        const response = p.waitForResponse(response => new URL(response.url()).pathname === '/api/search');
        await p.goto(url);
        await complete();
        assert.equal(requests, 2, 'reopening submits exactly one search without a click');
        assert.equal(await p.locator('[name=from]').inputValue(), '2026-11-14');
        assert.equal(await p.locator('[name=as]').inputValue(), 'any', 'unsent edits are discarded');
        assert.equal(await p.locator('[name=where]').inputValue(), 'region_402');
        assert.equal(await p.locator('[name=types][value="10D"]').isChecked(), true);
        assert.deepEqual(await ids(), originalIDs);
        const progress = (await (await response).text()).trim().split('\n').map(line => JSON.parse(line)).filter(event => event.type === 'progress');
        assert.ok(progress.length > 0 && progress.every(event => event.cacheHit), 'the restored search uses the backend cache');
        await p.reload();
        await complete();
        assert.equal(requests, 3, 'reloading the submitted URL also reruns the search once');
        assert.deepEqual(await ids(), originalIDs);
        await p.close();

        p = await open();
        await p.goto(url + '#types=20D');
        assert.equal(await p.locator('#search').getAttribute('data-state'), 'initial');
        assert.equal(await p.locator('[name=types][value="20D"]').isChecked(), true);
        assert.equal(await p.locator('.row[data-id]').count(), 0);
        assert.equal(requests, 3, 'a different shared link takes precedence and waits for Search');
        await p.close();

        p = await open('2026-11-15T12:00:00Z');
        await p.goto(submittedURL);
        await complete();
        assert.equal(requests, 4);
        assert.equal(await p.locator('[name=from]').inputValue(), '2026-11-14', 'an implicit From date survives returning on a later day');
        assert.deepEqual(await ids(), originalIDs, 'an unsubmitted shared link does not replace the saved search');
      } finally { await context.close(); }
    });

    await check('invalid or blocked saved-search storage leaves explicit Search working', async () => {
      for (const blocked of [false, true]) {
        const p = await safePage({ timezoneId: 'UTC' });
        p.on('pageerror', error => errors.push(error.message));
        try {
          await p.clock.setFixedTime(new Date('2026-11-14T12:00:00Z'));
          await p.addInitScript(blocked => {
            if (blocked) Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage blocked', 'SecurityError'); } });
            else localStorage.setItem('sit.search', 'from=invalid');
          }, blocked);
          await p.goto(url + '#types=10D');
          assert.equal(await p.locator('#search').getAttribute('data-state'), 'initial');
          assert.equal(await p.locator('[name=types][value="10D"]').isChecked(), true);
          await p.locator('#search').click();
          await p.waitForFunction(() => !document.querySelector('#search').disabled && document.querySelector('#filter-controls').hidden);
          assert.ok(await p.locator('.row[data-id]').count() > 0);
        } finally { await p.close(); }
      }
    });

    await check('desktop grid, type groups, buttons, icons and local rectangular flags', async () => {
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
      assert.ok(await page.locator('.flag img').evaluateAll(imgs => imgs.length > 0 && imgs.every(img => {
        const rect = img.getBoundingClientRect();
        return img.naturalWidth > 0 && Math.abs(img.naturalWidth / img.naturalHeight - 4 / 3) < .01
          && rect.width === 16 && rect.height === 12;
      })));
      assert.ok(await page.locator('.type').first().evaluate(el => getComputedStyle(el).justifyContent === 'center'));
      assert.ok(await page.locator('.filter-row').evaluateAll(rows => rows.every(row => {
        const cells = [...row.children].filter(el => !el.hidden).map(el => el.getBoundingClientRect());
        return cells.every(r => Math.abs(r.top + r.height / 2 - cells[0].top - cells[0].height / 2) < 1);
      })), 'desktop controls share their requested rows');
      assert.ok(await page.locator('#filters').evaluate(form => {
        const box = sel => form.querySelector(sel).getBoundingClientRect();
        const middle = r => r.top + r.height / 2, row = box('.filter-main');
        return ['.brand', '#filter-toggle', '#theme'].every(sel => Math.abs(middle(box(sel)) - middle(row)) < 1)
          && box('.brand').right <= box('.where-box').left && box('#search').right <= box('#filter-toggle').left;
      }), 'the wheel, Search and tools share the first row');
      assert.equal(await page.locator('#filter-controls #search-status').count(), 1, 'status text sits by the Search button');
      assert.equal(await page.locator('#types .chip.long span').evaluateAll(spans => new Set(spans.map(span => getComputedStyle(span).backgroundColor)).size), 1, 'filter chips keep one color per group');
      assert.ok(await page.locator('.row[data-id] .type-code').evaluateAll(badges => {
        const colors = new Map(badges.map(badge => [badge.textContent, getComputedStyle(badge).backgroundColor]));
        return colors.size >= 6 && new Set(colors.values()).size === colors.size;
      }), 'each course type has its own badge color in the results');
      assert.equal(await page.locator('#lang-code').innerText(), '');
      if (process.env.SITSERVE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SITSERVE_SCREENSHOT_DIR, 'sitserve-expanded.png') });
    });

    await check('auto-collapse preserves selected filters, and reopening keeps results and pending edits', async () => {
      await page.goto(url + '#where=region_402&types=10D&as=OM&lang=en&centers=1&wait=0&soon=0');
      const values = () => page.locator('#filters').evaluate(form => [...new FormData(form).entries()]);
      const original = await values();
      await submit({ edit: false });
      const submittedIDs = await rowIDs();
      assert.equal(await page.locator('#filter-summary [data-filter=where]').innerText(), 'Americas');
      assert.equal(await page.locator('#filter-summary [data-filter=types]').innerText(), '10D');
      assert.match(await page.locator('#filter-summary [data-filter=options]').innerText(), /Old male.*English.*Centers only.*No wait lists/s);
      await page.locator('#filter-toggle').focus();
      await page.keyboard.press('Enter');
      await expandFilters();
      assert.equal(await page.locator('#filter-toggle').getAttribute('aria-expanded'), 'true');
      assert.deepEqual(await values(), original);
      assert.deepEqual(await rowIDs(), submittedIDs);
      await page.locator('[name=from]').fill('2026-12-01');
      await collapseFilters();
      assert.match(await page.locator('#filter-summary').innerText(), /From Dec 1, 2026/);
      assert.match(await page.locator('#search-status').innerText(), /Filters changed/);
      assert.equal(await page.locator('#search').isVisible(), false);
      assert.deepEqual(await rowIDs(), submittedIDs);
      await expandFilters();
      assert.equal(await page.locator('[name=from]').inputValue(), '2026-12-01');
      await load();
    });

    await check('keyboard submission moves focus out of the collapsed controls', async () => {
      await search.focus();
      await search.press('Escape');
      await search.press('Enter');
      await page.waitForFunction(() => document.querySelector('#filter-controls').hidden);
      assert.equal(await page.locator('#filter-toggle').evaluate(el => el === document.activeElement), true);
      await expandFilters();
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
      await load('where=sublocation_15175');
      assert.deepEqual(await rowIDs(), expected.venue);
      await load('where=unknown_1,location_1542,location_1542');
      assert.equal(await page.locator('[name=where]').inputValue(), 'location_1542');
    });

    await check('place picker holds at most ten places', async () => {
      const { places, MAX_PLACES } = await import('../shared/courses.js');
      const keys = places.slice(0, MAX_PLACES + 1).map(p => p.key);
      await load('where=' + keys.join(','));
      assert.equal(await page.locator('[name=where]').inputValue(), keys.slice(0, MAX_PLACES).join(','));
      await search.fill('dhara');
      assert.equal(await page.locator('#place-options [role=option]').count(), 0);
      assert.equal(await page.locator('#place-options').innerText(), 'Up to 10 places. Remove one to add another.');
      assert.equal(await page.locator('#place-status').textContent(), 'Up to 10 places. Remove one to add another.');
      await search.fill('');
      await search.press('Backspace');
      await pick('dhara', 'location_1542');
      assert.equal(await page.locator('[name=where]').inputValue(), [...keys.slice(0, MAX_PLACES - 1), 'location_1542'].join(','));
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
      assert.ok(await page.locator('.l.hl').evaluateAll(cells => cells.every(el => getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)')));
      assert.ok(await page.locator('.head .l').evaluateAll(cells => new Set(cells.map(el => getComputedStyle(el).color)).size === 1));
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

    await check('Type and Dates headings sort rows within each month and the choice persists', async () => {
      // Each month's rows as [id, type code], in display order.
      const months = () => page.locator('#list .month').evaluateAll(sections => sections.map(section =>
        [...section.querySelectorAll('.row[data-id]')].map(row => [row.dataset.id, row.querySelector('.type-code').textContent])));
      const pressed = () => page.locator('.column-head.sortable').evaluateAll(els => els.filter(el => el.getAttribute('aria-pressed') === 'true').map(el => el.dataset.column));
      assert.deepEqual(await page.locator('.column-head.sortable').evaluateAll(els => els.map(el => el.dataset.column).sort()), ['dates', 'type']);
      assert.deepEqual(await pressed(), ['dates']);
      const byDate = await months();
      const chips = await page.locator('#types input').evaluateAll(inputs => inputs.map(i => i.value));
      const rank = code => chips.indexOf(['14D', 'TSC'].includes(code) ? '14D/TSC' : code);
      const expected = byDate.map(rows => [...rows].sort((a, b) => rank(a[1]) - rank(b[1])));
      assert.notDeepEqual(expected, byDate, 'fixture needs a month whose date and type orders differ');
      await page.locator('.column-head[data-column=type]').click();
      assert.deepEqual(await pressed(), ['type']);
      assert.deepEqual(await months(), expected);
      assert.equal(await page.locator('.column-head[data-column=type]').evaluate(el => el === document.activeElement), true);
      assert.equal(await page.locator('.column-head[data-column=type] svg').evaluate(el => getComputedStyle(el).opacity), '1');
      await reload();
      assert.deepEqual(await months(), expected);
      await page.locator('.column-head[data-column=dates]').press('Enter');
      assert.deepEqual(await pressed(), ['dates']);
      assert.deepEqual(await months(), byDate);
      await page.evaluate(() => localStorage.removeItem('sit.sort'));
    });

    await check('no horizontal overflow at phone, breakpoint and desktop widths', async () => {
      for (const width of [320, 375, 390, 600, 820, 821, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.waitForFunction(() => Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--head-h')) - (document.querySelector('.head')?.getBoundingClientRect().height || 0)) < .01);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}px`);
        assert.equal(await page.locator('.column-head[data-column=location]').isVisible(), width > 820);
        assert.ok(await page.locator('.column-head[data-column=lights]').isVisible());
        const expandedHeight = (await page.locator('.bar').boundingBox()).height;
        await collapseFilters();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `collapsed header overflow at ${width}px`);
        assert.ok((await page.locator('.bar').boundingBox()).height < expandedHeight, `collapsed height at ${width}px`);
        assert.equal(await page.locator('#search').isVisible(), false);
        for (const button of ['#filter-toggle', '#theme']) assert.ok(await page.locator(button).evaluate(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.left >= 0 && r.right <= innerWidth;
        }), `${button} clipped at ${width}px`);
        const tools = await page.locator('.filter-tools').evaluate(el => {
          const [toggle, theme] = el.children;
          const a = toggle.getBoundingClientRect(), b = theme.getBoundingClientRect();
          return { gap: b.left - a.right, top: Math.abs(a.top - b.top) };
        });
        assert.equal(tools.gap, 8);
        assert.equal(tools.top, 0);
        await expandFilters();
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

    await check('phone rows take two lines and the collapsed summary wraps after the wheel', async () => {
      await page.setViewportSize({ width: 360, height: 800 });
      await load('from=2027-01-10&types=20D,30D,45D,60D,10D%20SPCL');
      const rows = await page.evaluate(() => [...document.querySelectorAll('.row[data-id]')].map(row => {
        const box = k => row.querySelector(`[data-column=${k}]`).getBoundingClientRect();
        const spread = boxes => Math.max(...boxes.map(b => b.top + b.height / 2)) - Math.min(...boxes.map(b => b.top + b.height / 2));
        const r = row.getBoundingClientRect(), location = box('location'), links = box('links'), apply = box('apply');
        const dates = box('dates'), type = box('type'), lights = box('lights'), soon = row.querySelector('.soon');
        return {
          height: r.height,
          line1: spread([location, links, lights]),
          line2: spread([dates, type, apply]),
          stacked: Math.min(dates.top, type.top, apply.top) >= Math.max(location.bottom, lights.bottom) - 1,
          applyInset: r.right - apply.right, lightsInset: r.right - lights.right, iconGap: links.left - location.right,
          button: row.querySelector('[data-column=apply] > *').innerText,
          soon: soon && getComputedStyle(soon).display !== 'none' ? soon.textContent : null,
        };
      }));
      assert.ok(rows.length > 3 && rows.some(r => r.soon), 'fixture needs a course that is not open yet');
      for (const r of rows) {
        assert.ok(r.height < 70 && r.line1 < 2 && r.line2 < 2 && r.stacked, `two lines: ${JSON.stringify(r)}`);
        assert.ok(Math.abs(r.applyInset - 12) < 1 && Math.abs(r.lightsInset - 12) < 1 && Math.abs(r.iconGap - 6) < 1, `edges: ${JSON.stringify(r)}`);
        assert.equal(r.button, 'Apply');
        if (r.soon) assert.match(r.soon, /^Opens \d+ [A-Z][a-z]{2}$/);
      }
      // One lights key sits over the lights' fixed slots; month headings carry none.
      const offsets = await page.evaluate(() => {
        const row = [...document.querySelectorAll('.row[data-id]')].find(r => !r.querySelector('.soon'));
        const centers = els => [...els].map(el => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; });
        const lights = centers(row.querySelectorAll('.lights .l'));
        return centers(document.querySelectorAll('.head .l')).map((x, i) => Math.abs(x - lights[i]));
      });
      assert.equal(offsets.length, 6);
      assert.ok(offsets.every(d => d < .5), `key offsets ${offsets}`);
      assert.equal(await page.locator('h2 .l').count(), 0);
      // The key shares one sticky band with the month heading stuck at the top of the viewport.
      const position = await page.evaluate(() => Math.min(600, document.documentElement.scrollHeight - innerHeight));
      await page.evaluate(position => scrollTo(0, position), position);
      await page.waitForFunction(position => scrollY === position, position);
      const sticky = await page.evaluate(() => {
        const head = document.querySelector('.head').getBoundingClientRect();
        const month = [...document.querySelectorAll('h2')].filter(h => h.getBoundingClientRect().top < 1).at(-1).getBoundingClientRect();
        const key = document.querySelector('.head .lights').getBoundingClientRect();
        // The band has the column headings' color; month headings further down are dimmer.
        const band = getComputedStyle(document.querySelector('.head')).backgroundColor;
        const below = [...document.querySelectorAll('.month')].find(m => m.getBoundingClientRect().top > head.bottom);
        const root = getComputedStyle(document.documentElement);
        return {
          headTop: head.top, monthTop: month.top, keyInside: key.top >= month.top && key.bottom <= month.bottom,
          band, header: root.getPropertyValue('--header-bg'), below: below && getComputedStyle(below, '::before').backgroundColor,
          dim: root.getPropertyValue('--month-bg'), monthOwn: getComputedStyle(document.querySelector('h2')).backgroundColor,
        };
      });
      assert.ok(sticky.headTop === 0 && sticky.monthTop === 0 && sticky.keyInside, JSON.stringify(sticky));
      const rgb = hex => `rgb(${hex.trim().match(/\w\w/g).map(h => parseInt(h, 16)).join(', ')})`;
      assert.equal(sticky.band, rgb(sticky.header));
      assert.equal(sticky.below, rgb(sticky.dim));
      assert.equal(sticky.monthOwn, 'rgba(0, 0, 0, 0)');
      await page.evaluate(() => scrollTo(0, 0));

      await load('where=region_402&types=10D,20D,STP,3D&as=OM&lang=en&centers=1&wait=0');
      assert.equal(await page.locator('.filter-heading').evaluate(el => el.getBoundingClientRect().height), 30, 'open filters leave no room for the summary');
      await collapseFilters();
      const summary = await page.evaluate(() => {
        const brand = document.querySelector('.brand').getBoundingClientRect(), tools = document.querySelector('.filter-tools').getBoundingClientRect();
        const s = document.querySelector('#filter-summary');
        const tokens = [...s.querySelectorAll('.filter-token')].map(t => t.getBoundingClientRect());
        return {
          scroll: s.scrollWidth - s.clientWidth,
          lines: new Set(tokens.map(t => Math.round(t.top + t.height / 2))).size,
          afterWheel: tokens.every(t => t.left >= brand.right + 9.5),
          inView: tokens.every(t => t.right <= innerWidth - 15.5),
          clearOfTools: tokens.every(t => t.bottom <= tools.top || t.top >= tools.bottom || t.right <= tools.left),
          underTools: tokens.some(t => t.top >= tools.bottom && t.right > tools.left),
        };
      });
      assert.equal(summary.scroll, 0);
      assert.ok(summary.lines > 1 && summary.afterWheel && summary.inView && summary.clearOfTools && summary.underTools, JSON.stringify(summary));
      await page.setViewportSize({ width: 1440, height: 1000 });
      await load();
    });

    await check('sticky headers overlap without a seam and titles stay aligned', async () => {
      for (const width of [821, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const collapsed of [false, true]) {
          if (collapsed) await collapseFilters(); else await expandFilters();
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
          assert.ok(dimensions.barGap <= 0 && dimensions.barGap >= -1.1, `filter seam at ${width}px (${collapsed ? 'collapsed' : 'expanded'}): ${JSON.stringify(dimensions)}`);
          assert.ok(dimensions.monthGap <= 0 && dimensions.monthGap >= -1.1, `month seam at ${width}px: ${JSON.stringify(dimensions)}`);
          assert.equal(dimensions.locationX, dimensions.flagX);
        }
      }
      assert.match(await page.locator('h2').first().textContent(), /^2026 November/);
      if (process.env.SITSERVE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SITSERVE_SCREENSHOT_DIR, 'sitserve-scroll.png') });
      await page.evaluate(() => scrollTo(0, 0));
      await expandFilters();
    });

    await check('theme choice persists and both themes render', async () => {
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
      await page.locator('#theme').click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      await reload();
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      await collapseFilters();
      if (process.env.SITSERVE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SITSERVE_SCREENSHOT_DIR, 'sitserve-dark.png') });
      await page.locator('#theme').click();
      await page.locator('#theme').blur();
      await page.mouse.move(0, 0);
      if (process.env.SITSERVE_SCREENSHOT_DIR) {
        await page.screenshot({ path: path.join(process.env.SITSERVE_SCREENSHOT_DIR, 'sitserve-desktop.png') });
        await page.setViewportSize({ width: 390, height: 844 });
        await load();
        await collapseFilters();
        await page.screenshot({ path: path.join(process.env.SITSERVE_SCREENSHOT_DIR, 'sitserve-mobile.png') });
      }
      assert.deepEqual(errors, []);
    });
    await check('Search button states preserve pending edits in both themes', async () => {
      await page.evaluate(() => localStorage.removeItem('sit.search'));
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
      const names = page.locator('.row[data-id] .name[data-photo]');
      // Passing over a name for less than the hover delay requests no photo.
      await names.first().hover(); await page.mouse.move(0, 0); await page.waitForTimeout(300);
      assert.equal(await page.locator('#photo').isVisible(), false);
      assert.equal(await page.locator('#photo img').getAttribute('src'), null);
      await names.first().hover();
      assert.equal(await page.locator('#photo').isVisible(), false, 'photo waits for the hover delay');
      await page.locator('#photo').waitFor({ state: 'visible' });
      assert.match(await page.locator('#photo img').getAttribute('src'), /^\/photo\/(?:system\/images|assets)\//);
      await page.waitForFunction(() => document.querySelector('#photo img').complete && document.querySelector('#photo img').naturalWidth > 0);
    });
    await check('touch taps show row-detail tooltips only, with no photo or sticky hover', async () => {
      const p = await safePage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, timezoneId: 'UTC' });
      try {
        await p.clock.setFixedTime(new Date('2026-11-14T12:00:00Z'));
        p.on('pageerror', error => errors.push(error.message));
        await p.goto(url);
        await p.locator('#search').tap();
        await p.waitForFunction(() => !document.querySelector('#search').disabled && document.querySelector('#filter-controls').hidden);
        assert.equal(await p.evaluate(() => matchMedia('(hover: hover)').matches), false);
        const tip = p.locator('#tip'), row = p.locator('.row[data-id]').first();
        await p.locator('#theme').tap();
        assert.equal(await tip.isVisible(), false, 'controls show no tooltip');
        // Links stay put so the tapped name doesn't open the location's website.
        await p.evaluate(() => document.addEventListener('click', e => e.preventDefault(), { capture: true }));
        await p.locator('.row[data-id] .name[data-photo]').first().tap();
        await p.waitForTimeout(300);
        assert.equal(await p.locator('#photo').isVisible(), false, 'names show no photo');
        assert.equal(await tip.isVisible(), false);
        for (const detail of ['.dates', '.flag', '.type-code']) {
          await row.locator(detail).tap();
          assert.equal(await tip.innerText(), await row.locator(detail).getAttribute('data-tip'), detail);
        }
        await row.locator('.type-code').tap();
        assert.equal(await tip.isVisible(), false, 'a second tap closes it');
        await row.locator('.dates').tap();
        await p.locator('h2').first().tap();
        assert.equal(await tip.isVisible(), false, 'a tap elsewhere closes it');
        const background = await row.evaluate(el => getComputedStyle(el).backgroundColor);
        assert.equal(background, 'rgba(0, 0, 0, 0)', 'the tapped row keeps no hover background');
      } finally { await p.close(); }
    });
    await check('old language names restore ISO codes and empty results are clear', async () => {
      await load('lang=English&where=sublocation_2156');
      assert.equal(await page.locator('[name=lang]').inputValue(), 'en');
      assert.equal(await page.locator('#lang-code').innerText(), 'en');
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
        assert.ok(await p.locator('#place-search').isVisible(), 'pending edits must stay expanded');
        await p.locator('#search').click();
        await p.waitForFunction(() => !document.querySelector('#search').disabled && document.querySelector('#filter-controls').hidden);
        assert.equal(await p.locator('#search').isVisible(), false);
        await p.locator('#filter-toggle').click();
        await p.waitForFunction(() => !document.querySelector('#filter-panel').hasAttribute('data-animating'));
        await p.locator('#search').click();
        await p.waitForFunction(() => document.querySelector('#search').disabled);
        await p.locator('#filter-toggle').click();
        assert.equal(await p.locator('#filter-toggle').getAttribute('aria-label'), 'Edit filters');
        await p.locator('#filter-toggle').click();
        await p.waitForFunction(() => !document.querySelector('#search').disabled);
        assert.ok(await p.locator('#place-search').isVisible(), 'reopening during a refresh must stay expanded');
      });
    });
    await check('Cancel aborts the stream; superseding submission cannot display stale rows', async () => {
      await hosted({ SIMULATOR_DELAY_MS: '100', UPSTREAM_SPACING_MS: '150' }, async (p, local) => {
        await p.locator('#search').click();
        await p.waitForFunction(() => document.querySelectorAll('.row[data-id]').length > 0 && document.querySelector('#search').disabled);
        await p.locator('#cancel').click();
        await p.waitForFunction(() => !document.querySelector('#search').disabled);
        assert.match(await p.locator('#search-limit').innerText(), /cancelled/i);
        assert.ok(await p.locator('#place-search').isVisible());
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
        assert.match(await p.locator('#search-status').innerText(), /non-JSON.*Search to retry/);
        assert.ok(await p.locator('#search-status').isVisible());
        assert.ok(await p.locator('#place-search').isVisible());
        await p.waitForTimeout(150);
        assert.equal((await (await fetch(local.url + '/api/debug')).json()).simulatorRequests, 1);
        await submitFault();
        assert.match(await p.locator('#search-status').innerText(), /paused/i);
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
