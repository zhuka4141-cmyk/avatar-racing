(function (global) {
  'use strict';
  var AvatarRace = global.AvatarRace = global.AvatarRace || {};
  var config = AvatarRace.config;
  var math = AvatarRace.math;

  function gridPlan(n) {
    var cols = Math.max(1, Math.min(Math.max(1, n), config.LANES));
    var rows = Math.max(1, Math.ceil(Math.max(1, n) / cols));
    var spacing = 100;
    return { cols: cols, rows: rows, spacing: spacing, depth: 70 + (rows - 1) * spacing + 140 };
  }

  function finishTrack(base, backRunoff, seed, minR, turns) {
    var BACK_RUNOFF = Math.max(600, backRunoff || 600);
    var N = base.length;
    var p0 = base[0], p1 = base[Math.min(6, N - 1)];
    var t0x = p1.x - p0.x, t0y = p1.y - p0.y;
    var t0l = Math.max(1e-6, Math.sqrt(t0x * t0x + t0y * t0y));
    t0x /= t0l; t0y /= t0l;
    var back = [];
    for (var d = BACK_RUNOFF; d > 0; d -= 10) back.push({ x: p0.x - t0x * d, y: p0.y - t0y * d });
    var line = back.concat(base);
    var startIdx = back.length;
    var pe = base[N - 1], pe0 = base[N - 3];
    var tex = pe.x - pe0.x, tey = pe.y - pe0.y;
    var tel = Math.max(1e-6, Math.sqrt(tex * tex + tey * tey));
    tex /= tel; tey /= tel;
    for (var d2 = 10; d2 <= config.FWD_RUNOFF; d2 += 10) line.push({ x: pe.x + tex * d2, y: pe.y + tey * d2 });

    var cum = new Array(line.length);
    cum[startIdx] = 0;
    for (var m = startIdx + 1; m < line.length; m++) cum[m] = cum[m - 1] + math.dist(line[m - 1], line[m]);
    for (var n2 = startIdx - 1; n2 >= 0; n2--) cum[n2] = cum[n2 + 1] - math.dist(line[n2], line[n2 + 1]);

    var out = [], prevAng = null;
    for (var t2 = 0; t2 < line.length; t2++) {
      var aa = line[Math.max(0, t2 - 1)], bb = line[Math.min(line.length - 1, t2 + 1)];
      var ang = Math.atan2(bb.y - aa.y, bb.x - aa.x);
      if (prevAng !== null) {
        while (ang - prevAng > Math.PI) ang -= config.TAU;
        while (ang - prevAng < -Math.PI) ang += config.TAU;
      }
      prevAng = ang;
      out.push({ x: line[t2].x, y: line[t2].y, s: cum[t2], ang: ang, nx: -Math.sin(ang), ny: Math.cos(ang) });
    }
    return { pts: out, raceLen: cum[startIdx + N - 1], seed: seed, minR: minR, turns: turns };
  }

  function buildTrack(seed, backRunoff) {
    var L = config.RACE_DIST, step = 6;
    for (var attempt = 0; attempt < 6; attempt++) {
      var rnd = math.mulberry32((seed + attempt * 7919) >>> 0);
      var st = { x: 0, y: 0, theta: 0, pts: [] };
      function advance(kf, len) {
        var n = Math.max(1, Math.round(len / step)), dl = len / n;
        for (var i = 0; i < n; i++) {
          st.pts.push({ x: st.x, y: st.y });
          st.theta += kf(i * dl, len) * dl;
          st.x += Math.cos(st.theta) * dl;
          st.y += Math.sin(st.theta) * dl;
        }
      }
      function advanceHead(headFn, len, base) {
        var n = Math.max(1, Math.round(len / step)), dl = len / n;
        for (var i = 0; i < n; i++) {
          st.pts.push({ x: st.x, y: st.y });
          st.x += Math.cos(base + headFn(i * dl, len)) * dl;
          st.y += Math.sin(base + headFn(i * dl, len)) * dl;
        }
        st.theta = base;
      }
      st.pts.push({ x: st.x, y: st.y });
      var total = 0, guard = 0, turnCount = 0, isFirst = true;
      while (total < L - 260 && guard++ < 40) {
        var legLen = Math.min(L - total, isFirst ? 1000 : (1150 + rnd() * 750));
        var swingCap = Math.min(config.HALF_W * 0.30, legLen * legLen / (105 * config.HALF_W));
        var swing = isFirst ? 0 : swingCap * (0.55 + rnd() * 0.45), ph = rnd() * config.TAU, base = st.theta;
        (function (sw, p2, bs) {
          advanceHead(function (sl, len) {
            var u = sl / len, s2 = Math.sin(Math.PI * u), c2 = Math.cos(Math.PI * u);
            var env = s2 * s2, dEnv = 2 * Math.PI * s2 * c2;
            var sn = Math.sin(config.TAU * u + p2), cs = Math.cos(config.TAU * u + p2);
            return Math.atan((sw / len) * (dEnv * sn + env * config.TAU * cs));
          }, legLen, bs);
        })(swing, ph, base);
        total += legLen; isFirst = false;
        var pitch = 2 * config.HALF_W + 2 * config.HALF_W * 0.30 + 180 + rnd() * 200;
        var Rh = pitch / 2, turnLen = Math.PI * Rh;
        if (total + turnLen + 700 > L) break;
        var sigma = (turnCount % 2 === 0) ? 1 : -1;
        (function (r2, sg) { advance(function () { return sg / r2; }, Math.PI * r2); })(Rh, sigma);
        total += turnLen; turnCount++;
      }
      if (total < L) { var tail = L - total; advance(function () { return 0; }, tail); total += tail; }
      var basePts = st.pts, N = basePts.length, minR = Infinity;
      for (var j = 1; j < N - 1; j++) {
        var a = basePts[j - 1], b = basePts[j], c = basePts[j + 1];
        var v1x = b.x - a.x, v1y = b.y - a.y, v2x = c.x - b.x, v2y = c.y - b.y;
        var l1 = Math.sqrt(v1x * v1x + v1y * v1y), l2 = Math.sqrt(v2x * v2x + v2y * v2y);
        var turn = Math.abs(Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y));
        var R = turn > 1e-9 ? ((l1 + l2) / 2) / turn : Infinity;
        if (R < minR) minR = R;
      }
      var clash = false, need = 2 * config.HALF_W + 30;
      for (var p = 0; p < N && !clash; p += 3) for (var q = p + 200; q < N; q += 3) {
        var ddx = basePts[p].x - basePts[q].x, ddy = basePts[p].y - basePts[q].y;
        if (ddx * ddx + ddy * ddy < need * need) { clash = true; break; }
      }
      if (minR > config.HALF_W * 1.35 && !clash) return finishTrack(basePts, backRunoff, seed, minR, turnCount);
    }
    var straight = [];
    for (var q3 = 0; q3 < Math.round(L / step) + 1; q3++) straight.push({ x: 0, y: q3 * step });
    return finishTrack(straight, backRunoff, seed, Infinity, 0);
  }

  function sampleAt(track, s) {
    var P = track.pts;
    if (!P || !P.length) return { x: 0, y: 0, ang: -Math.PI / 2, s: 0, nx: 0, ny: 0 };
    var firstP = P[0];
    if (s <= firstP.s) { var d0 = firstP.s - s; return { x: firstP.x - Math.cos(firstP.ang) * d0, y: firstP.y - Math.sin(firstP.ang) * d0, ang: firstP.ang, s: s, nx: firstP.nx, ny: firstP.ny }; }
    var last = P[P.length - 1];
    if (s >= last.s) { var d1 = s - last.s; return { x: last.x + Math.cos(last.ang) * d1, y: last.y + Math.sin(last.ang) * d1, ang: last.ang, s: s, nx: last.nx, ny: last.ny }; }
    var lo = 0, hi = P.length - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (P[mid].s <= s) lo = mid; else hi = mid; }
    var a = P[lo], b = P[hi], t = (s - a.s) / Math.max(1e-6, b.s - a.s);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, ang: a.ang + (b.ang - a.ang) * t, s: s, nx: a.nx, ny: a.ny };
  }

  function indexAtS(track, s) {
    var P = track.pts;
    if (s <= P[0].s) return 0;
    if (s >= P[P.length - 1].s) return P.length - 1;
    var lo = 0, hi = P.length - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (P[mid].s <= s) lo = mid; else hi = mid; }
    return lo;
  }

  AvatarRace.track = { gridPlan: gridPlan, buildTrack: buildTrack, sampleAt: sampleAt, indexAtS: indexAtS };
})(typeof window !== 'undefined' ? window : globalThis);
