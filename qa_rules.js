const assert = require('node:assert/strict');
const { getChromium, pageUrl, ensureOutputDir, outputPath, assertNoPageErrors } = require('./qa/browser-helpers');
const chromium = getChromium();
const URL = pageUrl;
const OUT = ensureOutputDir();
const errors = [];
function P(l,v){ console.log(l + ' ' + JSON.stringify(v)); }
function snap(page,n){ return page.screenshot({ path: outputPath(n + '.png') }); }
function state(page){ return page.evaluate(function(){ var api=window.__avatarRace, r=api.getState(), cars=api.getCars(); var fin=0; for(var i=0;i<cars.length;i++) if(cars[i].finished) fin++; return { phase:r.phase, cars:cars.length, fin:fin, t:+r.elapsed.toFixed(2), wait:+r.waitingElapsed.toFixed(2) }; }); }
async function setup(page, extra){
  await page.goto(URL);
  await page.click('#sampleBtn');
  await page.evaluate(function(k){ for (var i=0;i<k;i++) document.getElementById('addBtn').click(); }, extra);
  return page.evaluate(function(){ return document.querySelectorAll('.card').length; });
}
[
  { name:'RULE_ALL_FINISHED', prep: async function(page){ return setup(page, 4); }, tweak: null },
  { name:'RULE_TIMEOUT', prep: async function(page){ return setup(page, 4); }, tweak: function(){ var api=window.__avatarRace, c=api.getCars(); for(var i=1;i<c.length;i++) api.setCarSpeed(i, c[i].baseSpeed * 0.22); } }
].reduce(function(chain, cfg){
  return chain.then(async function(){
    const browser = await chromium.launch();
    try {
    const page = await browser.newPage({ viewport:{ width:412, height:840 }, deviceScaleFactor:2 });
    page.on('pageerror', function(e){ errors.push(cfg.name + ' pageerror: ' + e.message); });
    page.on('console', function(m){ if (m.type()==='error') errors.push(cfg.name + ' console: ' + m.text()); });
    const cards = await cfg.prep(page);
    assert.equal(cards, 12);
    await page.click('#startBtn');
    await page.waitForTimeout(4200);
    if (cfg.tweak){ await page.evaluate(cfg.tweak); }
    const seen = { leaderFinish: null, results: null, settled: null, waitingStart: null, maxWait: 0 };
    let resultSnapshot = null;
    for (let i=0;i<300;i++){
      const s = await state(page);
      if (s.fin >= 1 && seen.leaderFinish === null) seen.leaderFinish = s.t;
      if (s.phase === 'waiting' && seen.waitingStart === null) seen.waitingStart = s.wait;
      if (s.wait > seen.maxWait) seen.maxWait = s.wait;
      if ((s.phase === 'ending' || s.phase === 'results') && !seen.settled) {
        seen.settled = s;
        resultSnapshot = await page.evaluate(function(){ return window.__avatarRace.getState().results; });
      }
      if (s.phase === 'results'){ seen.results = s; break; }
      await page.waitForTimeout(200);
    }
    if (!seen.results) throw new Error('Race did not reach results');
    assert.equal(resultSnapshot.length, cards);
    assert.ok(seen.settled.wait <= 6.04, 'settlement must occur by the six-second limit');
    if (cfg.tweak) {
      assert.ok(seen.settled.wait >= 6, 'slow field must reach the six-second timeout');
      assert.ok(resultSnapshot.some(function(result){ return !result.finished; }), 'timeout must preserve unfinished entrants');
    } else {
      assert.equal(seen.settled.fin, cards, 'natural race must settle after everyone finishes');
      assert.ok(resultSnapshot.every(function(result){ return result.finished && Number.isFinite(result.finishTime) && result.finishTime > 0; }));
      assert.ok(new Set(resultSnapshot.map(function(result){ return result.finishTime; })).size > 1, 'finishers must retain their individual crossing times');
    }
    await page.waitForTimeout(300);
    const board = await page.evaluate(function(){ return { note: document.getElementById('resultNote').textContent, rows: [].slice.call(document.querySelectorAll('.row')).map(function(x){ return x.querySelector('.rank').textContent + ' ' + x.querySelector('.nm').textContent + ' ' + x.querySelector('.st').textContent; }) }; });
    assert.equal(board.rows.length, cards);
    await page.waitForTimeout(700);
    assert.deepEqual(await page.evaluate(function(){ return window.__avatarRace.getState().results; }), resultSnapshot, 'continued car movement must not alter settled results');
    const cars = await page.evaluate(function(){ var api=window.__avatarRace, r=api.getState(), cars=api.getCars(); return cars.map(function(c){ return { n:c.name, fin:c.finished, t:+c.finishTime.toFixed(2), p:+c.progress.toFixed(3) }; }); });
    await snap(page, cfg.name.toLowerCase());
    P(cfg.name, { cards: cards, seen: seen, board: board, unfinishedInTop5: cars.filter(function(c){return !c.fin;}).length, cars: cars });
    } finally { await browser.close(); }
    assertNoPageErrors(errors);
  });
}, Promise.resolve()).then(function(){ P('ERRORS', errors); }).catch(function(e){ P('FATAL', e.message); P('ERRORS', errors); process.exitCode = 1; });
