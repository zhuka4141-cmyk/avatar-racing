const { chromium } = require(process.env.PW_PATH);
const URL = 'file:///C:/Users/Administrator/dragen%20dance/avatar-racing/index.html';
const OUT = 'C:/Users/Administrator/dragen dance/avatar-racing/qa';
function P(l,v){ console.log(l + ' ' + JSON.stringify(v)); }
const SAMPLE = "function(){ var r=window.__avatarRace.race; if(r.phase!=='racing'&&r.phase!=='waiting') return null; var c=r.cars, ov=0, worst=0; for(var i=0;i<c.length;i++){ for(var j=i+1;j<c.length;j++){ var ds=Math.abs(c[i].s-c[j].s), dl=Math.abs(c[i].lateral-c[j].lateral); if(ds<70&&dl<42){ ov++; } } } return { ov:ov, cars:c.length, t:+r.elapsed.toFixed(1), order:r.ranked.map(function(x){return x.p.id;}) }; }";
(async function(){
  const browser = await chromium.launch();
  const errors = [];
  const cases = [ { n:0, label:'8车' }, { n:7, label:'15车' } ];
  for (const cs of cases){
    const page = await browser.newPage({ viewport:{ width:412, height:840 }, deviceScaleFactor:2 });
    page.on('pageerror', function(e){ errors.push(cs.label + ' pageerror: ' + e.message); });
    page.on('console', function(m){ if(m.type()==='error') errors.push(cs.label + ' console: ' + m.text()); });
    await page.goto(URL);
    await page.click('#sampleBtn');
    if (cs.n) await page.evaluate(function(k){ for (var i=0;i<k;i++) document.getElementById('addBtn').click(); }, cs.n);
    await page.screenshot({ path: OUT + '/grid_' + cs.label + '.png' });
    await page.click('#startBtn');
    await page.waitForTimeout(900);
    await page.screenshot({ path: OUT + '/grid_' + cs.label + '_cd.png' });
    await page.waitForTimeout(3600);
    let samples=0, ovSum=0, ovMax=0, anyOv=0, deepSum=0, medSum=0, anyDeep=0, swaps=0, prev=null, mid=false;
    for (let i=0;i<200;i++){
      const st = await page.evaluate(function(){ var r=window.__avatarRace.race; if(r.phase!=='racing'&&r.phase!=='waiting') return null; var c=r.cars, ov=0, deep=0, med=0; for(var i=0;i<c.length;i++){ for(var j=i+1;j<c.length;j++){ var ds=Math.abs(c[i].s-c[j].s), dl=Math.abs(c[i].lateral-c[j].lateral); if(ds<70&&dl<42){ ov++; if(ds<45&&dl<25) deep++; else if(ds<60&&dl<35) med++; } } } return { ov:ov, deep:deep, med:med, cars:c.length, t:+r.elapsed.toFixed(1), order:r.ranked.map(function(x){return x.p.id;}) }; });
      if (!st){ if (samples>0) break; await page.waitForTimeout(200); continue; }
      samples++; ovSum += st.ov; if (st.ov>ovMax) ovMax=st.ov; if (st.ov>0) anyOv++; deepSum+=st.deep; medSum+=st.med; if (st.deep>0) anyDeep++;
      const pos={}; st.order.forEach(function(id,ix){pos[id]=ix;});
      if (prev){ for (const id in pos){ if (prev[id]!==undefined && prev[id]!==pos[id]) swaps++; } }
      prev = pos;
      if (!mid && st.t > 11){ mid = true; await page.screenshot({ path: OUT + '/pack_' + cs.label + '.png' }); }
      await page.waitForTimeout(250);
    }
    P(cs.label, { samples: samples, avgOverlapPairs: +(ovSum/samples).toFixed(2), pctSamplesWithAnyOverlap: +(100*anyOv/samples).toFixed(0), avgDeepMerges: +(deepSum/samples).toFixed(2), pctSamplesWithDeepMerge: +(100*anyDeep/samples).toFixed(0), avgMedium: +(medSum/samples).toFixed(2), rankSwaps: swaps, swapsPerSec: +(swaps/(samples*0.25)).toFixed(1) });
    await page.close();
  }
  // 120 车：确认不简化渲染下仍然流畅
  const big = await browser.newPage({ viewport:{ width:412, height:840 }, deviceScaleFactor:2 });
  big.on('pageerror', function(e){ errors.push('big pageerror: ' + e.message); });
  await big.goto(URL);
  await big.evaluate(function(){ for (var i=0;i<118;i++) document.getElementById('addBtn').click(); });
  await big.click('#startBtn');
  await big.waitForTimeout(1500);
  const fps = await big.evaluate(function(){ return new Promise(function(res){ var n=0,t0=performance.now(); function f(){ n++; if(performance.now()-t0<3000) requestAnimationFrame(f); else res(+(n/((performance.now()-t0)/1000)).toFixed(1)); } requestAnimationFrame(f); }); });
  P('120车FPS', { fps: fps, cars: await big.evaluate(function(){ return window.__avatarRace.race.cars.length; }) });
  await big.screenshot({ path: OUT + '/grid_120.png' });
  P('ERRORS', errors);
  await browser.close();
})().catch(function(e){ P('FATAL', e.message); process.exit(1); });