const { chromium } = require(process.env.PW_PATH);
const URL = 'file:///C:/Users/Administrator/dragen%20dance/avatar-racing/index.html';
const OUT = 'C:/Users/Administrator/dragen dance/avatar-racing/qa';
function P(l,v){ console.log(l + ' ' + JSON.stringify(v)); }
(async function(){
  const browser = await chromium.launch();
  const errors = [];
  for (const run of [1,2,3]){
    const page = await browser.newPage({ viewport:{ width:412, height:840 }, deviceScaleFactor:2 });
    page.on('pageerror', function(e){ errors.push(e.message); });
    await page.goto(URL);
    await page.click('#sampleBtn');
    await page.evaluate(function(){ for (var i=0;i<4;i++) document.getElementById('addBtn').click(); });
    await page.click('#startBtn');
    await page.waitForTimeout(4300);
    let prev = null, leadChanges = 0, swaps = 0, samples = 0, snapShotDone = false;
    const leadSeq = [];
    for (let i=0;i<200;i++){
      const st = await page.evaluate(function(){ var r=window.__avatarRace.race; if (r.phase!=='racing' && r.phase!=='waiting') return { phase:r.phase, order:[] }; return { phase:r.phase, order:r.ranked.map(function(c){return c.p.id;}), s:r.cars.map(function(c){return c.s;}) }; });
      if (st.phase !== 'racing' && st.phase !== 'waiting'){ if (st.phase==='ending'||st.phase==='results') break; }
      if (st.order.length){
        const pos = {}; st.order.forEach(function(id,idx){ pos[id]=idx; });
        if (prev){ for (const id in pos){ if (prev[id] !== undefined && prev[id] !== pos[id]) swaps++; } }
        if (leadSeq.length && leadSeq[leadSeq.length-1] !== st.order[0]) leadChanges++;
        leadSeq.push(st.order[0]);
        prev = pos; samples++;
        const t = 4.3 + i*0.25;
        if (!snapShotDone && t > 11){ snapShotDone = true; await page.screenshot({ path: OUT + '/curve_mid.png' }); }
      }
      await page.waitForTimeout(250);
    }
    const fin = await page.evaluate(function(){ var r=window.__avatarRace.race; var ts=r.cars.map(function(c){return c.finishTime||null;}); return { times: ts, distinctLead: 0 }; });
    const times = fin.times.filter(function(x){return x;}).map(function(x){return +x.toFixed(1);}).sort(function(a,b){return a-b;});
    P('RUN' + run, { samples: samples, leadChanges: leadChanges, rankSwaps: swaps, swapsPerSec: +(swaps/(samples*0.25)).toFixed(2), finishTimes: times, spread: times.length>1 ? +(times[times.length-1]-times[0]).toFixed(2) : null });
    await page.close();
  }
  P('ERRORS', errors);
  await browser.close();
})().catch(function(e){ P('FATAL', e.message); process.exit(1); });