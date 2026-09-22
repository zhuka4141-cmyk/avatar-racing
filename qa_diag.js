const { chromium } = require(process.env.PW_PATH);
const URL = 'file:///C:/Users/Administrator/dragen%20dance/avatar-racing/index.html';
(async function(){
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{ width:412, height:840 } });
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
  await browser.close();
})().catch(function(e){ console.log('FATAL ' + e.message); process.exit(1); });