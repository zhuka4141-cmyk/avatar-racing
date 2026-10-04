(function(){
'use strict';

var AvatarRace = window.AvatarRace;

var setupView = document.getElementById('setupView');
var raceView = document.getElementById('raceView');
var listEl = document.getElementById('list');
var emptyEl = document.getElementById('empty');
// 搜索：注意这些 DOM 引用必须留在这里（var setupView 之后）——
// 测试用的源码切片从 var setupView 截断，切片里没有 document。
var searchBarEl = document.getElementById('searchBar');
var searchInputEl = document.getElementById('searchInput');
var searchClearEl = document.getElementById('searchClear');
var searchCountEl = document.getElementById('searchCount');
var canvas = document.getElementById('game');
var ctx = canvas.getContext('2d');
ctx.imageSmoothingQuality = 'high';
var hudStatus = document.getElementById('hudStatus');
var hudSub = document.getElementById('hudSub');
var countBadge = document.getElementById('countBadge');
var diagEl = document.getElementById('diag');
var countdownEl = document.getElementById('countdown');
var countdownText = document.getElementById('countdownText');
var resultEl = document.getElementById('result');
var resultNote = document.getElementById('resultNote');
var boardEl = document.getElementById('board');
var toastEl = document.getElementById('toast');
var rankBtnEl = document.getElementById('rankBtn');

var viewW = 1, viewH = 1, dpr = 1;
var camMat = { a:1,b:0,c:0,d:-1,e:0,f:0,scale:1 };
var lowQuality = false;
var fpsAcc = 0, fpsFrames = 0;
var toastTimer = 0;

/* ------------------------------------------------------------------ *
 * 参赛者与头像
 * ------------------------------------------------------------------ */

var participantStore = AvatarRace.participants.createStore();
var participants = participantStore.items;
var trackApi = AvatarRace.track;
function displayName(p){ return AvatarRace.participants.displayName(participantStore, p); }
function applyDefaultNames(){
  AvatarRace.participants.applyDefaultNames(participantStore);
  for (var i = 0; i < participants.length; i++) {
    if (participants[i].node && participants[i].node.inp) participants[i].node.inp.value = participants[i].name;
  }
}
/* ------------------------------------------------------------------ *
 * 赛道生成（seeded PRNG + 平滑曲线 + 曲率/自相交校验）
 * ------------------------------------------------------------------ */

function gridPlan(n){
  var cols = Math.max(1, Math.min(Math.max(1,n), AvatarRace.config.LANES));   // 最多 14 车一排
  var rows = Math.max(1, Math.ceil(Math.max(1,n) / cols));
  var spacing = 100; // 车长约 78；人数增加时延长起跑区，不压缩车距。
  return { cols: cols, rows: rows, spacing: spacing, depth: 70 + (rows - 1) * spacing + 140 };
}
function buildTrack(seed, backRunoff){
  var L = AvatarRace.config.RACE_DIST;
  var step = 6;                 // 中心线采样步长（世界单位）
  for (var attempt=0; attempt<6; attempt++){
    var rnd = AvatarRace.math.mulberry32((seed + attempt*7919) >>> 0);
    var st = { x: 0, y: 0, theta: 0, pts: [] };
    // 以曲率函数 kf 前进 len：κ 积分得航向，再积分得位置
    var advance = function(kf, len){
      var n = Math.max(1, Math.round(len/step));
      var dl = len/n;
      for (var i=0;i<n;i++){
        st.pts.push({ x: st.x, y: st.y });
        st.theta += kf(i*dl, len) * dl;
        st.x += Math.cos(st.theta)*dl;
        st.y += Math.sin(st.theta)*dl;
      }
    };
    // 直道缓弯：直接给定相对基准航向的偏移（横向摆动量被硬性限制在 ±E 内，
    // 不会像曲率积分那样累积漂移，因此各层直道间距始终安全）
    var advanceHead = function(headFn, len, base){
      var n = Math.max(1, Math.round(len/step));
      var dl = len/n;
      for (var i=0;i<n;i++){
        st.pts.push({ x: st.x, y: st.y });
        var th = base + headFn(i*dl, len);
        st.x += Math.cos(th)*dl;
        st.y += Math.sin(th)*dl;
      }
      st.theta = base;
    };
    st.pts.push({ x: st.x, y: st.y });
    var total = 0, guard = 0, turnCount = 0, isFirst = true;
    // 阶梯布局：直道（带一个完整正弦周期的缓弯，净转角 0）→ 半圆 U 型弯 → 直道 → ...
    // 每段直道都比上一段高出一个 pitch，pitch 远大于赛道宽度，因此各段永不重叠。
    while (total < L - 260 && guard++ < 40){
      var legLen = Math.min(L - total, isFirst ? 1000 : (1150 + rnd()*750));
      // 缓弯最大横向摆动：够弯但仍让曲率半径远大于半宽（赛道末端自检会复核）
      var swingCap = Math.min(AvatarRace.config.HALF_W*0.30, legLen*legLen/(105*AvatarRace.config.HALF_W));
      var swing = isFirst ? 0 : swingCap*(0.55 + rnd()*0.45);   // 世界单位
      var ph = rnd()*AvatarRace.config.TAU;
      var base = st.theta;
      (function(sw, p2, bs){
        advanceHead(function(sl, len){
          var u = sl/len;
          var s2 = Math.sin(Math.PI*u), c2 = Math.cos(Math.PI*u);
          var env = s2*s2;                        // 两端为 0，保证进出直道时航向与基准一致
          var dEnv = 2*Math.PI*s2*c2;
          var sn = Math.sin(AvatarRace.config.TAU*u + p2), cs = Math.cos(AvatarRace.config.TAU*u + p2);
          return Math.atan((sw/len) * (dEnv*sn + env*AvatarRace.config.TAU*cs));
        }, legLen, bs);
      })(swing, ph, base);
      total += legLen;
      isFirst = false;
      // 相邻直道的间距：两个半宽 + 两侧摆动 + 安全缝，U 型弯半径才不至于让赛道带自己贴住
      var pitch = 2*AvatarRace.config.HALF_W + 2*AvatarRace.config.HALF_W*0.30 + 180 + rnd()*200;
      var Rh = pitch/2;                 // U 型弯半径 = 间距的一半
      var turnLen = Math.PI*Rh;
      if (total + turnLen + 700 > L) break;   // 末尾留直道做终点线
      // 转向符号必须交替：每过一个 U 型弯，航向翻转 180° 且整体前进一个 pitch，
      // 这样奇数段/偶数段分别落在不同高度的水平线上，永不自交。
      var sigma = (turnCount % 2 === 0) ? 1 : -1;
      (function(r2, sg){ advance(function(){ return sg/r2; }, Math.PI*r2); })(Rh, sigma);
      total += turnLen;
      turnCount++;
    }
    if (total < L){                     // 收尾直道
      var tail = L - total;
      advance(function(){ return 0; }, tail);
      total += tail;
    }
    var base = st.pts;
    var N = base.length;
    var minR = Infinity;
    for (var j2=1;j2<N-1;j2++){
      var a = base[j2-1], b = base[j2], c = base[j2+1];
      var v1x = b.x-a.x, v1y = b.y-a.y, v2x = c.x-b.x, v2y = c.y-b.y;
      var l1 = Math.sqrt(v1x*v1x+v1y*v1y), l2 = Math.sqrt(v2x*v2x+v2y*v2y);
      var turn = Math.abs(Math.atan2(v1x*v2y-v1y*v2x, v1x*v2x+v1y*v2y));
      var R = turn > 1e-9 ? ((l1+l2)/2)/turn : Infinity;
      if (R < minR) minR = R;
    }
    var clash = false;
    var need = 2*AvatarRace.config.HALF_W + 30;
    for (var p2=0; p2<N && !clash; p2+=3){
      for (var q2=p2+200; q2<N; q2+=3){
        var ddx = base[p2].x - base[q2].x, ddy = base[p2].y - base[q2].y;
        if (ddx*ddx + ddy*ddy < need*need){ clash = true; break; }
      }
    }
    if (minR > AvatarRace.config.HALF_W*1.35 && !clash) return finishTrack(base, backRunoff, seed, minR, turnCount);
  }
  var straight = [];
  for (var q3=0;q3<Math.round(L/step)+1;q3++) straight.push({ x:0, y: q3*step });
  return finishTrack(straight, backRunoff, seed, Infinity, 0);
}
function finishTrack(base, backRunoff, seed, minR, turns){
  var BACK_RUNOFF = Math.max(600, backRunoff || 600);
  var N = base.length;
  var line = [];
  var p0 = base[0], p1 = base[Math.min(6,N-1)];
  var t0x = p1.x-p0.x, t0y = p1.y-p0.y;
  var t0l = Math.max(1e-6, Math.sqrt(t0x*t0x+t0y*t0y));
  t0x /= t0l; t0y /= t0l;
  var back = [];
  for (var d=BACK_RUNOFF; d>0; d-=10) back.push({ x: p0.x - t0x*d, y: p0.y - t0y*d });
  line = back.concat(base);
  var startIdx = back.length;
  var pe = base[N-1], pe0 = base[N-3];
  var tex = pe.x-pe0.x, tey = pe.y-pe0.y;
  var tel = Math.max(1e-6, Math.sqrt(tex*tex+tey*tey));
  tex /= tel; tey /= tel;
  for (var d2=10; d2<=AvatarRace.config.FWD_RUNOFF; d2+=10) line.push({ x: pe.x + tex*d2, y: pe.y + tey*d2 });

  var cum = new Array(line.length);
  cum[startIdx] = 0;
  for (var m=startIdx+1;m<line.length;m++) cum[m] = cum[m-1] + AvatarRace.math.dist(line[m-1], line[m]);
  for (var n2=startIdx-1;n2>=0;n2--) cum[n2] = cum[n2+1] - AvatarRace.math.dist(line[n2], line[n2+1]);

  var out = [];
  var prevAng = null;
  for (var t2=0;t2<line.length;t2++){
    var aa = line[Math.max(0,t2-1)], bb = line[Math.min(line.length-1,t2+1)];
    var ang = Math.atan2(bb.y-aa.y, bb.x-aa.x);
    if (prevAng !== null){
      while (ang - prevAng > Math.PI) ang -= AvatarRace.config.TAU;
      while (ang - prevAng < -Math.PI) ang += AvatarRace.config.TAU;
    }
    prevAng = ang;
    out.push({ x: line[t2].x, y: line[t2].y, s: cum[t2], ang: ang, nx: -Math.sin(ang), ny: Math.cos(ang) });
  }
  return { pts: out, raceLen: cum[startIdx+N-1], seed: seed, minR: minR, turns: turns };
}

function sampleAt(track, s){
  var P = track.pts;
  if (!P || !P.length) return { x:0,y:0,ang:-Math.PI/2,s:0,nx:0,ny:0 };
  var firstP = P[0];
  if (s <= firstP.s){
    var d0 = firstP.s - s;
    return { x: firstP.x - Math.cos(firstP.ang)*d0, y: firstP.y - Math.sin(firstP.ang)*d0, ang: firstP.ang, s: s, nx: firstP.nx, ny: firstP.ny };
  }
  var last = P[P.length-1];
  if (s >= last.s){
    var d1 = s - last.s;
    return { x: last.x + Math.cos(last.ang)*d1, y: last.y + Math.sin(last.ang)*d1, ang: last.ang, s: s, nx: last.nx, ny: last.ny };
  }
  var lo = 0, hi = P.length-1;
  while (hi - lo > 1){
    var mid = (lo+hi) >> 1;
    if (P[mid].s <= s) lo = mid; else hi = mid;
  }
  var a = P[lo], b = P[hi];
  var t = (s - a.s) / Math.max(1e-6, b.s - a.s);
  return { x: a.x+(b.x-a.x)*t, y: a.y+(b.y-a.y)*t, ang: a.ang+(b.ang-a.ang)*t, s: s, nx: a.nx, ny: a.ny };
}
function indexAtS(track, s){
  var P = track.pts;
  if (s <= P[0].s) return 0;
  if (s >= P[P.length-1].s) return P.length-1;
  var lo = 0, hi = P.length-1;
  while (hi - lo > 1){
    var mid = (lo+hi) >> 1;
    if (P[mid].s <= s) lo = mid; else hi = mid;
  }
  return lo;
}

/* ------------------------------------------------------------------ *
 * 比赛状态机
 * ------------------------------------------------------------------ */

var race = {
  phase: 'setup', seed: 1, track: null,
  elapsed: 0, countdown: 0, waitingElapsed: 0, endingElapsed: 0, leaderFinishAt: 0,
  cars: [], ranked: [], results: [], focusY: 0.62, lowQ: false, rival: -Infinity,
  cam: { s:0, x:0, y:0, ang:-Math.PI/2 }, rng: null,
  participants: participants, gridOrder: null, riggedId: null
};

// Rendering helpers continue to use the short local names, while their domain implementations live in track.js.
gridPlan = trackApi.gridPlan;
buildTrack = trackApi.buildTrack;
sampleAt = trackApi.sampleAt;
indexAtS = trackApi.indexAtS;

function rankCars(cars){
  return cars.slice().sort(function(a,b){
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    if (b.s !== a.s) return b.s - a.s;
    return a.p.id - b.p.id;
  });
}
function createCars(track, rnd){
  var baseSpeed = track.raceLen / 21.5;   // 距离制追赶会让整体节奏偏快，基准同步放慢以保持冠军 ~19-20s
  var cars = participants.map(function(p){
    return {
      p: p, s: 0, v: 0, lateral: 0, yaw: 0, progress: 0,
      finished: false, finishTime: 0, broken: false,
      baseSpeed: baseSpeed * (1 + (rnd()*2-1) * 0.13),   // 静态车速差距 ±13%
      accel: 2.2 * (1 + (rnd()*2-1) * 0.22),
      startDelay: rnd() * 0.5,
      wobbleSeed: rnd() * AvatarRace.config.TAU,
      paceSeed: rnd() * AvatarRace.config.TAU,
      paceSeed2: rnd() * AvatarRace.config.TAU,
      paceSeed3: rnd() * AvatarRace.config.TAU,
      draft: 0, blocked: 0, follow: 1, gone: false, clear: true,
      rank: 1, lastRank: 1, catchup: 1,
      boostTimer: 0, boostCooldown: 1 + rnd()*4, boostPower: 0,   // 第 6 名起的随机加速
      settleTimer: 0, aheadGap: Infinity, aheadV: 0,              // 超过前车后的自动调速
      passTimer: 0, passPower: 0.14,                              // 变道/穿过时的一脚加速
      finishBias: (rnd()*2-1) * 0.015,      // 终点段 ±1.5% 微偏置，避免完全同时冲线
      lane: 0, baseLane: 0, passUntil: 0, laneCooldown: 2 + rnd()*5
    };
  });
  var n = cars.length;
  var grid = gridPlan(n);
  // 发车格：默认按名单顺序；点过「随机排序」后按抽签结果落位（车的位置也是一次独立随机）
  var gorder = [];
  for (var g=0;g<n;g++) gorder.push((participantStore.gridOrder && participantStore.gridOrder.length === n) ? participantStore.gridOrder[g] : g);
  // ---- 内定：把被指定的人换到第一排 ------------------------------------
  // 只做一次换位，让被指定的人拿到第一排的格子，同时保证 gorder 仍是 0..n-1 的
  // 合法排列 —— 其余人的相对顺序完全不受影响。
  var rig = null;
  if (participantStore.riggedId != null){
    for (var q=0;q<n;q++){ if (cars[q].p && cars[q].p.id === participantStore.riggedId){ rig = cars[q]; break; } }
  }
  if (rig){
    var ri = cars.indexOf(rig);
    // 第一排里随机挑一个格子：保证在第一排，但每局的位置都不一样 ——
    // 固定停在同一个位子本身就会形成一个可被认出来的规律。
    // 用赛道种子派生的 rnd，所以同一局重放（或回放）结果一致。
    var wantGi = AvatarRace.math.clamp(Math.floor(rnd() * grid.cols), 0, grid.cols - 1);
    var curGi = gorder[ri];
    if (curGi !== wantGi){
      var holder = -1;
      for (var z=0;z<n;z++){ if (gorder[z] === wantGi){ holder = z; break; } }
      gorder[ri] = wantGi;
      if (holder >= 0 && holder !== ri) gorder[holder] = curGi;
    }
  }
  for (var i=0;i<n;i++){
    var gi = gorder[i];
    var col = gi % grid.cols;
    // 车位居中排布、间距 = AvatarRace.config.LANE_STEP，变道时一格格挪
    var slot = col - (grid.cols - 1)/2;
    cars[i].lateral = slot * AvatarRace.config.LANE_STEP;
    cars[i].s = -70 - Math.floor(gi/grid.cols) * grid.spacing;
    cars[i].lane = cars[i].lateral;
    cars[i].baseLane = cars[i].lane;
  }
  // ---- 内定：摆完发车格再调参数 ----------------------------------------
  if (rig){
    rig.rigged = true;
    var bestBase = 0;
    for (var b=0;b<n;b++) if (cars[b].baseSpeed > bestBase) bestBase = cars[b].baseSpeed;
    rig.baseSpeed = bestBase * (1 + AvatarRace.config.RIG.baseEdge);     // 只比场上最快的人快一丁点
    rig.startDelay = Math.min(rig.startDelay, 0.12);   // 不在起跑反应上吃亏
    rig.accel = Math.max(rig.accel, 2.6);              // 起步别被憋住
    rig.finishBias = 0.015;                            // 终盘偏置取原分布的上沿（原为 ±1.5%）
  }
  return cars;
}
function updateCar(c, dt, t, raceLen){
  if (c.gone) return;
  var targetV = 0;
  if (c.finished){
    targetV = c.baseSpeed * 0.55;          // 冲线后减速巡航，一路驶出画面
  } else if (t >= c.startDelay){
    var pace = 1 + 0.12*Math.sin(t*0.37 + c.paceSeed)
                 + 0.07*Math.sin(t*0.93 + c.paceSeed2)
                 + 0.05*Math.sin(t*0.21 + c.paceSeed3);
    // 内定车：随比赛推进把它自己的正弦抖动压掉（均值仍是 1，只是跑得更「稳」）
    if (c.rigged && AvatarRace.config.RIG.paceDamp > 0){
      pace = 1 + (pace - 1) * (1 - AvatarRace.config.RIG.paceDamp * AvatarRace.math.clamp(c.s / raceLen, 0, 1));
    }
    // ---- 追赶机制 ----
    // 后车获得平滑追赶增益；加速开始后持续到结束，保留完成超车的速度优势。
    var rank = c.rank || 1;
    var gap = Math.max(0, (Number.isFinite(race.leaderS) ? race.leaderS : c.s) - c.s);
    // 越靠后越快：按「落后领先者多少」连续给油。不按名次跳变 —— 按名次的话刚超到第一就会瞬间掉速，
    // 车队会来回乒乓；领先者本身不加成，所以速度最高的永远是最后面那些车。
    var gapBoost = AvatarRace.math.clamp(gap / 900, 0, 1) * 0.45;      // 落后 900 单位 → +45%，之后不再增加
    if (rank < c.lastRank) c.settleTimer = 1.2;      // 名次上升 = 刚超过对手 → 进入自动调速
    c.lastRank = rank;
    // 第 6 名及以后：随机加速；前五名不额外给加速度。
    var boost = 0;
    if (rank > 5){
      if (c.boostTimer > 0) c.boostTimer -= dt;
      c.boostCooldown -= dt;
      if (c.boostTimer <= 0 && c.boostCooldown <= 0){
        if (Math.random() < 0.7){
          c.boostTimer = 1.0 + Math.random()*2.6;     // 加速持续 1.0~3.6s
          c.boostPower = 0.05 + Math.random()*0.09;   // +5%~14%
        }
        c.boostCooldown = 1.2 + Math.random()*3.6;
      }
      boost = c.boostTimer > 0 ? c.boostPower : 0;
      if (c.aheadGap < 90) boost *= AvatarRace.math.clamp(c.aheadGap / 90, 0, 1);   // 快贴上前面那台就收油
    } else {
      c.boostTimer = 0; c.boostPower = 0;
    }
    // 超过对手后自动调速：加速淡出，并贴住前车速度，不让它一路狂飙。
    if (c.settleTimer > 0){
      c.settleTimer -= dt;
      boost *= AvatarRace.math.clamp(c.settleTimer / 1.2, 0, 1);
    }
    var catchup = AvatarRace.math.clamp(1 + gapBoost + boost, 0.85, 1.9);
    var finishRamp = AvatarRace.math.clamp((c.s - (raceLen - 1800)) / 1800, 0, 1);   // 保留中后段争夺，末段平滑淡出追赶。
    if (finishRamp > 0) catchup = AvatarRace.math.lerp(catchup, 1 + c.finishBias, finishRamp);
    c.catchup = AvatarRace.math.damp(c.catchup, catchup, 3, dt);
    // 变道/穿车时给一脚额外推力：要快速超过，不能并排磨蹭
    if (c.passTimer > 0) c.passTimer -= dt;
    var passBoost = c.passTimer > 0 ? c.passPower : 0;
    targetV = c.baseSpeed * pace * (1 + c.draft) * c.follow * (1 - 0.22 * c.blocked) * c.catchup * (1 + passBoost) * rigFactor(c, raceLen);
  }
  if (targetV > 0) c.v += (targetV - c.v) * (1 - Math.exp(-c.accel*dt));
  else c.v = 0;
  c.s += c.v * dt;
  if (!c.finished && c.s >= raceLen){
    c.finished = true;
    // 这一帧只走了 v*dt，冲线发生在帧内某个比例处 —— 反推出精确的亚帧时刻
    var travelled = c.v * dt;
    var frac = travelled > 1e-6 ? AvatarRace.math.clamp((c.s - raceLen) / travelled, 0, 1) : 0;
    c.finishTime = t - dt * frac;
  }
  if (c.s > raceLen + 2800) c.gone = true;
  if (t >= c.passUntil) c.lane = AvatarRace.math.damp(c.lane, c.baseLane, 0.18, dt);
  var wob = 7 * Math.sin(t*0.62 + c.wobbleSeed*2.1);
  var target = AvatarRace.math.clamp(c.lane + wob, -AvatarRace.config.LANE_MAX, AvatarRace.config.LANE_MAX);
  // 横移走匀速（线性）：原来用指数阻尼，起步瞬间横向速度能到 ~190 单位/秒，车头会先甩一下再蹭进车位
  var dx = target - c.lateral;
  var stepX = AvatarRace.config.LANE_SPEED * dt;
  var nl = Math.abs(dx) <= stepX ? target : c.lateral + (dx > 0 ? stepX : -stepX);
  var vn = (nl - c.lateral) / Math.max(dt, 1e-4);
  c.lateral = AvatarRace.math.clamp(nl, -AvatarRace.config.LANE_MAX, AvatarRace.config.LANE_MAX);
  c.yaw = AvatarRace.math.damp(c.yaw, AvatarRace.math.clamp(Math.atan2(vn, Math.max(60, c.v)), -0.4, 0.4), 6, dt);
  c.progress = AvatarRace.math.clamp(c.s / raceLen, 0, 1);
}
/* ---- 内定车的速度系数 ------------------------------------------------- *
 * 中段返回 1（与普通车完全一致，所以照样会被超、会掉到中游）。
 * 只有进入终盘才开始发力，且是「按差距自适应」而不是固定倍率：
 *   err>0 表示还没到目标领先量 → 加油；err<0 表示领先太多 → 收油。
 * race.rival = 「除内定车之外最靠前的车」，见 computeRival。
 * -------------------------------------------------------------------- */
function rigFactor(c, raceLen){
  if (!c.rigged) return 1;
  var rival = race.rival;
  if (!isFinite(rival)) return 1;
  var f = 1;
  var margin = c.s - rival;                                   // >0 = 正领先这么多
  var endT = 1 - AvatarRace.math.clamp((raceLen - c.s) / AvatarRace.config.RIG.endSpan, 0, 1);  // 0 → 1 进入终盘
  // 终盘伺服：把领先量收敛到 endTarget
  if (endT > 0){
    var err = AvatarRace.config.RIG.endTarget - margin;
    if (err > 0) f += AvatarRace.math.clamp(err / AvatarRace.config.RIG.servoHalf, 0, 1) * AvatarRace.config.RIG.servoChase * endT;
    else         f -= AvatarRace.math.clamp(-err / AvatarRace.config.RIG.servoHalf, 0, 1) * AvatarRace.config.RIG.servoHold * endT;
  }
  // 最后一口气：进入最后 lockSpan 后只要还没把对手甩开，就再补一档，确保先压线
  var lockT = 1 - AvatarRace.math.clamp((raceLen - c.s) / AvatarRace.config.RIG.lockSpan, 0, 1);
  if (lockT > 0 && margin < AvatarRace.config.RIG.lockLead){
    f += lockT * AvatarRace.config.RIG.lockBoost * AvatarRace.math.clamp((AvatarRace.config.RIG.lockLead - margin) / AvatarRace.config.RIG.lockLead, 0, 1);
  }
  return f;
}
// 除内定车之外最靠前的车（含已冲线还在滑行的）——内定车唯一需要盯住的对手
function computeRival(cars){
  var best = -Infinity;
  for (var i=0;i<cars.length;i++){
    var c = cars[i];
    if (c.gone) continue;
    if (participantStore.riggedId != null && c.p && c.p.id === participantStore.riggedId) continue;
    if (c.s > best) best = c.s;
  }
  race.rival = best;
}
function planOvertakes(cars){
  // 每 0.25 秒决策一次车道：能变道超车就先超，没机会时偶尔自己换个车道跑。
  if (race.elapsed < 0.7 || race.elapsed < (race.nextPassCheck || 0)) return;
  race.nextPassCheck = race.elapsed + 0.25;
  var freeLane = function(c, lane){        // 目标车位 + 横穿走廊都要空（含正在切进来的车）
    var lo = Math.min(c.lateral, lane) - AvatarRace.config.CAR_W/2, hi = Math.max(c.lateral, lane) + AvatarRace.config.CAR_W/2;
    for (var k=0;k<cars.length;k++){
      var o = cars[k];
      if (o === c || o.broken || o.gone) continue;
      if (Math.abs(o.s - c.s) > 50) continue;          // 只看身边这一小段，不要求整条车道空着
      if (Math.abs(o.lateral - lane) < AvatarRace.config.CAR_W) return false;
      if (o.passUntil > race.elapsed && Math.abs(o.lane - lane) < AvatarRace.config.CAR_W) return false;
      // 走廊里有人就不横穿：否则会从别人车身上刮过去（重叠必然超 50%）
      if (o.lateral > lo && o.lateral < hi) return false;
      if (o.passUntil > race.elapsed && o.lane > lo && o.lane < hi) return false;
    }
    return true;
  };
  for (var i=0;i<cars.length;i++){
    var c = cars[i];
    if (c.finished || c.broken || c.gone) continue;
    c.laneCooldown -= 0.25;
    if (race.elapsed < c.passUntil) continue;   // 正在变道，走完再决策
    var front = null, nearest = 220;
    for (var j=0;j<cars.length;j++){
      var other = cars[j], gap = other.s - c.s;
      if (other === c || other.broken || other.gone) continue;
      if (gap > 20 && gap < nearest && Math.abs(other.lateral-c.lateral) < 48){
        front = other; nearest = gap;
      }
    }
    if (front && !(c.v < front.v - 15 && nearest > 120)){
      // 变道超车：往空的一侧挪一个车位
      var best = null, bestRoom = 0;
      for (var side=-1;side<=1;side+=2){
        var lane = c.lateral + side*AvatarRace.config.LANE_STEP;
        if (Math.abs(lane) > AvatarRace.config.LANE_MAX - 4) continue;
        var room = 250;
        for (var k2=0;k2<cars.length;k2++){
          var o2 = cars[k2], ds2 = o2.s-c.s;
          if (o2 === c || o2.broken || o2.gone || ds2 < -100 || ds2 > 220) continue;
          // 同时检查目标车道与正在切入的车，避免同时抢同一个空隙。
          if (Math.abs(o2.lateral-lane) < 52 || (o2.passUntil > race.elapsed && Math.abs(o2.lane-lane) < 52)){
            room = Math.min(room, Math.abs(ds2));
          }
        }
        if (room > 105 && room > bestRoom){ best = lane; bestRoom = room; }
      }
      if (best !== null && freeLane(c, best)){ c.lane = best; c.passUntil = race.elapsed + 1.8; c.passTimer = Math.max(c.passTimer, 0.9); c.passPower = 0.20; continue; }
    }
    // 随机变道：没人挡路时也会换个车道，之后新车位就是它的巡航车道
    if (c.laneCooldown <= 0){
      var step = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random()*3));
      var slot = AvatarRace.math.clamp(Math.round(c.lateral / AvatarRace.config.LANE_STEP) + step, -(AvatarRace.config.LANES-1)/2, (AvatarRace.config.LANES-1)/2);
      var target = slot * AvatarRace.config.LANE_STEP;
      if (Math.abs(target - c.lateral) > 20 && freeLane(c, target)){
        c.lane = target; c.baseLane = target;
        c.passUntil = race.elapsed + 1.0 + Math.random()*1.0;
        c.laneCooldown = 1.2 + Math.random()*2.0;   // 车多时也要换得动道：别把决策饿死在冷却里
      } else {
        c.laneCooldown = 0.8;
      }
    }
  }
}
var sIdx = [];            // 按 s 排序的车（复用数组，避免每帧分配）
function sortByS(cars){   // 逐对处理只看纵向邻居，车辆多少都不再退化
  var a = sIdx; a.length = 0;
  for (var i=0;i<cars.length;i++){ var c = cars[i]; if (!c.broken && !c.gone) a.push(c); }
  a.sort(function(x,y){ return x.s - y.s; });
  return a;
}
function interact(cars, dt){
  // 车辆之间不碰撞、可以直接穿过去：这里不做刹车、也不做推开。
  // 唯一约束是「两车重叠面积不超过车身的 AvatarRace.config.MAX_OVERLAP」，超了才横向让位。
  // 注意：这里没有车辆数上限 —— 变道与超车在多少台下都要照常发生。
  var n = cars.length;
  for (var q=0;q<n;q++){ cars[q].draft = 0; cars[q].follow = 1; cars[q].aheadGap = Infinity; cars[q].aheadV = 0; }
  planOvertakes(cars);
  var srt = sortByS(cars), m = srt.length;
  for (var i=0;i<m;i++){
    var a = srt[i];                       // 排序后：a 在后、b 在前
    for (var j=i+1;j<m;j++){
      var b = srt[j];
      var ads = b.s - a.s;
      if (ads >= 230) break;              // 后面只会更远
      var dl = a.lateral - b.lateral;
      var adl = dl < 0 ? -dl : dl;
      if (ads > 20 && adl < 40){          // 同车道最近的真前车：随机加速收油的依据
        if (ads < a.aheadGap){ a.aheadGap = ads; a.aheadV = b.v; }
      }
      if (ads > 20 && ads < 120){
        // 尾流只在斜后方有效（含一点点"抽头"窗口），正后方是乱流
        if (adl >= 26 && adl < 62) a.draft += 0.09;
        else if (adl < 26) a.draft -= 0.03;
        b.draft -= 0.04;
      }
      if (ads > 20 && ads < 130 && adl < AvatarRace.config.CAR_W && a.v >= b.v * 1.02){
        // 确实在逼近前车 → 持续供一脚力，超车必须干脆，不允许并排磨蹭
        a.passTimer = 0.5; a.passPower = 0.20;
      }
    }
  }
  separateOverlap(cars, dt, false);
  for (var z=0;z<n;z++){
    cars[z].draft = AvatarRace.math.clamp(cars[z].draft, -0.09, 0.13);
    cars[z].follow = 1;
  }
}
// 重叠面积上限：两车横向至少要让到多远（ads = 纵向距离，越小要求越大）
function overlapNeed(ads){
  return AvatarRace.config.CAR_W * (1 - AvatarRace.config.MAX_OVERLAP * AvatarRace.config.CAR_LEN / (AvatarRace.config.CAR_LEN - ads)) + 3;   // 留 3 单位余量
}
var overlapScratch = [];                      // 复用数组，避免每帧分配
// instant=false：逐帧柔性让位（看起来像自然避让）；instant=true：一帧内直接达标（防叠加）
// 返回本帧修正过的对数，0 表示没有违反。按 s 排序后用滑动窗口，只比纵向 78 单位内的邻居。
function separateOverlap(cars, dt, instant){
  var n = cars.length;
  // 没有车辆数上限：车再多也做重叠兜底（密集到物理上排不下时只是尽力而为）
  var idx = overlapScratch;
  idx.length = 0;
  for (var q=0;q<n;q++){ var cq = cars[q]; if (!cq.broken && !cq.gone) idx.push(cq); }
  idx.sort(function(x,y){ return x.s - y.s; });
  var fixed = 0, m = idx.length;
  for (var i=0;i<m;i++){
    var a = idx[i];
    for (var j=i+1;j<m;j++){
      var b = idx[j];
      var ads = b.s - a.s;
      if (ads >= AvatarRace.config.CAR_LEN) break;
      var need = overlapNeed(ads);
      var dl = a.lateral - b.lateral, adl = dl < 0 ? -dl : dl;
      if (adl >= need) continue;
      var dir = dl >= 0 ? 1 : -1;
      if (adl < 0.01) dir = (i % 2 === 0) ? 1 : -1;
      if (instant){
        var half = (need - adl) / 2;
        a.lateral = AvatarRace.math.clamp(a.lateral + dir * half, -AvatarRace.config.LANE_MAX, AvatarRace.config.LANE_MAX);
        b.lateral = AvatarRace.math.clamp(b.lateral - dir * half, -AvatarRace.config.LANE_MAX, AvatarRace.config.LANE_MAX);
      } else {
        var move = Math.min(need - adl, AvatarRace.config.CAR_W) * AvatarRace.math.clamp(dt * 7, 0, 1);
        a.lateral = AvatarRace.math.clamp(a.lateral + dir * move, -AvatarRace.config.LANE_MAX, AvatarRace.config.LANE_MAX);
        b.lateral = AvatarRace.math.clamp(b.lateral - dir * move, -AvatarRace.config.LANE_MAX, AvatarRace.config.LANE_MAX);
        // 正在穿过的那台（后车）加一脚，快速通过而不是并排磨蹭
        if (b.v >= a.v * 0.98){ b.passTimer = 0.9; b.passPower = 0.20; }
      }
      fixed++;
    }
  }
  return fixed;
}
function updateCamera(dt){
  var racing = (race.phase === 'racing' || race.phase === 'countdown' || race.phase === 'setup');
  var targetS, targetFocus;
  if (racing){
    var lead = race.ranked && race.ranked[0];
    targetS = lead ? lead.s : 0;
    targetFocus = 0.62;
  } else {
    targetS = race.track.raceLen - 40;
    targetFocus = 0.56;
  }
  var lam = race.phase === 'racing' ? 4.2 : 3.0;
  race.cam.s = AvatarRace.math.damp(race.cam.s, targetS, lam, dt);
  var sp = sampleAt(race.track, race.cam.s);
  race.cam.x = sp.x; race.cam.y = sp.y;
  var ahead = sampleAt(race.track, race.cam.s + 330);
  var lookAng = Math.atan2(ahead.y - sp.y, ahead.x - sp.x);
  race.cam.ang = AvatarRace.math.dampAngle(race.cam.ang, lookAng, race.phase === 'racing' ? 3.5 : 3.0, dt);
  race.focusY = AvatarRace.math.damp(race.focusY, targetFocus, 3.0, dt);
}
function updateRace(dt){
  AvatarRace.physics.step(race, dt);
  if (race.phase === 'ending'){
    race.endingElapsed = (race.endingElapsed || 0) + dt;
    var anyVisible = false;
    for (var i = 0; i < race.cars.length; i++) {
      if (!race.cars[i].gone && Math.abs(race.cars[i].s - race.cam.s) < 1200) { anyVisible = true; break; }
    }
    if (!anyVisible || race.endingElapsed >= 12) showResults();
  }
}
function endRace(){
  race.ranked = rankCars(race.cars);
  race.results = race.ranked.map(function(c){
    return { name: displayName(c.p), avatar: c.p.avatarDataUrl || c.p.avatarDiscUrl || '', finished: c.finished,
             finishTime: c.finishTime, progress: c.progress, stoppedAt: race.elapsed };
  });
  race.phase = 'ending';
  race.endingElapsed = 0;
}
function carWorld(c){
  var sp = sampleAt(race.track, c.s);
  return { x: sp.x + sp.nx*c.lateral, y: sp.y + sp.ny*c.lateral, ang: sp.ang + c.yaw };
}

