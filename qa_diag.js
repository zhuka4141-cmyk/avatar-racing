const { getChromium, pageUrl, assertNoPageErrors } = require('./qa/browser-helpers');
const chromium = getChromium();
const URL = pageUrl;
(async function(){
  const browser = await chromium.launch();
  try {
  const page = await browser.newPage({ viewport:{ width:412, height:840 } });
  const errors = [];
  page.on('pageerror', function(e){ errors.push('pageerror: ' + e.message); });
  page.on('console', function(m){ if (m.type()==='error') errors.push('console: ' + m.text()); });
  await page.goto(URL);
  const prof = await page.evaluate(function(){
    var t = window.__avatarRace.buildTrack(12345, 600);
    var P = t.pts, out = [], next = -200;
    for (var i=0;i<P.length;i++){
      if (P[i].s >= next){ out.push(P[i].s.toFixed(0)+':('+P[i].x.toFixed(0)+','+P[i].y.toFixed(0)+')@'+(P[i].ang*180/Math.PI).toFixed(0)); next += 250; }
    }
    return { len: P.length, raceLen:+t.raceLen.toFixed(0), turns:t.turns, prof: out.join(' ') };
  });
  console.log('pts', prof.len, 'raceLen', prof.raceLen, 'turns', prof.turns);
  console.log(prof.prof);
  assertNoPageErrors(errors);
  } finally { await browser.close(); }
})().catch(function(e){ console.log('FATAL ' + e.message); process.exitCode = 1; });
