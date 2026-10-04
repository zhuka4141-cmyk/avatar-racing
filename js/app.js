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
var gridPlan = trackApi.gridPlan;
var buildTrack = trackApi.buildTrack;
var sampleAt = trackApi.sampleAt;
var indexAtS = trackApi.indexAtS;

var rankCars = AvatarRace.physics.rankCars;
function computeRival(r){ AvatarRace.physics.computeRival(r); }
function carWorld(c){
  var sp = sampleAt(race.track, c.s);
  return { x: sp.x + sp.nx*c.lateral, y: sp.y + sp.ny*c.lateral, ang: sp.ang + c.yaw };
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
  computeRival(race);
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