/* ------------------------------------------------------------------ *
 * 渲染
 * ------------------------------------------------------------------ */

function worldToScreen(x,y){
  return { x: camMat.a*x + camMat.c*y + camMat.e, y: camMat.b*x + camMat.d*y + camMat.f };
}
function strokePts(g, pts, i0, i1, off, width, color, dash){
  if (i1 <= i0) return;
  g.beginPath();
  for (var i=i0;i<=i1;i++){
    var p = pts[i];
    var x = off ? p.x + p.nx*off : p.x;
    var y = off ? p.y + p.ny*off : p.y;
    if (i === i0) g.moveTo(x,y); else g.lineTo(x,y);
  }
  g.lineWidth = width;
  g.strokeStyle = color;
  if (dash) g.setLineDash(dash); else g.setLineDash([]);
  g.stroke();
  if (dash) g.setLineDash([]);
}
// 路缘条纹按世界弧长 k*seg 定位（setLineDash 的相位会随可见段起点变化，导致条纹跟着镜头爬）
function kerbSegments(g, track, sMin, sMax, off, width, color, parity, seg){
  var inner = off - width/2, outer = off + width/2;
  var k0 = Math.ceil(sMin/seg), k1 = Math.floor(sMax/seg);
  g.fillStyle = color;
  for (var k=k0;k<=k1;k++){
    if ((((k % 2) + 2) % 2) !== parity) continue;
    var sA = k*seg, sM = sA + seg/2, sB = sA + seg;
    var pa = sampleAt(track, sA), pm = sampleAt(track, sM), pb = sampleAt(track, sB);
    g.beginPath();
    g.moveTo(pa.x + pa.nx*inner, pa.y + pa.ny*inner);
    g.lineTo(pm.x + pm.nx*inner, pm.y + pm.ny*inner);
    g.lineTo(pb.x + pb.nx*inner, pb.y + pb.ny*inner);
    g.lineTo(pb.x + pb.nx*outer, pb.y + pb.ny*outer);
    g.lineTo(pm.x + pm.nx*outer, pm.y + pm.ny*outer);
    g.lineTo(pa.x + pa.nx*outer, pa.y + pa.ny*outer);
    g.closePath();
    g.fill();
  }
}
function drawGround(g, cam, halfDiag){
  var step = 150;
  var x0 = Math.floor((cam.x - halfDiag)/step)*step;
  var x1 = cam.x + halfDiag;
  var y0 = Math.floor((cam.y - halfDiag)/step)*step;
  var y1 = cam.y + halfDiag;
  g.fillStyle = 'rgba(122,134,148,0.20)';
  for (var y=y0;y<=y1;y+=step){
    for (var x=x0;x<=x1;x+=step){
      g.fillRect(x-3, y-3, 6, 6);
    }
  }
}
function drawCheckerLine(g, track, s, rows, cols, depth){
  var p = sampleAt(track, s);
  var tx = Math.cos(p.ang), ty = Math.sin(p.ang);
  var cell = (2*AvatarRace.config.HALF_W)/cols;
  for (var r=0;r<rows;r++){
    for (var c=0;c<cols;c++){
      var u = -AvatarRace.config.HALF_W + (c+0.5)*cell;
      var v = (r - rows/2 + 0.5) * (depth/rows);
      var cx = p.x + p.nx*u + tx*v;
      var cy = p.y + p.ny*u + ty*v;
      g.fillStyle = ((r+c) % 2 === 0) ? '#23272e' : '#ffffff';
      g.save();
      g.translate(cx,cy);
      g.rotate(p.ang);
      g.fillRect(-cell/2, -(depth/(2*rows)), cell, depth/rows);
      g.restore();
    }
  }
}
function carBodyPath(g){
  AvatarRace.math.rrect(g, -19, -41, 38, 78, 9);
}
function drawWheel(g,x,y){
  AvatarRace.math.rrect(g, x-4.6, y-5.6, 9.2, 11.2, 2.6);
  g.fill();
  g.stroke();
}
function drawCarShape(g, detailed){
  var body = '#ffffff';
  var line = '#c2c9d2';
  g.lineJoin = 'round';
  if (!detailed){
    g.fillStyle = body; g.strokeStyle = line; g.lineWidth = 2;
    carBodyPath(g); g.fill(); g.stroke();
    g.beginPath(); g.arc(0, 1, 12, 0, AvatarRace.config.TAU);
    g.fillStyle = '#f7f9fb'; g.fill(); g.stroke();
    return;
  }
  g.fillStyle = '#e8ecf0'; g.strokeStyle = '#b4bcc6'; g.lineWidth = 1.4;
  drawWheel(g,-18.5,-13);
  drawWheel(g, 18.5,-13);
  drawWheel(g,-18, 17);
  drawWheel(g, 18, 17);
  g.fillStyle = body; g.strokeStyle = line; g.lineWidth = 1.8;
  AvatarRace.math.rrect(g,-9,-31,18,58,5); g.fill(); g.stroke();
  AvatarRace.math.rrect(g,-17.5,-16,10.5,26,4.5); g.fill(); g.stroke();
  AvatarRace.math.rrect(g, 7,-16,10.5,26,4.5); g.fill(); g.stroke();
  g.beginPath();
  g.moveTo(-7.5,10); g.lineTo(-4.2,31); g.lineTo(4.2,31); g.lineTo(7.5,10);
  g.closePath(); g.fill(); g.stroke();
  AvatarRace.math.rrect(g,-18.5,26,37,8.5,3); g.fill(); g.stroke();
  AvatarRace.math.rrect(g,-20,25,4,11,1.6); g.fill(); g.stroke();
  AvatarRace.math.rrect(g, 16,25,4,11,1.6); g.fill(); g.stroke();
  AvatarRace.math.rrect(g,-17,-41,34,8,2.5); g.fill(); g.stroke();
  AvatarRace.math.rrect(g,-19,-42,4,11,1.6); g.fill(); g.stroke();
  AvatarRace.math.rrect(g, 15,-42,4,11,1.6); g.fill(); g.stroke();
  AvatarRace.math.rrect(g,-2.6,-33,5.2,9,1); g.fill(); g.stroke();
  g.beginPath(); g.arc(0,1,13.2,0,AvatarRace.config.TAU);
  g.fillStyle = '#f7f9fb'; g.fill(); g.stroke();
}
// 车身与阴影预渲染成贴图：每帧每车只做一次 drawImage，因此可以完全不简化渲染
var carSprite = null, carShadowSprite = null;
function buildCarSprites(){
  var x0 = -25, x1 = 25, y0 = -46, y1 = 39, S = 3.5;
  function mk(draw){
    var c = document.createElement('canvas');
    c.width = Math.round((x1-x0)*S);
    c.height = Math.round((y1-y0)*S);
    var g = c.getContext('2d');
    g.setTransform(S, 0, 0, S, -x0*S, -y0*S);
    g.lineJoin = 'round'; g.lineCap = 'round';
    draw(g);
    return { canvas: c, x: x0, y: y0, w: x1-x0, h: y1-y0 };
  }
  carSprite = mk(function(g){ drawCarShape(g, true); });
  carShadowSprite = mk(function(g){
    g.fillStyle = 'rgba(18,26,38,0.16)';
    carBodyPath(g); g.fill();
  });
}
function drawAvatar(g, x, y, r, p){
  if (!p.avatarDisc || r < 3) return;
  try { g.drawImage(p.avatarDisc, x-r, y-r, r*2, r*2); }
  catch (e) { /* 单张头像异常不影响整帧 */ }
}
var LABEL_FONT = '600 10px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';   // 名字字号（原 12px）
var LABEL_PAD_X = 12;      // 文字两侧留白（原 16）
var LABEL_H = 18;          // 胶囊高度（原 22）
function labelWidth(g, text){
  g.font = LABEL_FONT;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  return g.measureText(text).width + LABEL_PAD_X;
}
function drawLabel(g, x, y, w, text){
  g.fillStyle = 'rgba(26,33,44,0.5)';        // 更透明：名字重叠时也能看见下面那层
  AvatarRace.math.rrect(g, x-w/2, y - LABEL_H/2, w, LABEL_H, LABEL_H/2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.fillText(text, x, y+0.5);
}

function render(dt){
  var W = viewW, H = viewH;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.fillStyle = '#e9edf1';
  ctx.fillRect(0,0,W,H);
  if (race.phase === 'setup' || !race.track) return;
  var scale = Math.min(H/AvatarRace.config.VIEW_H, W/AvatarRace.config.MIN_VIEW_W);
  if (!(scale > 0)) return;
  var cam = race.cam;
  var alpha = cam.ang - Math.PI/2;
  var ca = Math.cos(alpha), sa = Math.sin(alpha);
  var ma = scale*ca, mb = scale*sa, mc = scale*sa, md = -scale*ca;
  var me = W/2 - scale*(ca*cam.x + sa*cam.y);
  var mf = H*race.focusY - scale*(sa*cam.x - ca*cam.y);
  camMat.a = ma; camMat.b = mb; camMat.c = mc; camMat.d = md;
  camMat.e = me; camMat.f = mf; camMat.scale = scale;
  ctx.setTransform(dpr*ma, dpr*mb, dpr*mc, dpr*md, dpr*me, dpr*mf);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  var halfDiag = Math.sqrt(W*W + H*H) / (2*scale);
  var pts = race.track.pts;
  var i0 = indexAtS(race.track, cam.s - halfDiag - 160);
  var i1 = indexAtS(race.track, cam.s + halfDiag + 160);

  drawGround(ctx, cam, halfDiag);

  strokePts(ctx, pts, i0, i1, 0, 2*AvatarRace.config.HALF_W, '#8d9298');
  strokePts(ctx, pts, i0, i1, AvatarRace.config.HALF_W-5, 5, 'rgba(255,255,255,0.5)');
  strokePts(ctx, pts, i0, i1, -(AvatarRace.config.HALF_W-5), 5, 'rgba(255,255,255,0.5)');
  strokePts(ctx, pts, i0, i1, AvatarRace.config.HALF_W+9, 18, '#d24a4a');
  strokePts(ctx, pts, i0, i1, -(AvatarRace.config.HALF_W+9), 18, '#d24a4a');
  var kerbLo = cam.s - halfDiag - 60, kerbHi = cam.s + halfDiag + 60;
  kerbSegments(ctx, race.track, kerbLo, kerbHi, AvatarRace.config.HALF_W+9, 18, '#f3f5f8', 0, 34);
  kerbSegments(ctx, race.track, kerbLo, kerbHi, -(AvatarRace.config.HALF_W+9), 18, '#f3f5f8', 0, 34);

  var visLo = cam.s - halfDiag - 120, visHi = cam.s + halfDiag + 120;
  if (0 > visLo && 0 < visHi) drawCheckerLine(ctx, race.track, 0, 2, 16, 46);
  if (race.track.raceLen > visLo && race.track.raceLen < visHi) drawCheckerLine(ctx, race.track, race.track.raceLen, 2, 16, 46);

  var list = race.ranked.length ? race.ranked : race.cars;
  var withShadow = list.length <= 60;    // 车特别多时省掉投影填充，但车本身依旧完整绘制
  for (var i=0;i<list.length;i++){
    var c = list[i];
    if (c.broken) continue;
    if (c.s < cam.s - halfDiag - 220 || c.s > cam.s + halfDiag + 220) continue;
    var w = carWorld(c);
    // 局部→屏幕：M * T(w.x,w.y) * R(w.ang - PI/2)，直接合成一个矩阵，省掉 save/restore
    var th = w.ang - Math.PI/2;
    var cth = Math.cos(th), sth = Math.sin(th);
    try {
      ctx.setTransform(
        dpr*(ma*cth + mc*sth), dpr*(mb*cth + md*sth),
        dpr*(-ma*sth + mc*cth), dpr*(-mb*sth + md*cth),
        dpr*(ma*w.x + mc*w.y + me), dpr*(mb*w.x + md*w.y + mf)
      );
      if (withShadow && carShadowSprite) ctx.drawImage(carShadowSprite.canvas, carShadowSprite.x + 6, carShadowSprite.y - 6, carShadowSprite.w, carShadowSprite.h);
      if (carSprite) ctx.drawImage(carSprite.canvas, carSprite.x, carSprite.y, carSprite.w, carSprite.h);
    } catch (e) { c.broken = true; }
  }

  // 屏幕空间：头像与姓名标签（避免镜像/旋转影响文字）
  ctx.setTransform(dpr,0,0,dpr,0,0);
  var labels = [];
  var ccx = W/2, ccy = H*race.focusY;
  ctx.font = LABEL_FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  var finCount = 0;                        // 已冲线的车不再显示名字，名字窗口顺延给还在跑的车
  for (var fm=0; fm<list.length; fm++) if (list[fm].finished) finCount++;
  for (var m=0;m<list.length;m++){
    var car = list[m];
    if (car.broken) continue;
    var wpos = carWorld(car);
    var sp2 = worldToScreen(wpos.x, wpos.y);
    if (sp2.x < -80 || sp2.x > W+80 || sp2.y < -80 || sp2.y > H+80){
      car.labelAlpha = AvatarRace.math.damp(car.labelAlpha || 0, 0, 15, dt);   // 只有驶出画面才淡出（同样快速）
      continue;
    }
    var r = 11 * scale;
    var dx = sp2.x - ccx, dy = sp2.y - ccy;
    var distC = Math.sqrt(dx*dx + dy*dy);
    var cockpit = worldToScreen(wpos.x + Math.cos(wpos.ang)*1.5, wpos.y + Math.sin(wpos.ang)*1.5);
    drawAvatar(ctx, cockpit.x, cockpit.y, r, car.p);
    // 只要在画面内就一直显示名字：不再按「离镜头中心的距离」筛选，也没有 6 个的上限
    // 名字窗口 = 「还没冲线」的车里最靠前的 30 台：过了终点线就让位，位置顺延给后面还在跑的车
    // （整体名次 - 已冲线台数 = 在跑车里的名次；31/32 名迟滞保留，避免边界抖动闪烁）
    var rkAlive = car.finished ? 1e9 : ((car.rank || 1) - finCount);
    if (rkAlive <= 30) car.labelOn = true;
    else if (rkAlive > 32) car.labelOn = false;
    car.labelAlpha = AvatarRace.math.damp(car.labelAlpha || 0, car.labelOn ? 1 : 0, 15, dt);   // 快速显示：约 0.15 秒，只为避免硬切
    if (car.labelAlpha > 0.01){
      labels.push({ p: car.p, x: sp2.x, y: sp2.y - (r + 12), text: displayName(car.p), alpha: car.labelAlpha });
    }
  }
  // 名字只跟着自己的车走，不做任何让位/避让：位置 = 车头正上方，只保留「不出画面」的边界收拢。
  // 顺序固定按 id，纯粹为了让重叠时的覆盖顺序稳定（后画的压在上面）。
  labels.sort(function(a,b){ return a.p.id - b.p.id; });
  race.labelNames = [];
  for (var L=0;L<labels.length;L++){
    var it = labels[L];
    var txt = it.text;
    var p0 = it.p;
    if (p0.labelW === undefined || p0.labelWName !== txt){ p0.labelW = labelWidth(ctx, txt); p0.labelWName = txt; }
    var lw = p0.labelW;
    var cx = Math.min(Math.max(it.x, lw/2 + 4), W - lw/2 - 4);
    var ly = Math.min(Math.max(it.y, 22), H - 22);
    race.labelNames.push(txt);
    ctx.globalAlpha = it.alpha;
    drawLabel(ctx, cx, ly, lw, txt);
    ctx.globalAlpha = 1;
  }
}

/* ------------------------------------------------------------------ *
 * HUD / 结果页
 * ------------------------------------------------------------------ */

var hudCache = { s:'', sub:'' };
function setText(el, key, val){
  if (hudCache[key] !== val){ hudCache[key] = val; el.textContent = val; }
}
var hudTimer = 0;
function updateHud(dt){
  hudTimer += dt;
  if (hudTimer < 0.1 && race.phase !== 'results') return;
  hudTimer = 0;
  var lead = race.ranked && race.ranked[0];
  var fin = 0;
  for (var i=0;i<race.cars.length;i++) if (race.cars[i].finished) fin++;
  var st = 'Ready', sub = '';
  if (race.phase === 'countdown'){ st = 'Get ready'; sub = 'Engines starting'; }
  else if (race.phase === 'racing'){ st = 'Racing'; sub = (lead ? ('Leader: ' + displayName(lead.p)) : 'Racing') + ' · elapsed ' + AvatarRace.math.fmtTime(race.elapsed); }
  else if (race.phase === 'waiting'){ st = 'Waiting for the rest'; sub = 'Finished ' + fin + '/' + race.cars.length + ' · ' + Math.max(0, 5 - race.waitingElapsed).toFixed(1) + 's left'; }
  else if (race.phase === 'ending'){ st = 'Race over'; sub = 'Cars leaving the track · finished ' + fin + '/' + race.cars.length; }
  else if (race.phase === 'results'){
    var win = race.results && race.results.length ? race.results[0].name : '';
    st = 'Race over'; sub = (win ? ('Winner: ' + win + ' · ') : '') + 'full standings available';
  }
  setText(hudStatus, 's', st);
  setText(hudSub, 'sub', sub);
  var showRank = (race.phase === 'ending');
  if (rankBtnEl.hidden !== !showRank) rankBtnEl.hidden = !showRank;
}
function updateHint(){
  race.lowQ = false;      // 「参赛者较多…」提示已按需求删除，这里只保留低画质标记复位
}
function showCountdownText(v){
  var txt;
  if (v > 2.9) txt = '3';
  else if (v > 1.9) txt = '2';
  else if (v > 0.9) txt = '1';
  else txt = 'GO';
  if (countdownText.textContent !== txt) countdownText.textContent = txt;
}
function showResults(){
  var list = race.results || [];
  boardEl.innerHTML = '';
  for (var i=0;i<list.length;i++){
    if (i === 5){
      var sep = document.createElement('div');
      sep.className = 'board-sep';
      sep.textContent = '6th place and below (scroll down)';
      boardEl.appendChild(sep);
    }
    var c = list[i];
    var row = document.createElement('div');
    var isLast = (i === list.length - 1 && list.length > 5);      // 倒一名那一行吸底，不滚动也能看到
    row.className = 'row' + (i===0?' top1':(i===1?' top2':(i===2?' top3':''))) + (i>4?' minor':'') + (isLast ? ' sticky-last' : '');
    var rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = String(i+1);
    var img = document.createElement('img'); img.alt = ''; img.referrerPolicy = 'no-referrer'; img.src = c.avatar || '';
    var nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = c.name;
    var stt = document.createElement('span'); stt.className = 'st';
    // 完赛=冲线时刻；没冲线的显示「—」。绝不再把 race.elapsed（成绩冻结时刻）
    // 当成成绩显示 —— 那是所有未完赛者共享的同一个数，一整列全是它，没有信息量。
    stt.textContent = (isLast ? 'LAST · ' : '') + (c.finished ? AvatarRace.math.fmtTime(c.finishTime) : '—');
    row.appendChild(rank); row.appendChild(img); row.appendChild(nm); row.appendChild(stt);
    boardEl.appendChild(row);
  }
  boardEl.scrollTop = 0;
  resultNote.textContent = list.length > 5
    ? ('Top 5 shown — scroll for all ' + list.length + ' participants')
    : (list.length + ' participants');
  resultEl.hidden = false;
  race.phase = 'results';
}
function toast(msg){
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ toastEl.hidden = true; }, 2600);
}

