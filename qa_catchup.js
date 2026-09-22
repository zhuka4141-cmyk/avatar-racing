const { chromium } = require(process.env.PW_PATH);
const URL = 'file:///C:/Users/Administrator/dragen%20dance/avatar-racing/index.html';
function P(l,v){ console.log(l + ' ' + JSON.stringify(v)); }
(async function(){
  const browser = await chromium.launch();
  const errors = [];
  for (let run=1; run<=3; run++){
    const page = await browser.newPage({ viewport:{ width:412, height:840 }, deviceScaleFactor:2 });
    page.on('pageerror', function(e){ errors.push('pageerror: ' + e.message); });
    page.on('console', function(m){ if(m.type()==='error') errors.push('console: ' + m.text()); });
    await page.goto(URL);
    await page.click('#sampleBtn');
    await page.evaluate(function(){ for (var i=0;i<2;i++) document.getElementById('addBtn').click(); });
    await page.click('#startBtn');
    await page.waitForTimeout(4300);
    let samples=0, swaps=0, prev=null, leads=0, lastLead=null;
    const boostByRank = {};
    const rankAt5 = {};
    let t5done = false;
    for (let i=0;i<200;i++){
      const st = await page.evaluate(function(){ var r=window.__avatarRace.race; if(r.phase!=='racing'&&r.phase!=='waiting') return null; return { t:+r.elapsed.toFixed(1), order:r.ranked.map(function(c){return c.p.id;}), catchup:r.cars.map(function(c){return { id:c.p.id, cu:+(c.catchup||1).toFixed(3) }; }) }; });
      if (!st){ if (samples>0) break; await page.waitForTimeout(200); continue; }
      samples++;
      const pos={}; st.order.forEach(function(id,ix){pos[id]=ix+1;});
      if (prev){ for (const id in pos){ if (prev[id]!==undefined && prev[id]!==pos[id]) swaps++; } }
      if (lastLead && st.order[0] !== lastLead) leads++;
      lastLead = st.order[0]; prev = pos;
      st.catchup.forEach(function(o){ boostByRank[pos[o.id]] = boostByRank[pos[o.id]] || { sum:0, n:0, max:0 }; const b=boostByRank[pos[o.id]]; b.sum+=o.cu; b.n++; if(o.cu>b.max) b.max=o.cu; });
      if (!t5done && st.t >= 5){ t5done = true; st.order.forEach(function(id,ix){ rankAt5[id]=ix+1; }); }
      await page.waitForTimeout(250);
    }
    const res = await page.evaluate(function(){ var r=window.__avatarRace.race; return { times: r.cars.map(function(c){return c.finishTime?+c.finishTime.toFixed(2):null;}), order: r.ranked.map(function(c){return c.p.id;}), names: r.cars.map(function(c){return { id:c.p.id, n:c.p.name }; }) }; });
    const times = res.times.filter(function(x){return x;}).sort(function(a,b){return a-b;});
    const nameOf = {}; res.names.forEach(function(o){ nameOf[o.id]=o.n; });
    const winnerId = res.order[0];
    const gained = Object.keys(rankAt5).filter(function(id){ const finalRank = res.order.indexOf(+id)+1; return rankAt5[id] - finalRank >= 3; }).length;
    const avgByRank = Object.keys(boostByRank).sort(function(a,b){return a-b;}).map(function(k){ const b=boostByRank[k]; return k + ':' + (b.sum/b.n).toFixed(2); });
    P('RUN'+run, { samples: samples, rankSwaps: swaps, swapsPerSec: +(swaps/(samples*0.25)).toFixed(1), leadChanges: leads, winner: nameOf[winnerId], winnerRankAt5s: rankAt5[winnerId] || null, carsGaining3Plus: gained, finishFirst: times[0], finishLast: times[times.length-1], spread: +(times[times.length-1]-times[0]).toFixed(2), avgCatchupByRank: avgByRank.join(' ') });
    await page.close();
  }
  P('ERRORS', errors);
  await browser.close();
})().catch(function(e){ P('FATAL', e.message); process.exit(1); });