// No dependencies: node qa_physics.js [path/to/index.html]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const html = process.argv[2] === '--baseline'
  ? require('node:child_process').execFileSync('git', ['show', 'c1d29cd:index.html'], { cwd:__dirname, encoding:'utf8' })
  : fs.readFileSync(process.argv[2] || path.join(__dirname, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
// Execute the real math, track generator and simulation; exclude only DOM/rendering.
const source = script.slice(script.indexOf('var TAU'), script.indexOf('var setupView')) +
  script.slice(script.indexOf('function gridPlan'), script.indexOf('function worldToScreen'));
function simulation(n = 12, seed = 42) {
  const ctx = vm.createContext({ participants: Array.from({ length:n }, (_,i) => ({ id:i+1, name:String(i+1) })),
    displayName: p => p.name });
  vm.runInContext(source + '\nMath.random = mulberry32(' + seed + ');', ctx);
  const r = ctx.race;
  r.track = ctx.buildTrack(seed, ctx.gridPlan(n).depth);
  r.cars = ctx.createCars(r.track, ctx.mulberry32(seed));
  r.ranked = ctx.rankCars(r.cars);
  r.ranked.forEach((c,i) => { c.rank = i+1; });
  r.phase = 'racing';
  return ctx;
}
function advance(ctx, seconds, dt = 1/60) {
  for (let i=0; i<Math.round(seconds/dt); i++) ctx.updateRace(dt);
}

// Reintroducing single-row starts makes these fail before the first physics tick.
for (const n of [2, 8, 15, 120, 121, 300]) test(`non-overlapping starting grid: ${n} cars`, () => {
  const ctx = simulation(n), cars = ctx.race.cars;
  for (let i=0; i<n; i++) {
    assert.ok(Math.abs(cars[i].lateral) <= 126, 'car outside track');
    for (let j=i+1; j<n; j++) assert.ok(
      Math.abs(cars[i].s-cars[j].s) >= 86 || Math.abs(cars[i].lateral-cars[j].lateral) >= 50,
      `cars ${i+1}/${j+1} overlap on the grid`);
  }
  const start = cars.map(c => c.s);
  advance(ctx, 1);
  assert.ok(cars.every((c,i) => c.s-start[i] > 100), 'all cars must launch within one second');
});

test('side-by-side cars are not mistaken for blocked followers', () => {
  const ctx = simulation(2), [a,b] = ctx.race.cars;
  a.s = b.s = 1000; a.lateral = -12; b.lateral = 12;
  ctx.interact(ctx.race.cars, 1/60);
  assert.equal(a.follow, 1);
  assert.equal(b.follow, 1);
});

test('a faster follower chooses a free side and passes a slower car', () => {
  const ctx = simulation(2), [front,rear] = ctx.race.cars;
  front.s = 1400; rear.s = 1200;
  for (const c of [front,rear]) {
    c.lateral = c.lane = c.baseLane = 0;
    c.startDelay = 0; c.v = c.baseSpeed = 400;
    c.paceSeed = c.paceSeed2 = c.paceSeed3 = c.wobbleSeed = 0;
  }
  rear.baseSpeed = 450;
  ctx.race.elapsed = 2;
  advance(ctx, 0.3);
  assert.ok(Math.abs(front.lateral-rear.lateral) > 10, 'no proactive lane change before contact');
  let separation = 0, bestLead = -Infinity;
  for (let i=0; i<360; i++) {
    ctx.updateRace(1/60);
    separation = Math.max(separation, Math.abs(front.lateral-rear.lateral));
    bestLead = Math.max(bestLead, rear.s-front.s);
  }
  assert.ok(separation >= 46, `no passing room: ${separation.toFixed(1)}`);
  assert.ok(bestLead > 30, `faster rear car never completes a pass: best lead ${bestLead.toFixed(1)}`);
});

test('an equal-performance rear car closes a 600-unit deficit smoothly', () => {
  const ctx = simulation(2), [front,rear] = ctx.race.cars;
  front.s = 1800; rear.s = 1200;
  for (const c of [front,rear]) {
    c.startDelay = 0; c.v = c.baseSpeed = 400;
    c.paceSeed = c.paceSeed2 = c.paceSeed3 = 0;
  }
  front.lateral = front.lane = front.baseLane = -65;
  rear.lateral = rear.lane = rear.baseLane = 65;
  advance(ctx, 4);
  assert.ok(front.s-rear.s < 400, 'rear car cannot close the gap');
  assert.ok(rear.v < 600, 'catchup is excessively fast');
});

test('two-car races allow a trailing car to sprint without an abrupt rank-based cutoff', () => {
  const ctx = simulation(2), [front,rear] = ctx.race.cars;
  front.s = 1800; rear.s = 1600;
  rear.rank = 2; rear.surgeTimer = 2; rear.surgePower = 0.12; rear.surgeCooldown = 5;
  rear.catchup = 1; ctx.race.leaderS = front.s;
  const without = Object.assign({}, rear, { surgeTimer:0 });
  ctx.updateCar(rear, 1/60, 2, 9000);
  ctx.updateCar(without, 1/60, 2, 9000);
  assert.ok(rear.catchup > without.catchup, 'second place never receives sprint acceleration');
  const prior = rear.catchup;
  rear.rank = 1;
  ctx.updateCar(rear, 1/60, 2+1/60, 9000);
  assert.ok(Math.abs(rear.catchup-prior) < 0.03, 'rank swap cuts the boost abruptly');
});

test('whole races stay finite and settle by the tenth finisher or five seconds', () => {
  const metrics = [];
  for (const seed of [1, 42, 9876, 2026, 31415]) {
    const ctx = simulation(15, seed), r = ctx.race;
    const pairOrder = new Map();
    let passes = 0, leaderChanges = 0, leader = null;
    while (r.phase === 'racing' || r.phase === 'waiting') {
      ctx.updateRace(1/60);
      assert.ok(r.elapsed < 35, 'race never finishes');
      for (const c of r.cars) assert.ok(!c.broken && Number.isFinite(c.s) && Math.abs(c.lateral) <= 126);
      if (r.elapsed < 2 || r.phase !== 'racing') continue;
      if (leader !== null && leader !== r.ranked[0].p.id) leaderChanges++;
      leader = r.ranked[0].p.id;
      for (let i=0;i<r.cars.length;i++) for (let j=i+1;j<r.cars.length;j++) {
        const delta = r.cars[i].s-r.cars[j].s;
        if (Math.abs(delta) < 30) continue; // Ignore near-tie rank jitter.
        const key = i+':'+j, sign = Math.sign(delta);
        if (pairOrder.has(key) && pairOrder.get(key) !== sign) passes++;
        pairOrder.set(key,sign);
      }
    }
    assert.ok(r.leaderFinishAt >= 18 && r.leaderFinishAt <= 23, `winner at ${r.leaderFinishAt}`);
    assert.ok(r.cars.filter(c => c.finished).length >= 10 || r.waitingElapsed >= 5);
    assert.ok(r.waitingElapsed <= 5.04);
    assert.equal(r.results.length, 15);
    metrics.push({ seed, passes, leaderChanges, first:+r.leaderFinishAt.toFixed(2) });
  }
  console.log('RACE_METRICS', JSON.stringify(metrics));
  assert.ok(metrics.reduce((sum,m) => sum+m.passes,0)/metrics.length >= 100,
    'too few completed passes across the seeded races (near-tie jitter excluded)');
});