/* ------------------------------------------------------------------ *
 * 启动 / 主循环
 * ------------------------------------------------------------------ */

function resize(){
  var r = raceView.getBoundingClientRect();
  viewW = Math.max(1, Math.round(r.width));
  viewH = Math.max(1, Math.round(r.height));
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(viewW*dpr);
  canvas.height = Math.round(viewH*dpr);
  canvas.style.width = viewW + 'px';
  canvas.style.height = viewH + 'px';
}
function startRace(){
  if (participants.length < 2){
    toast('至少需要 2 位参赛者才能开始比赛');
    return;
  }
  applyDefaultNames();
  race.seed = (Math.random()*4294967295) >>> 0;
  race.track = AvatarRace.track.buildTrack(race.seed, AvatarRace.track.gridPlan(participants.length).depth);
  race.elapsed = 0; race.waitingElapsed = 0; race.endingElapsed = 0; race.leaderFinishAt = 0;
  race.nextPassCheck = 0;
  race.results = [];
  race.focusY = 0.62;
  race.rng = AvatarRace.math.mulberry32((race.seed ^ 0x9e3779b9) >>> 0);
  race.riggedId = participantStore.riggedId;
  race.participants = participants;
  race.cars = AvatarRace.physics.createCars(race.track, participants, race.rng, participantStore.gridOrder, participantStore.riggedId);
  race.ranked = rankCars(race.cars);
  for (var r=0;r<race.ranked.length;r++) race.ranked[r].rank = r + 1;
  computeRival(race.cars);
  race.phase = 'countdown';
  race.countdown = 3.9;
  var startS = race.cars.length ? race.cars[0].s : 0;
  var sp = sampleAt(race.track, startS);
  race.cam = { s: startS, x: sp.x, y: sp.y, ang: sp.ang };
  raceView.hidden = false;
  setupView.hidden = true;
  resultEl.hidden = true;
  countdownEl.hidden = false;
  countdownText.textContent = '3';
  hudCache.s = ''; hudCache.sub = ''; hudTimer = 1;
  updateHint();
  resize();
  updateHud(0);
}
function backToSetup(){
  race.phase = 'setup';
  race.cars = [];
  race.ranked = [];
  race.results = [];
  resultEl.hidden = true;
  raceView.hidden = true;
  setupView.hidden = false;
}
var last = 0;
function frame(now){
  requestAnimationFrame(frame);
  var dt = (now - last) / 1000;
  last = now;
  if (!isFinite(dt) || dt < 0) dt = 0;
  dt = Math.min(dt, 1/30);
  if (dt > 0){
    fpsAcc += dt; fpsFrames++;
    if (fpsAcc > 1.2){
      var fps = fpsFrames / fpsAcc;
      lowQuality = (fps < 42) || participants.length > 24;
      fpsAcc = 0; fpsFrames = 0;
    }
  }
  try {
    if (race.phase === 'countdown'){
      race.countdown -= dt;
      if (race.countdown <= 0){
        race.phase = 'racing';
        race.elapsed = 0;
        countdownEl.hidden = true;
      } else {
        showCountdownText(race.countdown);
      }
      updateCamera(dt);
    } else if (race.phase === 'racing' || race.phase === 'waiting' || race.phase === 'ending' || race.phase === 'results'){
      updateRace(dt);
      updateCamera(dt);
    }
    updateHud(dt);
  } catch (e) { /* 单帧异常不影响后续动画 */ }
  try { render(dt); } catch (e2) { /* 渲染异常不白屏 */ }
}

