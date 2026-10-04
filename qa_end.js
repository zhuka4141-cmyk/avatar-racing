const assert = require('node:assert/strict');
const { getChromium, pageUrl, ensureOutputDir, outputPath, assertNoPageErrors } = require('./qa/browser-helpers');
const chromium = getChromium();
const URL = pageUrl;
const OUT = ensureOutputDir();
const errors = [];
function P(l,v){ console.log(l + ' ' + JSON.stringify(v)); }
function snap(page,n){ return page.screenshot({ path: outputPath(n + '.png') }); }
function state(page){ return page.evaluate(function(){ var api=window.__avatarRace, r=api.getState(), cars=api.getCars(); var fin=0,vis=0; for(var i=0;i<cars.length;i++){ if(cars[i].finished) fin++; if(Math.abs(cars[i].s-r.cam.s)<1200) vis++; } return { phase:r.phase, cars:cars.length, fin:fin, vis:vis, t:+r.elapsed.toFixed(2), end:+r.endingElapsed.toFixed(2), camS:+r.cam.s.toFixed(0), camX:+r.cam.x.toFixed(0), hud:document.getElementById('hudStatus').textContent, sub:document.getElementById('hudSub').textContent, rankBtn:document.getElementById('rankBtn').hidden===false, panel:document.getElementById('result').hidden===false }; }); }
(async function(){
  const browser = await chromium.launch();
  try {
  // Seven result rows exceed the board's 50vh limit at this mobile height.
  const page = await browser.newPage({ viewport:{ width:412, height:700 }, deviceScaleFactor:2 });
  page.on('pageerror', function(e){ errors.push('pageerror: ' + e.message); });
  page.on('console', function(m){ if (m.type()==='error') errors.push('console: ' + m.text()); });
  await page.goto(URL);
  await page.click('#clearBtn');
  await page.click('#addBtn');
  await page.click('#sampleBtn');
  const expectedCars = 7;
  const cards = await page.locator('.card').count();
  assert.equal(cards, expectedCars);
  P('CARDS', cards);
  P('TRACK', await page.evaluate(function(){ var t=window.__avatarRace.buildTrack(12345, 600); return { pts:t.pts.length, raceLen:+t.raceLen.toFixed(0), minR:+t.minR.toFixed(0), turns:t.turns }; }));
  P('CURVINESS', await page.evaluate(function(){ var out=[]; for (var k=0;k<3;k++){ var t=window.__avatarRace.buildTrack(1000+k*77, 600); var P2=t.pts, tight=0, mids=0, n=0; for (var j=2;j<P2.length-2;j++){ if (P2[j].s<0||P2[j].s>t.raceLen) continue; var a=P2[j-1],b=P2[j],c=P2[j+1]; var v1x=b.x-a.x,v1y=b.y-a.y,v2x=c.x-b.x,v2y=c.y-b.y; var l1=Math.hypot(v1x,v1y),l2=Math.hypot(v2x,v2y); var turn=Math.abs(Math.atan2(v1x*v2y-v1y*v2x,v1x*v2x+v1y*v2y)); var R=turn>1e-9?((l1+l2)/2)/turn:1e9; n++; if (R<600) tight++; else if (R<1500) mids++; } out.push({ seed:1000+k*77, minR:+t.minR.toFixed(0), pctR_lt600:+(100*tight/n).toFixed(1), pctR_lt1500:+(100*mids/n).toFixed(1) }); } return out; }));
  await page.click('#startBtn');
  const seen = { settle:null, panelAt:null, maxVisAfterSettle:null };
  let settleT = null;
  for (let i=0;i<400;i++){
    const s = await state(page);
    if (s.phase === 'ending' && !seen.settle){ seen.settle = s; settleT = Date.now(); await snap(page,'end_settle'); }
    else if (s.phase === 'ending' && seen.settle && !seen.maxVisAfterSettle && s.end > 1.2){ seen.maxVisAfterSettle = s.vis; await snap(page,'end_leaving'); }
    if (s.phase === 'results' && !seen.panelAt){ seen.panelAt = s; seen.wallSeconds = +((Date.now()-settleT)/1000).toFixed(2); break; }
    await page.waitForTimeout(250);
  }
  if (!seen.panelAt) throw new Error('Results panel did not appear');
  assert.equal(seen.panelAt.phase, 'results');
  assert.equal(seen.panelAt.panel, true);
  assert.equal(seen.panelAt.cars, expectedCars);
  const motionStart = await page.evaluate(function(){ var api=window.__avatarRace, r=api.getState(); return { phase:r.phase, positions:api.getCars().map(function(c){return c.s;}), cam:r.cam, finish:r.raceLen }; });
  await page.waitForTimeout(1200);
  const motionEnd = await page.evaluate(function(){ var api=window.__avatarRace, r=api.getState(); return { phase:r.phase, positions:api.getCars().map(function(c){return c.s;}), cam:r.cam }; });
  assert.equal(motionStart.phase, 'results');
  assert.equal(motionEnd.phase, 'results');
  assert.equal(motionEnd.positions.length, motionStart.positions.length);
  const moved = motionEnd.positions.filter(function(s, index){return s - motionStart.positions[index] > 1;}).length;
  assert.ok(moved > 0, 'at least one car must keep moving after results appear');
  const camDrift = Math.hypot(motionEnd.cam.x-motionStart.cam.x, motionEnd.cam.y-motionStart.cam.y) + Math.abs(motionEnd.cam.s-motionStart.cam.s);
  // Camera damping may leave a small residual; 20 world units is below one third of a car length.
  assert.ok(Math.abs(motionEnd.cam.s-(motionStart.finish-40)) < 20, 'results camera must stay near the finish');
  assert.ok(camDrift < 20, 'results camera must remain essentially stationary');
  await page.waitForTimeout(200);
  await snap(page, 'end_results');
  const board = await page.evaluate(function(){ var b=document.getElementById('board'); return { rows:document.querySelectorAll('.row').length, sep:document.querySelectorAll('.board-sep').length, scrollH:b.scrollHeight, clientH:b.clientHeight, scrollable:b.scrollHeight>b.clientHeight+2, note:document.getElementById('resultNote').textContent, first3:[].slice.call(document.querySelectorAll('.row')).slice(0,3).map(function(x){return x.querySelector('.rank').textContent+':'+x.querySelector('.nm').textContent+' '+x.querySelector('.st').textContent;}) }; });
  assert.equal(board.rows, expectedCars);
  assert.equal(board.sep, 1, 'results must separate the top five from the remaining entrants');
  assert.ok(board.scrollable, 'seven result rows must scroll at the tested mobile height');
  await page.evaluate(function(){ document.getElementById('board').scrollTop = 99999; });
  await page.waitForTimeout(200);
  const scrolled = await page.evaluate(function(){ var b=document.getElementById('board'); return { top:+b.scrollTop.toFixed(0), lastRowShown:(function(){ var rows=document.querySelectorAll('.row'); var last=rows[rows.length-1]; var r=last.getBoundingClientRect(), br=b.getBoundingClientRect(); return r.top < br.bottom && r.bottom > br.top; })() }; });
  assert.ok(scrolled.top > 0, 'the result list must respond to scrolling');
  assert.equal(scrolled.lastRowShown, true, 'the final result row must be visible after scrolling');
  await snap(page, 'end_scrolled');
  P('SEEN', seen);
  P('BOARD', board);
  P('SCROLLED', scrolled);
  P('AFTER_RESULT_RUNNING', { carsStillMoving: moved, of: motionStart.positions.length, camDrift: +camDrift.toFixed(2) });
  await page.click('#againBtn');
  await page.waitForTimeout(600);
  const again = await state(page);
  assert.equal(again.phase, 'countdown');
  assert.equal(again.panel, false, 'replay must hide the previous result panel');
  assert.equal(again.cars, expectedCars);
  assert.equal(await page.evaluate(function(){ return window.__avatarRace.getState().results.length; }), 0, 'replay must clear settled results');
  P('AGAIN', again);
  assertNoPageErrors(errors);
  P('ERRORS', errors);
  } finally { await browser.close(); }
})().catch(function(e){ P('FATAL', e.message); P('ERRORS', errors); process.exitCode = 1; });
