const { chromium } = require(process.env.PW_PATH);
const URL = 'file:///C:/Users/Administrator/dragen%20dance/avatar-racing/index.html';
const OUT = 'C:/Users/Administrator/dragen dance/avatar-racing/qa';
function P(l,v){ console.log(l + ' ' + JSON.stringify(v)); }
(async function(){
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport:{ width:412, height:840 }, deviceScaleFactor:2 });
  page.on('pageerror', function(e){ errors.push('pageerror: ' + e.message); });
  page.on('console', function(m){ if (m.type()==='error') errors.push('console: ' + m.text()); });
  await page.goto(URL);
  P('TRACKS', await page.evaluate(function(){
    var out = [];
    for (var s=1; s<=5; s++){
      var t = window.__avatarRace.buildTrack(s*12345, 600);
      var P2 = t.pts, N = P2.length, clash=false, minGap=1e9;
      for (var i=0;i<N && !clash;i+=3){
        for (var j=i+220;j<N;j+=3){
          var dx=P2[i].x-P2[j].x, dy=P2[i].y-P2[j].y, d=Math.sqrt(dx*dx+dy*dy);
          if (d<minGap) minGap=d;
          if (d < 2*130+30){ clash=true; break; }
        }
      }
      var x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;
      for (var k=0;k<N;k++){ if(P2[k].x<x0)x0=P2[k].x; if(P2[k].x>x1)x1=P2[k].x; if(P2[k].y<y0)y0=P2[k].y; if(P2[k].y>y1)y1=P2[k].y; }
      out.push({ seed:s*12345, raceLen:+t.raceLen.toFixed(0), minR:+t.minR.toFixed(0), turns:t.turns, selfIntersect:clash, minGapBetweenPasses:+minGap.toFixed(0), bbox:[Math.round(x1-x0), Math.round(y1-y0)] });
    }
    return out;
  }));
  await page.click('#sampleBtn');
  await page.click('#startBtn');
  await page.waitForTimeout(4300);
  var shots = 0, prevShot = -10;
  for (let i=0;i<70;i++){
    const st = await page.evaluate(function(){
      var r = window.__avatarRace.race;
      if (!r.track) return { phase:r.phase };
      var a = r.track.pts, lo=0, hi=a.length-1, cs=r.cam.s;
      while (hi-lo>1){ var mid=(lo+hi)>>1; if (a[mid].s<=cs) lo=mid; else hi=mid; }
      var pA = r.track.pts[Math.max(0,lo-5)], pB = r.track.pts[lo], pC = r.track.pts[Math.min(a.length-1,lo+5)];
      var v1x=pB.x-pA.x, v1y=pB.y-pA.y, v2x=pC.x-pB.x, v2y=pC.y-pB.y;
      var l1=Math.hypot(v1x,v1y), l2=Math.hypot(v2x,v2y);
      var turn=Math.abs(Math.atan2(v1x*v2y-v1y*v2x, v1x*v2x+v1y*v2y));
      var R = turn>1e-9 ? ((l1+l2)/2)/turn : 99999;
      var lead = r.ranked[0];
      return { phase:r.phase, R:+R.toFixed(0), t:+r.elapsed.toFixed(1), leadProg:+(lead?lead.progress:0).toFixed(3) };
    });
    if (st.phase !== 'racing' && st.phase !== 'waiting' && st.phase !== 'ending') break;
    if (st.R && st.R < 520 && (i - prevShot) > 4){
      prevShot = i;
      await page.screenshot({ path: OUT + '/hairpin_' + (++shots) + '.png' });
      P('SHOT' + shots, st);
    }
    await page.waitForTimeout(300);
  }
  P('SHOTS', shots);
  P('ERRORS', errors);
  await browser.close();
})().catch(function(e){ P('FATAL', e.message); process.exit(1); });