AvatarRace.setup.mount({
  state: { participants: participantStore },
  elements: {
    list: listEl,
    empty: emptyEl,
    searchBar: searchBarEl,
    searchInput: searchInputEl,
    searchClear: searchClearEl,
    searchCount: searchCountEl,
    countBadge: countBadge,
    diag: diagEl,
    addButton: document.getElementById('addBtn'),
    rosterButton: document.getElementById('rosterBtn'),
    csvButton: document.getElementById('csvBtn'),
    csvInput: document.getElementById('csvInput'),
    sampleButton: document.getElementById('sampleBtn'),
    clearButton: document.getElementById('clearBtn'),
    shuffleButton: document.getElementById('shuffleBtn'),
    startButton: document.getElementById('startBtn')
  },
  onStart: startRace,
  onToast: toast
});
// 返回设置：改成按 Esc（不再放按钮，也不加图标）
document.addEventListener('keydown', function(e){
  if ((e.key === 'Escape' || e.key === 'Esc') && race.phase !== 'setup') backToSetup();
});
document.getElementById('toSetupBtn').addEventListener('click', backToSetup);
document.getElementById('againBtn').addEventListener('click', function(){ startRace(); });
rankBtnEl.addEventListener('click', function(){ if (race.phase === 'ending') showResults(); });
window.addEventListener('resize', function(){ resize(); });
window.addEventListener('orientationchange', function(){ setTimeout(resize, 200); });

AvatarRace.debug.install({
  state: { race: race, participants: participantStore },
  testMode: /(?:^|[?&])test=1(?:&|$)/.test(window.location.search || '')
});

buildCarSprites();
resize();
requestAnimationFrame(function(t){ last = t; requestAnimationFrame(frame); });
})();
