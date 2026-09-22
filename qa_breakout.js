const { chromium } = require(process.env.PW_PATH);
const URL = 'file:///C:/Users/Administrator/dragen%20dance/avatar-racing/index.html';
const OUT = 'C:/Users/Administrator/dragen dance/avatar-racing/qa';
function P(l,v){ console.log(l + ' ' + JSON.stringify(v)); }
(async function(){
  const browser = await chromium.launch();
  const errors = [];
  for (let run=1; run<=2; run++){
    const page = await browser.newPage({ viewport:{ width:412, height:840 }, deviceScaleFactor:2 });
    page.on('pageerror', function(e){ errors.push('pageerror: ' + e.message); });
    page.on('console', function(m){ if(m.type()==='error') errors.push('console: ' + m.text()); });
    await page.goto(URL);
    await page.click('#sampleBtn');
    await page.evaluate(function(){ for (var i=0;i<4;i++) document.getElementById('addBtn').click(); });
    await page.click('#startBtn');
    await page.waitForTimeout(4400);
    let samples=0, maxStuck=0, stuckSamples=0, breakouts=0, prevBo={}, overlapPairs=0, overlapSamples=0, mergedPairs=0, mergedSamples=0, shot=false;
    for (let i=0;i<220;i++){
      const st = await page.evaluate(function(){
        var r = window.__avatarRace.race;
        if (r.phase!=='racing' && r.phase!=='waiting') return null;
        var c = r.cars, ov=0;
        var merged=0; for (var i2=0;i2<c.length;i2++){ for (var j2=i2+1;j2<c.length;j2++){ var ds=Math.abs(c[i2].s-c[j2].s), dl=Math.abs(c[i2].lateral-c[j2].lateral); if (ds<80 && dl<46) ov++; if (ds<70 && dl<28) merged++; } }
        return { t:+r.elapsed.toFixed(1), ov:ov, mg:merged, cars:c.map(function(x){ return { id:x.p.id, st:+(x.stuckTimer||0).toFixed(2), bo:(x.breakoutTimer||0)>0, stuck:!!x.stuck }; }) };
      });
      if (!st){ if (samples>0) break; await page.waitForTimeout(120); continue; }
      if (st.t < 4){ await page.waitForTimeout(100); continue; }
      samples++;
      if (st.ov>0){ overlapSamples++; overlapPairs += st.ov; }
      mergedPairs += (st.mg||0); if ((st.mg||0)>0) mergedSamples++;
      st.cars.forEach(function(c){
        if (c.st > maxStuck) maxStuck = c.st;
        if (c.stuck) stuckSamples++;
        if (c.bo && !prevBo[c.id]) breakouts++;
        prevBo[c.id] = c.bo;
      });
      if (!shot && st.t > 8){ shot = true; await page.screenshot({ path: OUT + '/overlap_run' + run + '.png' }); }
      await page.waitForTimeout(100);
    }
    P('RUN'+run, { samples: samples, maxStuckTimerSec: maxStuck, pctTouching: +(100*overlapSamples/samples).toFixed(0), avgTouchingPairs: +(overlapPairs/samples).toFixed(2), pctMerged: +(100*mergedSamples/samples).toFixed(0), avgMergedPairs: +(mergedPairs/samples).toFixed(2), breakoutEvents: breakouts });
    await page.close();
  }
  P('ERRORS', errors);
  await browser.close();
})().catch(function(e){ P('FATAL', e.message); process.exit(1); });