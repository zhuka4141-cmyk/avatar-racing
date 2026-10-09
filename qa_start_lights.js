'use strict';
const assert = require('node:assert/strict');
const { getChromium, pageUrl } = require('./qa/browser-helpers');
(async () => {
  const browser = await getChromium().launch({ headless: true });
  try {
    for (const width of [412, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 840 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.clock.install();
      await page.addInitScript(() => {
        window.toneEvents = [];
        const Base = window.AudioContext;
        window.AudioContext = class extends Base {
          createOscillator() {
            const oscillator = super.createOscillator(), start = oscillator.start.bind(oscillator), stop = oscillator.stop.bind(oscillator);
            oscillator.start = time => { window.toneEvents.push({ action: 'start', time, frequency: oscillator.frequency.value }); start(time); };
            oscillator.stop = time => { window.toneEvents.push({ action: 'stop', time }); stop(time); };
            return oscillator;
          }
        };
      });
      await page.goto(pageUrl);
      await page.clock.pauseAt(await page.evaluate(() => new Date(Date.now() + 100)));
      await page.click('#startBtn');
      const positions = await page.evaluate(() => window.__avatarRace.getCars().map(c => c.s));
      async function check(lit, phase) {
        assert.equal(await page.locator('.start-light.lit').count(), lit);
        assert.equal(await page.evaluate(() => window.__avatarRace.getState().phase), phase);
        if (phase === 'countdown') assert.deepEqual(await page.evaluate(() => window.__avatarRace.getCars().map(c => c.s)), positions);
      }
      await check(1, 'countdown');
      await page.clock.runFor(1050); await check(2, 'countdown');
      await page.clock.runFor(1000); await check(3, 'countdown');
      const box = await page.locator('.start-lights').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width);
      if (process.env.LIGHTS_SCREENSHOT) await page.screenshot({ path: process.env.LIGHTS_SCREENSHOT + '-' + width + '.png' });
      await page.clock.runFor(900); await check(3, 'countdown');
      await page.clock.runFor(100); await check(0, 'racing'); assert.ok(await page.locator('#countdown').isHidden());
      const tones = await page.evaluate(() => window.toneEvents.filter(e => e.action === 'start'));
      assert.equal(tones.length, 4);
      assert.deepEqual(tones.map(t => Math.round(t.time - tones[0].time)), [0, 1, 2, 3]);
      await page.keyboard.press('Escape');
      await page.click('#startBtn'); await check(1, 'countdown');
      await page.clock.runFor(3050); await check(0, 'racing');
      assert.equal(await page.evaluate(() => window.toneEvents.filter(e => e.action === 'start').length), 8);
      assert.deepEqual(errors, []); console.log('LIGHTS', width, 'sequence, 3 seconds, audio schedule, cancel and restart passed');
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
