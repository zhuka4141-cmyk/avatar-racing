const { chromium } = require(process.env.PW_PATH);
const URL = 'file:///C:/Users/Administrator/dragen%20dance/avatar-racing/index.html';
const OUT = 'C:/Users/Administrator/dragen dance/avatar-racing/qa';
const errors = [];
function P(l,v){ console.log(l + ' ' + JSON.stringify(v)); }
function snap(page,n){ return page.screenshot({ path: OUT + '/' + n + '.png' }); }
function state(page){ return page.evaluate(function(){ var r=window.__avatarRace.race; var fin=0,vis=0; for(var i=0;i<r.cars.length;i++){ if(r.cars[i].finished) fin++; if(Math.abs(r.cars[i].s-r.cam.s)<1200) vis++; } return { phase:r.phase, cars:r.cars.length, fin:fin, vis:vis, t:+r.elapsed.toFixed(2), end:+r.endingElapsed.toFixed(2), camS:+r.cam.s.toFixed(0), camX:+r.cam.x.toFixed(0), hud:document.getElementById('hudStatus').textContent, sub:document.getElementById('hudSub').textContent, rankBtn:document.getElementById('rankBtn').hidden===false, panel:document.getElementById('result').hidden===false }; }); }
(async function(){
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{ width:412, height:840 }, deviceScaleFactor:2 });
  page.on('pageerror', function(e){ errors.push('pageerror: ' + e.message); });
  page.on('console', function(m){ if (m.type()==='error') errors.push('console: ' + m.text()); });
  await page.goto(URL);
  await page.click('#sampleBtn');
  P('CARDS', await page.evaluate(function(){ return document.querySelectorAll('.card').length; }));
  P('TRACK', await page.evaluate(function(){ var t=window.__avatarRace.buildTrack(12345, 600); return { pts:t.pts.length, raceLen:+t.raceLen.toFixed(0), minR:+t.minR.toFixed(0), maxTurnDeg:+(t.maxTurn*180/Math.PI).toFixed(2) }; }));
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
  await page.waitForTimeout(200);
  await snap(page, 'end_results');
  const board = await page.evaluate(function(){ var b=document.getElementById('board'); return { rows:document.querySelectorAll('.row').length, sep:document.querySelectorAll('.board-sep').length, scrollH:b.scrollHeight, clientH:b.clientHeight, scrollable:b.scrollHeight>b.clientHeight+2, note:document.getElementById('resultNote').textContent, first3:[].slice.call(document.querySelectorAll('.row')).slice(0,3).map(function(x){return x.querySelector('.rank').textContent+':'+x.querySelector('.nm').textContent+' '+x.querySelector('.st').textContent;}) }; });
  await page.evaluate(function(){ document.getElementById('board').scrollTop = 99999; });
  await page.waitForTimeout(200);
  const scrolled = await page.evaluate(function(){ var b=document.getElementById('board'); return { top:+b.scrollTop.toFixed(0), lastRowShown:(function(){ var rows=document.querySelectorAll('.row'); var last=rows[rows.length-1]; var r=last.getBoundingClientRect(), br=b.getBoundingClientRect(); return r.top < br.bottom && r.bottom > br.top; })() }; });
  await snap(page, 'end_scrolled');
  const s1 = await page.evaluate(function(){ return window.__avatarRace.race.cars.map(function(c){return +c.s.toFixed(2);}); });
  const cam1 = await page.evaluate(function(){ return { s:+window.__avatarRace.race.cam.s.toFixed(2), x:+window.__avatarRace.race.cam.x.toFixed(2) }; });
  await page.waitForTimeout(1200);
  const s2 = await page.evaluate(function(){ return window.__avatarRace.race.cars.map(function(c){return +c.s.toFixed(2);}); });
  const cam2 = await page.evaluate(function(){ return { s:+window.__avatarRace.race.cam.s.toFixed(2), x:+window.__avatarRace.race.cam.x.toFixed(2) }; });
  let moved = 0; for (let i=0;i<s1.length;i++) if (s2[i] - s1[i] > 1) moved++;
  P('SEEN', seen);
  P('BOARD', board);
  P('SCROLLED', scrolled);
  P('AFTER_RESULT_RUNNING', { carsStillMoving: moved, of: s1.length, camDrift: +(Math.abs(cam2.x-cam1.x)+Math.abs(cam2.s-cam1.s)).toFixed(2) });
  await page.click('#againBtn');
  await page.waitForTimeout(600);
  P('AGAIN', await state(page));
  P('ERRORS', errors);
  await browser.close();
})().catch(function(e){ P('FATAL', e.message); P('ERRORS', errors); process.exit(1); });