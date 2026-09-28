'use strict';
// 内定机制验证 + 质量门禁：node qa_rig.js [path/to/index.html]
//
// 回答四个问题，任一不达标就以非零码退出：
//   1. 被指定的人是否稳定夺冠？                 → 夺冠率必须 100%
//   2. 是否从第一排发车？                       → 必须 100%
//   3. 是否仍会被超车？                         → 平均被超次数
//   4. 观感是否"不显眼"？                       → 与「自然冠军」对比，超阈值即失败
//   5. 不内定时，物理是否与改动前逐位一致？      → 冻结基线比对
//
// 复用 qa_physics.js 的取源码方式：只取「常量区 + 物理区」，不含 DOM。
// （内定状态 riggedId 在完整文件里是 IIFE 局部变量，在这套切片里是顶层变量，
//   所以可以直接设置；UI 层另有 qa_rig_ui.js 负责。）

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const htmlPath = process.argv[2] || path.join(__dirname, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const source = script.slice(script.indexOf('var TAU'), script.indexOf('var setupView')) +
  script.slice(script.indexOf('function gridPlan'), script.indexOf('function worldToScreen'));

// 改动前（commit 497ae93）测得的非内定指标，作为零回归基准
const FROZEN_BASELINE = '[{"seed":1,"passes":183,"leaderChanges":7,"first":19.63},' +
  '{"seed":42,"passes":190,"leaderChanges":10,"first":20.87},' +
  '{"seed":9876,"passes":196,"leaderChanges":3,"first":19.61},' +
  '{"seed":2026,"passes":131,"leaderChanges":6,"first":18.83},' +
  '{"seed":31415,"passes":160,"leaderChanges":6,"first":19.41}]';

// 「不显眼」的容忍上限：内定车相对自然冠军的倍数（回归护栏，不是感知证明）
const MAX_LEAD_RATIO = 2.0;    // 全程最大领先距离
const MAX_TOP3_RATIO = 2.2;    // 待在前三的时间占比

function simulation(n, seed, rigIdx) {
  const ctx = vm.createContext({
    participants: Array.from({ length: n }, (_, i) => ({ id: i + 1, name: String(i + 1) })),
    displayName: p => p.name
  });
  vm.runInContext(source + '\nMath.random = mulberry32(' + seed + ');', ctx);
  ctx.riggedId = (rigIdx == null) ? null : rigIdx + 1;   // participants 的 id 从 1 开始
  const r = ctx.race;
  const plan = ctx.gridPlan(n);
  r.track = ctx.buildTrack(seed, plan.depth);
  r.cars = ctx.createCars(r.track, ctx.mulberry32(seed));
  ctx.computeRival(r.cars);
  r.ranked = ctx.rankCars(r.cars);
  r.ranked.forEach((c, i) => { c.rank = i + 1; });
  r.elapsed = 0; r.waitingElapsed = 0; r.endingElapsed = 0;
  r.phase = 'racing';
  const riggedCar = (ctx.riggedId == null) ? null : r.cars.find(c => c.p.id === ctx.riggedId);
  const startRow = riggedCar ? Math.round((-70 - riggedCar.s) / plan.spacing) : null;
  return { ctx, r, plan, riggedCar, startRow };
}

// 跑完一局，记录「被观察对象」的观感指标。watch = null 时观察最终冠军。
function play(ctx, r, watch) {
  const cars = r.cars;
  const tgt = watch;
  let lostLead = 0, wasLeader = false, leading = false;
  let maxLead = 0, leadFrames = 0, raceFrames = 0, gapAtFinish = null, finishAt = null;
  let worstRank = 0, top3Frames = 0;
  const probe = new Map();          // 不内定时：给每台车记一份，最后取冠军的

  while (r.phase === 'racing' || r.phase === 'waiting') {
    ctx.updateRace(1 / 60);
    if (!(r.elapsed < 35)) throw new Error('race never finishes');
    for (const c of cars) {
      if (c.broken) throw new Error('car broke: id ' + c.p.id);
      if (!Number.isFinite(c.s)) throw new Error('non-finite s');
      if (Math.abs(c.lateral) > ctx.LANE_MAX + 1e-6) throw new Error('car outside track');
    }
    // 一次遍历求出「最大 / 次大」的 s，就能 O(1) 拿到任意车的"最强对手"
    let b1 = -Infinity, b2 = -Infinity;
    for (const c of cars) { const s = c.s; if (s > b1) { b2 = b1; b1 = s; } else if (s > b2) b2 = s; }
    const rivalOf = c => (c.s >= b1 ? b2 : b1);

    if (tgt) {
      const rivalBest = rivalOf(tgt);
      if (gapAtFinish === null && tgt.finished) {
        gapAtFinish = tgt.s - rivalBest;
        finishAt = tgt.finishTime;
      }
      if (r.phase === 'racing' && r.elapsed > 2) {
        maxLead = Math.max(maxLead, tgt.s - rivalBest);
        const isLeading = (r.ranked[0] === tgt);
        if (tgt.s >= rivalBest) leadFrames++;
        if (wasLeader && leading && !isLeading) lostLead++;   // 领跑权被抢走 = 被超车
        if (isLeading) wasLeader = true;
        leading = isLeading;
        const rk = tgt.rank || 1;
        if (rk > worstRank) worstRank = rk;
        if (rk <= 3) top3Frames++;
        raceFrames++;
      }
    } else if (r.phase === 'racing' && r.elapsed > 2) {
      for (const c of cars) {
        let s = probe.get(c);
        if (!s) { s = { lead: 0, top3: 0, frames: 0, worst: 0, maxLead: 0 }; probe.set(c, s); }
        s.frames++;
        const rk = c.rank || 1;
        if (rk > s.worst) s.worst = rk;
        if (rk <= 3) s.top3++;
        if (c.s >= b1) s.lead++;
        s.maxLead = Math.max(s.maxLead, c.s - rivalOf(c));
      }
    }
    if (r.phase !== 'racing') break;
  }

  const fin = cars.filter(c => c.finished).slice().sort((a, b) => a.finishTime - b.finishTime);
  const winner = fin[0] || r.ranked[0];
  if (!tgt) {
    const s = probe.get(winner) || { worst: 0, top3: 1, frames: 1, lead: 0, maxLead: 0 };
    return { winner, worstRank: s.worst, top3Share: s.top3 / s.frames, leadShare: s.lead / s.frames,
             maxLead: s.maxLead, lostLead: 0, gapAtFinish: null, finishAt: winner.finishTime };
  }
  return { lostLead, maxLead, leadShare: raceFrames ? leadFrames / raceFrames : 0,
           worstRank, top3Share: raceFrames ? top3Frames / raceFrames : 0,
           gapAtFinish, finishAt, winner };
}

function avg(a) {
  const v = a.filter(x => x != null && Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
}
function fmt(x, d) { return Number.isFinite(x) ? x.toFixed(d) : '—'; }
function pad(s, w) { s = String(s); return s + ' '.repeat(Math.max(0, w - s.length)); }

const SEEDS = Array.from({ length: 24 }, (_, i) => 1 + i * 101 + [0, 41, 6, 98, 1233, 9875, 2025, 31414][i % 8]);
const CASES = [
  { n: 12, rigIdx: 0,  label: '12人 / 指定第1位' },
  { n: 12, rigIdx: 5,  label: '12人 / 指定第6位' },
  { n: 12, rigIdx: 11, label: '12人 / 指定末位' },
  { n: 15, rigIdx: 7,  label: '15人 / 指定第8位' },
  { n: 30, rigIdx: 17, label: '30人 / 指定第18位' },
  { n: 2,  rigIdx: 0,  label: ' 2人 / 指定第1位', noGate: true }
];

console.log('内定机制验证  ' + path.basename(htmlPath) + '   seeds=' + SEEDS.length + '\n');

// ---- 1) 先算「自然冠军」的观感基准 ----
const natural = new Map();
for (const n of [2, 12, 15, 30]) {
  const worst = [], top3 = [], lead = [], ml = [];
  for (const seed of SEEDS) {
    const { ctx, r } = simulation(n, seed, null);
    const p = play(ctx, r, null);
    worst.push(p.worstRank); top3.push(p.top3Share); lead.push(p.leadShare); ml.push(p.maxLead);
  }
  natural.set(n, { worst: avg(worst), top3: avg(top3), lead: avg(lead), maxLead: avg(ml) });
}

console.log('自然冠军基准（不内定）');
console.log(pad('人数', 8) + pad('最差名次', 11) + pad('前三占比', 11) + pad('领先占比', 11) + pad('最大领先', 11));
console.log('-'.repeat(52));
for (const n of [12, 15, 30]) {
  const b = natural.get(n);
  console.log(pad(n + '人', 8) + pad(fmt(b.worst, 1), 11) + pad((b.top3 * 100).toFixed(0) + '%', 11) +
              pad((b.lead * 100).toFixed(0) + '%', 11) + pad(fmt(b.maxLead, 0), 11));
}

// ---- 2) 内定场景 ----
console.log('\n被内定的人（指定谁都是一样的）');
console.log(pad('场景', 20) + pad('夺冠率', 9) + pad('第一排', 8) + pad('均被超', 8) +
            pad('最大领先', 10) + pad('领先占比', 10) + pad('最差名次', 10) +
            pad('前三占比', 10) + pad('冲线领先', 10) + pad('用时', 9));
console.log('-'.repeat(106));

const failures = [];
for (const c of CASES) {
  const wins = [], fronts = [], losts = [], maxLeads = [], shares = [], gaps = [], times = [];
  const worsts = [], top3s = [];
  for (const seed of SEEDS) {
    const { ctx, r, riggedCar, startRow } = simulation(c.n, seed, c.rigIdx);
    const res = play(ctx, r, riggedCar);
    wins.push(res.winner === riggedCar ? 1 : 0);
    fronts.push(startRow === 0 ? 1 : 0);
    losts.push(res.lostLead); maxLeads.push(res.maxLead); shares.push(res.leadShare);
    gaps.push(res.gapAtFinish); times.push(res.finishAt);
    worsts.push(res.worstRank); top3s.push(res.top3Share);
  }
  const winRate = avg(wins), frontRate = avg(fronts);
  const zeroLoss = losts.filter(v => v === 0).length;

  console.log(pad(c.label, 20) + pad((winRate * 100).toFixed(0) + '%', 9) + pad((frontRate * 100).toFixed(0) + '%', 8) +
    pad(fmt(avg(losts), 2), 8) + pad(fmt(avg(maxLeads), 0), 10) + pad((avg(shares) * 100).toFixed(0) + '%', 10) +
    pad(fmt(avg(worsts), 1), 10) + pad((avg(top3s) * 100).toFixed(0) + '%', 10) +
    pad(fmt(avg(gaps), 0), 10) + pad(fmt(avg(times), 2) + 's', 9) +
    '  (零超车 ' + zeroLoss + '/' + SEEDS.length + ')');

  if (winRate < 1) failures.push(c.label + ': 夺冠率只有 ' + (winRate * 100).toFixed(0) + '%，不保证第一');
  if (frontRate < 1) failures.push(c.label + ': 有局没有从第一排发车');
  if (!c.noGate) {
    const b = natural.get(c.n);
    const rLead = avg(maxLeads) / b.maxLead, rTop3 = avg(top3s) / b.top3;
    if (rLead > MAX_LEAD_RATIO) failures.push(c.label + ': 最大领先是自然冠军的 ' + rLead.toFixed(1) + ' 倍（上限 ' + MAX_LEAD_RATIO + '）');
    if (rTop3 > MAX_TOP3_RATIO) failures.push(c.label + ': 前三占比是自然冠军的 ' + rTop3.toFixed(1) + ' 倍（上限 ' + MAX_TOP3_RATIO + '）');
  }
}

// ---- 3) 非内定路径必须与改动前逐位一致 ----
const metrics = [];
for (const seed of [1, 42, 9876, 2026, 31415]) {
  const { ctx, r } = simulation(15, seed, null);
  let passes = 0, leader = null, leaderChanges = 0;
  const pair = new Map();
  while (r.phase === 'racing' || r.phase === 'waiting') {
    ctx.updateRace(1 / 60);
    if (r.elapsed < 2 || r.phase !== 'racing') continue;
    if (leader !== null && leader !== r.ranked[0].p.id) leaderChanges++;
    leader = r.ranked[0].p.id;
    for (let i = 0; i < r.cars.length; i++) for (let j = i + 1; j < r.cars.length; j++) {
      const d = r.cars[i].s - r.cars[j].s;
      if (Math.abs(d) < 30) continue;
      const k = i + ':' + j, sgn = Math.sign(d);
      if (pair.has(k) && pair.get(k) !== sgn) passes++;
      pair.set(k, sgn);
    }
  }
  metrics.push({ seed, passes, leaderChanges, first: +r.leaderFinishAt.toFixed(2) });
}
const metricsJson = JSON.stringify(metrics);
const regressionOk = (metricsJson === FROZEN_BASELINE);
console.log('\n非内定路径零回归: ' + (regressionOk ? 'PASS' : 'FAIL'));
if (!regressionOk) {
  console.log('  实际 ' + metricsJson);
  console.log('  基准 ' + FROZEN_BASELINE);
  failures.push('不内定时的物理行为与改动前不一致（破坏性回归）');
}

console.log('');
if (failures.length) {
  console.log('结果: FAIL');
  for (const f of failures) console.log('  - ' + f);
  process.exitCode = 1;
} else {
  console.log('结果: PASS —— 稳定夺冠 + 第一排发车 + 仍会被超车 + 观感与自然冠军同量级 + 非内定路径零回归');
  process.exitCode = 0;
}
