const { getChromium, pageUrl, assertNoPageErrors } = require('./qa/browser-helpers');
const chromium = getChromium();
const URL = pageUrl;
function P(l,v){ console.log(l + ' ' + JSON.stringify(v)); }
(async function(){
  const browser = await chromium.launch();
  try {
  const errors = [];
  for (let run=1; run<=3; run++){
    const page = await browser.newPage({ viewport:{ width:412, height:840 }, deviceScaleFactor:2 });
    page.on('pageerror', function(e){ errors.push('pageerror: ' + e.message); });
    page.on('console', function(m){ if(m.type()==='error') errors.push('console: ' + m.text()); });
    await page.goto(URL);
    await page.click('#sampleBtn');
    await page.evaluate(function(){ for (var i=0;i<4;i++) document.getElementById('addBtn').click(); });
    await page.click('#startBtn');
    let ok = false;
    for (let i=0;i<80;i++){
      const s = await page.evaluate(function(){ return window.__avatarRace.getState().phase; });
      if (s === 'results' || s === 'ending'){ ok = true; break; }
      await page.waitForTimeout(500);
    }
    if (!ok) throw new Error('Race did not settle within 40 seconds');
    const res = await page.evaluate(function(){
      var api=window.__avatarRace, r=api.getState(), cars=api.getCars();
      var ts = cars.filter(function(c){ return c.finished; }).map(function(c){ return { n:c.name, t:c.finishTime*1000 }; }).sort(function(a,b){ return a.t-b.t; });
      var gaps = []; for (var i=1;i<ts.length;i++) gaps.push(+(ts[i].t - ts[i-1].t).toFixed(1));
      var rounded = ts.map(function(x){ return Math.round(x.t); });
      var dupes = rounded.length - new Set(rounded).size;
      return { times: ts.map(function(x){ return x.n + '=' + (x.t/1000).toFixed(3); }), gapsMs: gaps, minGapMs: Math.min.apply(null, gaps), duplicateTimestamps: dupes, board: [].slice.call(document.querySelectorAll('.row')).slice(0,5).map(function(x){ return x.querySelector('.nm').textContent + ' ' + x.querySelector('.st').textContent; }) };
    });
    P('RUN'+run, res);
    await page.close();
  }
  assertNoPageErrors(errors);
  P('ERRORS', errors);
  } finally { await browser.close(); }
})().catch(function(e){ P('FATAL', e.message); process.exitCode = 1; });
