'use strict';
const assert = require('node:assert/strict');
const { getChromium, pageUrl } = require('./qa/browser-helpers');
(async () => {
  const browser = await getChromium().launch({ headless: true });
  try {
    for (const width of [412, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 840 } });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.clock.install(); await page.goto(pageUrl);
      await page.clock.pauseAt(await page.evaluate(() => new Date(Date.now() + 100)));
      await page.evaluate(() => { for(let i=2;i<30;i++) document.getElementById('addBtn').click(); document.getElementById('startBtn').click(); });
      assert.ok(await page.locator('#liveRanking').isHidden());
      await page.clock.runFor(3500);
      for(let sample=0;sample<3;sample++) {
        await page.clock.runFor(1000);
        const state = await page.evaluate(() => {
          const list = document.getElementById('liveRanking');
          return { ids:window.__avatarRace.getState().rankedIds.slice(0,15), background:getComputedStyle(list).backgroundColor,
            entries:Array.from(list.children).map(n=>({id:Number(n.dataset.id), rank:Number(n.querySelector('span').textContent), text:n.textContent, src:n.querySelector('img').src, transition:getComputedStyle(n).transitionTimingFunction})) };
        });
        assert.equal(state.entries.length,15); assert.equal(state.background,'rgba(0, 0, 0, 0)');
        state.entries.sort((a,b)=>a.rank-b.rank).forEach((entry,i)=>{ assert.equal(entry.id,state.ids[i]); assert.equal(entry.text,String(i+1)); assert.ok(entry.src.startsWith('data:image/')); assert.ok(entry.transition.includes('linear')); });
      }
      const rankBox=await page.locator('#liveRanking').boundingBox(), hudBox=await page.locator('.hud-panel').boundingBox();
      assert.ok(rankBox.y>=hudBox.y+hudBox.height && rankBox.x>=0 && rankBox.x+rankBox.width<=width);
      if(process.env.RANK_SCREENSHOT) await page.screenshot({path:process.env.RANK_SCREENSHOT+'-'+width+'.png'});
      await page.keyboard.press('Escape'); assert.equal(await page.locator('.live-rank').count(),0);
      await page.click('#startBtn'); await page.clock.runFor(3500); assert.equal(await page.locator('.live-rank').count(),15);
      assert.deepEqual(errors,[]); console.log('RANKING',width,'top15, avatars, transparent background, linear animation and restart passed');
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
