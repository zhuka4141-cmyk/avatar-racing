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
const CAR_W = 46, CAR_LEN = 78;
function overlapRatio(a, b) {
  const lat = Math.abs(a.lateral - b.lateral), lon = Math.abs(a.s - b.s);
  return Math.max(0, CAR_W - lat) * Math.max(0, CAR_LEN - lon) / (CAR_W * CAR_LEN);
}

// Reintroducing single-row starts makes these fail before the first physics tick.
for (const n of [2, 8, 15, 120, 121, 300]) test(`non-overlapping starting grid: ${n} cars`, () => {
  const ctx = simulation(n), cars = ctx.race.cars;
  for (let i=0; i<n; i++) {
    assert.ok(Math.abs(cars[i].lateral) <= ctx.LANE_MAX, 'car outside track');
    for (let j=i+1; j<n; j++) assert.ok(
      Math.abs(cars[i].s-cars[j].s) >= 86 || Math.abs(cars[i].lateral-cars[j].lateral) >= 50,
      `cars ${i+1}/${j+1} overlap on the grid`);
  }
  const start = cars.map(c => c.s);
  advance(ctx, 1);
  // 反应延迟最多 0.5 秒、静态车速最低 0.87 倍：实测 1 秒内最慢也前进 63+ 单位（卡在起跑线上会是 0）
  assert.ok(cars.every((c,i) => c.s-start[i] > 50), 'all cars must launch within one second');
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
  let bestLead = -Infinity, worst = 0;
  for (let i=0; i<360; i++) {
    ctx.updateRace(1/60);
    bestLead = Math.max(bestLead, rear.s-front.s);
    worst = Math.max(worst, overlapRatio(front, rear));
  }
  assert.ok(worst <= 0.5, `cars overlapped ${(worst*100).toFixed(0)}% of the body (limit 50%)`);
  assert.ok(bestLead > 30, `faster rear car never completes a pass: best lead ${bestLead.toFixed(1)}`);
});

test('cars pass through each other: no braking for the car ahead, overlap capped at half', () => {
  // 对照实验：同一台车单独跑 vs 前面压一台慢车 —— 速度不能因为前车而下降（没有被前车刹车）
  const solo = simulation(1), alone = solo.race.cars[0];
  const ctx = simulation(2), [front,rear] = ctx.race.cars;
  front.s = 1400; rear.s = 1280; alone.s = 1280;
  for (const c of [alone,front,rear]) {
    c.lateral = c.lane = c.baseLane = 0;
    c.startDelay = 0; c.v = c.baseSpeed = 400;
    c.paceSeed = c.paceSeed2 = c.paceSeed3 = c.wobbleSeed = 0;
  }
  rear.baseSpeed = 430;                       // 后车更快，应该直接穿过去
  ctx.race.elapsed = 2; solo.race.elapsed = 2;
  let worst = 0, minRatio = Infinity, bestLead = -Infinity;
  for (let i = 0; i < 60 * 6; i++) {
    ctx.updateRace(1/60); solo.updateRace(1/60);
    worst = Math.max(worst, overlapRatio(front, rear));
    if (i > 30) minRatio = Math.min(minRatio, rear.v / Math.max(1, alone.v));
    bestLead = Math.max(bestLead, rear.s - front.s);
  }
  assert.ok(worst <= 0.5, `overlap reached ${(worst*100).toFixed(0)}%`);
  assert.ok(minRatio > 0.95, `the car behind slowed for the car ahead (ratio ${minRatio.toFixed(2)})`);
  assert.ok(bestLead > 5, 'the faster car never got through');   // 近距离来回换位是设计内的，只要求确实穿过去过
});

