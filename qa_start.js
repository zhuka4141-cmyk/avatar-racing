// PW_PATH=/path/to/playwright-core node qa_start.js [screenshot-directory]
const { chromium } = require(process.env.PW_PATH || 'playwright-core');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const out = path.resolve(process.argv[2] || path.join(__dirname, 'qa-start'));
const url = pathToFileURL(path.join(__dirname, 'index.html')).href;
fs.mkdirSync(out, { recursive:true });
async function state(page) {
  return page.evaluate(() => {
    const r = window.__avatarRace.race;
    return { phase:r.phase, elapsed:r.elapsed, wait:r.waitingElapsed,
      finished:r.cars.filter(c => c.finished).length, cam:r.cam.s,
      finish:r.track.raceLen, results:r.results.length,
      cars:r.cars.map(c => ({ id:c.p.id, s:c.s, v:c.v, lateral:c.lateral, broken:c.broken })) };
  });
}
(async () => {
  const browser = await chromium.launch({ headless:true });
  try {
    for (const cfg of [
      { name:'mobile-15', count:15, width:412, height:840 },
      { name:'desktop-8', count:8, width:1280, height:800 },
      { name:'mobile-120', count:120, width:412, height:840 },
      { name:'timeout-12', count:12, width:412, height:840, timeout:true }
    ]) {
      const page = await browser.newPage({ viewport:{ width:cfg.width, height:cfg.height } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await page.clock.install();
      await page.goto(url);
      await page.evaluate(n => {
        for (let i=2;i<n;i++) document.getElementById('addBtn').click();
        document.getElementById('startBtn').click();
      }, cfg.count);
      const grid = await state(page);
      assert.equal(grid.phase, 'countdown');
      for (let i=0;i<grid.cars.length;i++) for (let j=i+1;j<grid.cars.length;j++) {
        assert.ok(Math.abs(grid.cars[i].s-grid.cars[j].s) >= 86 || Math.abs(grid.cars[i].lateral-grid.cars[j].lateral) >= 50);
      }
      await page.screenshot({ path:path.join(out,cfg.name+'-grid.png') });
      await page.clock.runFor(5100);
      const launched = await state(page);
      assert.equal(launched.phase, 'racing');
      assert.ok(launched.cars.every((c,i) => c.s-grid.cars[i].s > 100 && !c.broken));
      await page.screenshot({ path:path.join(out,cfg.name+'-launch.png') });
      if (cfg.timeout) await page.evaluate(() => {
        window.__avatarRace.race.cars.slice(1).forEach(c => { c.baseSpeed *= 0.1; });
      });
      await page.clock.runFor(6800);
      await page.screenshot({ path:path.join(out,cfg.name+'-race.png') });
      if (cfg.count === 120) {
        assert.ok((await state(page)).cars.every(c => !c.broken && Number.isFinite(c.s)));
        await page.close();
        assert.deepEqual(errors, []);
        console.log(cfg.name, 'grid, launch and 8-second simulation passed');
        continue;
      }
      let settled;
      for (let i=0;i<120;i++) {
        await page.clock.runFor(250);
        settled = await state(page);
        if (settled.phase === 'ending' || settled.phase === 'results') break;
      }
      assert.ok(['ending','results'].includes(settled.phase));
      assert.equal(settled.results,cfg.count);
      assert.ok(settled.finished >= Math.min(10,cfg.count) || settled.wait >= 5);
      assert.ok(settled.wait <= 5.04);
      if (cfg.timeout) assert.ok(settled.finished < 10 && settled.wait >= 5);
      await page.clock.runFor(2500);
      const finishView = await state(page);
      assert.ok(Math.abs(finishView.cam-finishView.finish+40) < 1, 'camera not locked at finish');
      await page.evaluate(() => document.getElementById('rankBtn').click());
      assert.equal(await page.locator('#board .row').count(),cfg.count);
      await page.screenshot({ path:path.join(out,cfg.name+'-results.png') });
      await page.click('#againBtn');
      await page.clock.runFor(5100);
      const replay = await state(page);
      assert.equal(replay.phase,'racing');
      assert.equal(replay.cars.length,cfg.count);
      assert.ok(replay.cars.every(c => !c.broken && c.v > 0));
      assert.deepEqual(errors, []);
      console.log(cfg.name, JSON.stringify({ settledAt:+settled.elapsed.toFixed(2), finished:settled.finished,
        wait:+settled.wait.toFixed(2), replay:true, errors:errors.length }));
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
