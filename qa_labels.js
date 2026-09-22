const { chromium } = require(process.env.PW_PATH);
const URL = 'file:///C:/Users/Administrator/dragen%20dance/avatar-racing/index.html';
const OUT = 'C:/Users/Administrator/dragen dance/avatar-racing/qa';
function P(l,v){ console.log(l + ' ' + JSON.stringify(v)); }
(async function(){
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport:{ width:412, height:840 }, deviceScaleFactor:2 });
  page.on('pageerror', function(e){ errors.push('pageerror: ' + e.message); });
  page.on('console', function(m){ if(m.type()==='error') errors.push('console: ' + m.text()); });
  await page.goto(URL);
  await page.click('#sampleBtn');
  await page.evaluate(function(){ for (var i=0;i<4;i++) document.getElementById('addBtn').click(); });
  await page.click('#startBtn');
  await page.waitForTimeout(4300);
  let prev = null, samples = 0, added = 0, removed = 0, maxChurn = 0;
  const t0 = Date.now();
  let shots = 0, lastShot = 0;
  for (let i=0;i<250;i++){
    const st = await page.evaluate(function(){ var r = window.__avatarRace.race; if (r.phase!=='racing'&&r.phase!=='waiting') return null; return { t:+r.elapsed.toFixed(1), names:(r.labelNames||[]).slice().sort() }; });
    if (!st){ if (samples>0) break; await page.waitForTimeout(100); continue; }
    samples++;
    if (prev){
      let a=0,d=0;
      st.names.forEach(function(n){ if (prev.indexOf(n)<0) a++; });
      prev.forEach(function(n){ if (st.names.indexOf(n)<0) d++; });
      added+=a; removed+=d; if (a+d>maxChurn) maxChurn=a+d;
    }
    prev = st.names;
    const el = Date.now()-t0;
    if (st.t > 10 && st.t < 14 && el-lastShot > 300 && shots < 4){ lastShot = el; await page.screenshot({ path: OUT + '/label_' + (++shots) + '.png' }); }
    await page.waitForTimeout(80);
  }
  P('LABELS', { samples: samples, changesPerSec: +(((added+removed)/samples)*12.5).toFixed(2), labelAddsPerSec: +((added/samples)*12.5).toFixed(2), labelRemovesPerSec: +((removed/samples)*12.5).toFixed(2), maxChurnInOneFrame: maxChurn, shots: shots });
  P('ERRORS', errors);
  await browser.close();
})().catch(function(e){ P('FATAL', e.message); process.exit(1); });