test('a drawn grid order moves cars to the shuffled slots', () => {
  const ctx = simulation(15);
  const plan = ctx.gridPlan(15);
  const order = ctx.gridOrder = Array.from({ length: 15 }, (_, i) => 14 - i);   // 倒序签位
  const cars = ctx.createCars(ctx.race.track, ctx.mulberry32(1));
  for (let i = 0; i < 15; i++) {
    const col = order[i] % plan.cols, row = Math.floor(order[i] / plan.cols);
    assert.equal(cars[i].lateral, (col - (plan.cols - 1)/2) * ctx.LANE_STEP, 'lateral slot mismatch');
    assert.equal(cars[i].s, -70 - row * plan.spacing, 'grid row mismatch');
  }
  for (let i = 0; i < 15; i++) for (let j = i+1; j < 15; j++)
    assert.ok(Math.abs(cars[i].s-cars[j].s) >= 86 || Math.abs(cars[i].lateral-cars[j].lateral) >= 50, 'shuffled grid overlaps');
  ctx.gridOrder = null;
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

test('outside the top five cars get a random boost, the top five never do', () => {
  const ctx = simulation(8), cars = ctx.race.cars, c = cars[6];   // 第 7 名
  cars[0].s = 1800;
  c.s = 1600; c.rank = 7; c.catchup = 1; c.boostTimer = 2; c.boostPower = 0.12; c.boostCooldown = 5;
  ctx.race.leaderS = cars[0].s;
  const without = Object.assign({}, c, { boostTimer: 0 });
  ctx.updateCar(c, 1/60, 2, 9000);
  ctx.updateCar(without, 1/60, 2, 9000);
  assert.ok(c.catchup > without.catchup, 'rank 7 never receives its random acceleration');
  const prior = c.catchup;
  c.rank = 1;                                     // 超过所有人：加速必须平滑淡出，不能突然切掉
  ctx.updateCar(c, 1/60, 2 + 1/60, 9000);
  assert.ok(Math.abs(c.catchup - prior) < 0.05, 'rank swap cuts the boost abruptly');
  assert.equal(c.boostTimer, 0, 'top five keep no acceleration timer');
});

test('an overtake settles the random boost instead of flying past', () => {
  const ctx = simulation(8), cars = ctx.race.cars;
  const run = (settleTimer, frames) => {
    const c = cars[4];
    Object.assign(c, { s: 1600, v: 480, catchup: 1.3, rank: 6, lastRank: 6, boostTimer: 2, boostPower: 0.12,
      settleTimer, aheadGap: 400, aheadV: 0, draft: 0, blocked: 0, follow: 1, passTimer: 0 });
    ctx.race.leaderS = 2000;
    for (let i = 0; i < frames; i++) ctx.updateCar(c, 1/60, 2 + i/60, 9000);
    return c;
  };
  const boosted = run(0, 72).v, settled = run(1.0, 72).v;
  assert.ok(settled < boosted - 15, 'overtake must fade the boost: ' + settled.toFixed(0) + ' vs ' + boosted.toFixed(0));
});

test('whole races stay finite and settle by the tenth finisher or five seconds', () => {
  const metrics = [];
  for (const seed of [1, 42, 9876, 2026, 31415]) {
    const ctx = simulation(15, seed), r = ctx.race;
    const pairOrder = new Map();
    let passes = 0, leaderChanges = 0, leader = null, maxOverlap = 0;
    while (r.phase === 'racing' || r.phase === 'waiting') {
      ctx.updateRace(1/60);
      assert.ok(r.elapsed < 35, 'race never finishes');
      for (const c of r.cars) assert.ok(!c.broken && Number.isFinite(c.s) && Math.abs(c.lateral) <= ctx.LANE_MAX);
      if (r.elapsed < 2 || r.phase !== 'racing') continue;
      if (leader !== null && leader !== r.ranked[0].p.id) leaderChanges++;
      leader = r.ranked[0].p.id;
      for (let i=0;i<r.cars.length;i++) for (let j=i+1;j<r.cars.length;j++) maxOverlap = Math.max(maxOverlap, overlapRatio(r.cars[i], r.cars[j]));
      for (let i=0;i<r.cars.length;i++) for (let j=i+1;j<r.cars.length;j++) {
        const delta = r.cars[i].s-r.cars[j].s;
        if (Math.abs(delta) < 30) continue; // Ignore near-tie rank jitter.
        const key = i+':'+j, sign = Math.sign(delta);
        if (pairOrder.has(key) && pairOrder.get(key) !== sign) passes++;
        pairOrder.set(key,sign);
      }
    }
    assert.ok(maxOverlap <= 0.5, `cars overlapped ${(maxOverlap*100).toFixed(0)}% of the body`);
    assert.ok(r.leaderFinishAt >= 18 && r.leaderFinishAt <= 23, `winner at ${r.leaderFinishAt}`);
    assert.ok(r.cars.filter(c => c.finished).length >= 10 || r.waitingElapsed >= 5);
    assert.ok(r.waitingElapsed <= 5.04);
    assert.equal(r.results.length, 15);
    metrics.push({ seed, passes, leaderChanges, first:+r.leaderFinishAt.toFixed(2), maxOverlap:+maxOverlap.toFixed(3) });
  }
  console.log('RACE_METRICS', JSON.stringify(metrics));
  assert.ok(metrics.reduce((sum,m) => sum+m.passes,0)/metrics.length >= 100,
    'too few completed passes across the seeded races (near-tie jitter excluded)');
});
