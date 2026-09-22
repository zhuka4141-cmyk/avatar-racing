const PW = process.env.PW_PATH;
const { chromium } = require(PW);
const path = require('path'), fs = require('fs');
const URL = 'file:///C:/Users/Administrator/dragen%20dance/avatar-racing/index.html';
const OUT = 'C:/Users/Administrator/dragen dance/avatar-racing/qa';
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT,'avatar.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC','base64'));
const errors = [];
const log = [];
function P(label, v){ console.log(label + ' ' + JSON.stringify(v)); }
function state(page){ return page.evaluate(function(){ var r = window.__avatarRace.race; var fin=0; for(var i=0;i<r.cars.length;i++) if(r.cars[i].finished) fin++; return { phase:r.phase, cars:r.cars.length, fin:fin, t:+r.elapsed.toFixed(2), wait:+r.waitingElapsed.toFixed(2), seed:r.seed, hud:document.getElementById('hudStatus').textContent, sub:document.getElementById('hudSub').textContent, cd:document.getElementById('countdownText').textContent, result:document.getElementById('result').hidden===false, board:document.getElementById('board').textContent }; }); }
async function snap(page,n){ await page.screenshot({ path: path.join(OUT, n + '.png') }); }
function failuresNow(page){ return page.evaluate(function(){ var t=document.getElementById('toast'); return { hidden:t.hidden, text:t.textContent }; }); }
(async function(){
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{ width:412, height:840 }, deviceScaleFactor:2 });
  page.on('console', function(m){ if(m.type()==='error') errors.push('console: '+m.text()); });
  page.on('pageerror', function(e){ errors.push('pageerror: '+e.message); });
  await page.goto(URL);
  P('INIT', await page.evaluate(function(){ return { cards:document.querySelectorAll('.card').length, checked:document.querySelectorAll('.card img').length }; }));
  await page.click('.card:first-child .btn.danger');
  await page.waitForTimeout(150);
  await page.click('#startBtn');
  await page.waitForTimeout(200);
  P('GUARD_1P', await failuresNow(page));
  await page.click('#sampleBtn');
  await page.waitForTimeout(200);
  P('CARDS_AFTER_SAMPLE', await page.evaluate(function(){ return document.querySelectorAll('.card').length; }));
  await page.locator('.card').nth(0).locator('input[type=file]').setInputFiles(path.join(OUT,'avatar.png'));
  await page.waitForTimeout(400);
  P('UPLOAD_OK', await page.evaluate(function(){ var r=window.__avatarRace; return { source:r.participants[0].avatarSource, tag:document.querySelector('.card .card-row span').textContent, srcLen:r.participants[0].avatarDataUrl.length, toast:document.getElementById('toast').textContent }; }));
  fs.writeFileSync(path.join(OUT,'notimage.txt'), 'this is not an image');
  await page.locator('.card').nth(1).locator('input[type=file]').setInputFiles(path.join(OUT,'notimage.txt'));
  await page.waitForTimeout(300);
  P('UPLOAD_BAD', await page.evaluate(function(){ var r=window.__avatarRace; return { source:r.participants[1].avatarSource, toast:document.getElementById('toast').textContent }; }));
  await page.fill('.card:nth-child(3) .name-input', '测试车手ABC');
  await snap(page, 'setup');
  await page.click('#startBtn');
  await page.waitForTimeout(800);
  P('COUNTDOWN', await state(page));
  await snap(page, 'countdown');
  await page.waitForTimeout(3000);
  P('RACING_T3', await state(page));
  await page.waitForTimeout(5000);
  P('RACING_T8', await state(page));
  await snap(page, 'racing_8s');
  const beforeResize = await page.evaluate(function(){ var r=window.__avatarRace.race; return { elapsed:+r.elapsed.toFixed(2), lead:+r.ranked[0].progress.toFixed(4) }; });
  await page.setViewportSize({ width: 380, height: 700 });
  await page.waitForTimeout(600);
  const afterResize = await page.evaluate(function(){ var r=window.__avatarRace.race; var c=document.getElementById('game'); return { elapsed:+r.elapsed.toFixed(2), lead:+r.ranked[0].progress.toFixed(4), canvasW:c.width, canvasH:c.height }; });
  P('RESIZE', { before: beforeResize, after: afterResize });
  await page.setViewportSize({ width: 412, height: 840 });
  await page.waitForTimeout(5000);
  P('RACING_T14', await state(page));
  await snap(page, 'racing_14s');
  let sawWaiting = false, waitSnapshot = null;
  for (let i=0;i<40;i++){
    const s = await state(page);
    if (s.phase === 'waiting' && !sawWaiting){ sawWaiting = true; waitSnapshot = s; await snap(page,'waiting'); }
    if (s.phase === 'results'){ log.push(s); break; }
    await page.waitForTimeout(400);
  }
  P('SAW_WAITING', { saw: sawWaiting, snap: waitSnapshot });
  await page.waitForTimeout(400);
  const fin = await state(page);
  P('FINAL', fin);
  await snap(page, 'results');
  P('RESULTS', await page.evaluate(function(){ var r=window.__avatarRace.race; var rows=[].slice.call(document.querySelectorAll('.row')).map(function(x){ return { rank:x.querySelector('.rank').textContent, nm:x.querySelector('.nm').textContent, st:x.querySelector('.st').textContent, img:x.querySelector('img').src.slice(0,22) }; }); return { rows:rows, note:document.getElementById('resultNote').textContent, order:r.ranked.map(function(c){ return { name:c.p.name, fin:c.finished, t:+c.finishTime.toFixed(2), prog:+c.progress.toFixed(3) }; }) }; }));
  P('SPREAD', await page.evaluate(function(){ var r=window.__avatarRace.race; var ts=r.cars.filter(function(c){return c.finished;}).map(function(c){return +c.finishTime.toFixed(2);}).sort(function(a,b){return a-b;}); var vs=r.cars.map(function(c){return c.baseSpeed;}); return { finishTimes:ts, firstGap: ts.length>1 ? +(ts[1]-ts[0]).toFixed(2) : null, baseSpeedMin:+Math.min.apply(null,vs).toFixed(0), baseSpeedMax:+Math.max.apply(null,vs).toFixed(0), raceLen:+r.track.raceLen.toFixed(0) }; }));
  P('TRACK', await page.evaluate(function(){ var t=window.__avatarRace.race.track, P=t.pts, minR=Infinity, maxSlope=0, minSeg=Infinity; for(var j=1;j<P.length-1;j++){ if(P[j].s<0||P[j].s>t.raceLen) continue; var a=P[j-1],b=P[j],c=P[j+1]; var v1x=b.x-a.x,v1y=b.y-a.y,v2x=c.x-b.x,v2y=c.y-b.y; var l1=Math.hypot(v1x,v1y),l2=Math.hypot(v2x,v2y); if(l1<minSeg) minSeg=l1; var turn=Math.abs(Math.atan2(v1x*v2y-v1y*v2x, v1x*v2x+v1y*v2y)); var R= turn>1e-7 ? ((l1+l2)/2)/turn : Infinity; if(R<minR) minR=R; var sl=Math.abs(v2x)/Math.max(1e-6,v2y); if(sl>maxSlope) maxSlope=sl; } return { pts:P.length, raceLen:+t.raceLen.toFixed(0), minR:+minR.toFixed(1), maxSlope:+maxSlope.toFixed(2), minSeg:+minSeg.toFixed(2) }; }));
  await page.click('#againBtn');
  await page.waitForTimeout(900);
  P('AGAIN', await state(page));
  await page.click('#backBtn');
  await page.waitForTimeout(300);
  P('BACK', await page.evaluate(function(){ return { setupHidden:document.getElementById('setupView').hidden, cards:document.querySelectorAll('.card').length, names:[].slice.call(document.querySelectorAll('.name-input')).map(function(i){return i.value;}) }; }));
  // many participants stress
  for (let i=0;i<28;i++){ await page.click('#addBtn'); }
  await page.waitForTimeout(300);
  P('MANY', await page.evaluate(function(){ return { cards:document.querySelectorAll('.card').length, hintHidden:document.getElementById('hint').hidden }; }));
  await page.click('#startBtn');
  await page.waitForTimeout(1500);
  const fps = await page.evaluate(function(){ return new Promise(function(res){ var n=0; var t0=performance.now(); function f(){ n++; if(performance.now()-t0<3000) requestAnimationFrame(f); else res(+(n/((performance.now()-t0)/1000)).toFixed(1)); } requestAnimationFrame(f); }); });
  P('MANY_FPS', { fps:fps, state: await state(page) });
  await snap(page, 'many');
  await page.click('#backBtn');
  await page.waitForTimeout(200);
  await page.evaluate(function(){ for (var i=0;i<85;i++) document.getElementById('addBtn').click(); });
  await page.waitForTimeout(400);
  P('HUGE', await page.evaluate(function(){ return { cards:document.querySelectorAll('.card').length, hint:document.getElementById('hint').textContent }; }));
  await page.click('#startBtn');
  await page.waitForTimeout(1600);
  P('HUGE_FPS', { fps: await page.evaluate(function(){ return new Promise(function(res){ var n=0; var t0=performance.now(); function f(){ n++; if(performance.now()-t0<3000) requestAnimationFrame(f); else res(+(n/((performance.now()-t0)/1000)).toFixed(1)); } requestAnimationFrame(f); }); }), state: await state(page), grid: await page.evaluate(function(){ var r=window.__avatarRace.race; var s=r.cars.map(function(c){return c.s;}); return { minS:+Math.min.apply(null,s).toFixed(0), maxS:+Math.max.apply(null,s).toFixed(0), trackStart:+r.track.pts[0].s.toFixed(0), raceLen:+r.track.raceLen.toFixed(0) }; }) });
  await snap(page, 'huge');
  await page.waitForTimeout(1500);
  P('ERRORS', errors);
  await browser.close();
})().catch(function(e){ P('FATAL', e.message); P('ERRORS', errors); process.exit(1); });