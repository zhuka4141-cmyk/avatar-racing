const { chromium } = require(process.env.PW_PATH);
const URL = 'file:///C:/Users/Administrator/dragen%20dance/avatar-racing/index.html';
const OUT = 'C:/Users/Administrator/dragen dance/avatar-racing/qa';
const errors = [];
function P(l,v){ console.log(l + ' ' + JSON.stringify(v)); }
function snap(page,n){ return page.screenshot({ path: OUT + '/' + n + '.png' }); }
function state(page){ return page.evaluate(function(){ var r=window.__avatarRace.race; var fin=0; for(var i=0;i<r.cars.length;i++) if(r.cars[i].finished) fin++; return { phase:r.phase, cars:r.cars.length, fin:fin, t:+r.elapsed.toFixed(2), wait:+r.waitingElapsed.toFixed(2) }; }); }
async function setup(page, extra){
  await page.goto(URL);
  await page.click('#sampleBtn');
  await page.evaluate(function(k){ for (var i=0;i<k;i++) document.getElementById('addBtn').click(); }, extra);
  return page.evaluate(function(){ return document.querySelectorAll('.card').length; });
}
[
  { name:'RULE_10TH', prep: async function(page){ return setup(page, 4); }, tweak: null },
  { name:'RULE_TIMEOUT', prep: async function(page){ return setup(page, 4); }, tweak: function(){ var c=window.__avatarRace.race.cars; for(var i=1;i<c.length;i++) c[i].baseSpeed *= 0.22; } }
].reduce(function(chain, cfg){
  return chain.then(async function(){
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport:{ width:412, height:840 }, deviceScaleFactor:2 });
    page.on('pageerror', function(e){ errors.push(cfg.name + ' pageerror: ' + e.message); });
    page.on('console', function(m){ if (m.type()==='error') errors.push(cfg.name + ' console: ' + m.text()); });
    const cards = await cfg.prep(page);
    await page.click('#startBtn');
    await page.waitForTimeout(4200);
    if (cfg.tweak){ await page.evaluate(cfg.tweak); }
    const seen = { leaderFinish: null, results: null, waitingStart: null, maxWait: 0 };
    let prevFin = 0;
    for (let i=0;i<300;i++){
      const s = await state(page);
      if (s.fin >= 1 && seen.leaderFinish === null) seen.leaderFinish = s.t;
      if (s.phase === 'waiting' && seen.waitingStart === null) seen.waitingStart = s.wait;
      if (s.wait > seen.maxWait) seen.maxWait = s.wait;
      if (s.phase === 'results'){ seen.results = s; break; }
      prevFin = s.fin;
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(300);
    const board = await page.evaluate(function(){ return { note: document.getElementById('resultNote').textContent, rows: [].slice.call(document.querySelectorAll('.row')).map(function(x){ return x.querySelector('.rank').textContent + ' ' + x.querySelector('.nm').textContent + ' ' + x.querySelector('.st').textContent; }) }; });
    const cars = await page.evaluate(function(){ var r=window.__avatarRace.race; return r.cars.map(function(c){ return { n:c.p.name, fin:c.finished, t:+c.finishTime.toFixed(2), p:+c.progress.toFixed(3) }; }); });
    await snap(page, cfg.name.toLowerCase());
    P(cfg.name, { cards: cards, seen: seen, board: board, unfinishedInTop5: cars.filter(function(c){return !c.fin;}).length, cars: cars });
    await browser.close();
  });
}, Promise.resolve()).catch(function(e){ P('FATAL', e.message); });
setTimeout(function(){ P('ERRORS', errors); }, 1000);