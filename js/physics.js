(function (global) {
  'use strict';
  var AvatarRace = global.AvatarRace = global.AvatarRace || {};
  var config = AvatarRace.config, math = AvatarRace.math, trackApi = AvatarRace.track;

  function createRaceState(options) {
    options = options || {};
    return {
      phase: options.phase || 'setup', seed: options.seed == null ? 1 : options.seed,
      track: options.track || null, participants: options.participants || [],
      gridOrder: options.gridOrder || null, riggedId: options.riggedId == null ? null : options.riggedId,
      elapsed: 0, countdown: 0, waitingElapsed: 0, endingElapsed: 0, leaderFinishAt: 0,
      cars: [], ranked: [], results: [], rival: -Infinity, leaderS: 0, nextPassCheck: 0,
      rng: options.rng || math.mulberry32((options.seed == null ? 1 : options.seed) >>> 0)
    };
  }

  function rankCars(cars) {
    return cars.slice().sort(function (a, b) {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1; if (b.finished) return 1;
      if (b.s !== a.s) return b.s - a.s;
      return a.p.id - b.p.id;
    });
  }

  function createCars(track, participants, random, gridOrder, riggedId) {
    if (!track || typeof track.raceLen !== 'number') throw new TypeError('createCars requires a track');
    if (typeof random !== 'function') throw new TypeError('createCars requires an explicit seeded RNG');
    var rnd = random;
    participants = participants || [];
    var baseSpeed = track.raceLen / 21.5;
    var cars = participants.map(function (p) {
      return { p: p, s: 0, v: 0, lateral: 0, yaw: 0, progress: 0, finished: false, finishTime: 0, broken: false,
        baseSpeed: baseSpeed * (1 + (rnd() * 2 - 1) * 0.13), accel: 2.2 * (1 + (rnd() * 2 - 1) * 0.22), startDelay: rnd() * 0.5,
        wobbleSeed: rnd() * config.TAU, paceSeed: rnd() * config.TAU, paceSeed2: rnd() * config.TAU, paceSeed3: rnd() * config.TAU,
        draft: 0, blocked: 0, follow: 1, gone: false, clear: true, rank: 1, lastRank: 1, catchup: 1,
        boostTimer: 0, boostCooldown: 1 + rnd() * 4, boostPower: 0, settleTimer: 0, aheadGap: Infinity, aheadV: 0,
        passTimer: 0, passPower: 0.14, finishBias: (rnd() * 2 - 1) * 0.015, lane: 0, baseLane: 0, passUntil: 0, laneCooldown: 2 + rnd() * 5 };
    });
    var n = cars.length, grid = trackApi.gridPlan(n), order = [];
    for (var g = 0; g < n; g++) order.push(gridOrder && gridOrder.length === n ? gridOrder[g] : g);
    var rig = null;
    if (riggedId != null) for (var q = 0; q < n; q++) if (cars[q].p && cars[q].p.id === riggedId) { rig = cars[q]; break; }
    if (rig) {
      var ri = cars.indexOf(rig), want = math.clamp(Math.floor(rnd() * grid.cols), 0, grid.cols - 1), cur = order[ri], holder = -1;
      for (var z = 0; z < n; z++) if (order[z] === want) { holder = z; break; }
      order[ri] = want; if (holder >= 0 && holder !== ri) order[holder] = cur;
    }
    for (var i = 0; i < n; i++) {
      var gi = order[i], col = gi % grid.cols;
      cars[i].lateral = (col - (grid.cols - 1) / 2) * config.LANE_STEP;
      cars[i].s = -70 - Math.floor(gi / grid.cols) * grid.spacing;
      cars[i].lane = cars[i].baseLane = cars[i].lateral;
    }
    if (rig) {
      rig.rigged = true; var bestBase = 0;
      for (var b = 0; b < n; b++) if (cars[b].baseSpeed > bestBase) bestBase = cars[b].baseSpeed;
      rig.baseSpeed = bestBase * (1 + config.RIG.baseEdge); rig.startDelay = Math.min(rig.startDelay, 0.12);
      rig.accel = Math.max(rig.accel, 2.6); rig.finishBias = 0.015;
    }
    return cars;
  }

  function rigFactor(race, c, raceLen) {
    if (!c.rigged || !isFinite(race.rival)) return 1;
    var f = 1, margin = c.s - race.rival;
    var endT = 1 - math.clamp((raceLen - c.s) / config.RIG.endSpan, 0, 1);
    if (endT > 0) {
      var err = config.RIG.endTarget - margin;
      if (err > 0) f += math.clamp(err / config.RIG.servoHalf, 0, 1) * config.RIG.servoChase * endT;
      else f -= math.clamp(-err / config.RIG.servoHalf, 0, 1) * config.RIG.servoHold * endT;
    }
    var lockT = 1 - math.clamp((raceLen - c.s) / config.RIG.lockSpan, 0, 1);
    if (lockT > 0 && margin < config.RIG.lockLead) f += lockT * config.RIG.lockBoost * math.clamp((config.RIG.lockLead - margin) / config.RIG.lockLead, 0, 1);
    return f;
  }

  function updateCar(race, c, dt, t, raceLen) {
    if (c.gone) return;
    if (!race || typeof race.rng !== 'function') throw new TypeError('updateCar requires race.rng');
    var targetV = 0, rnd = race.rng;
    if (c.finished) {
      // Clear the finish before slowing down, so the arriving pack has room.
      var exitSpeed = c.exitSpeed || Math.max(c.v, c.baseSpeed);
      var slowdown = math.clamp((c.s - raceLen - 600) / 600, 0, 1);
      targetV = math.lerp(exitSpeed, c.baseSpeed * 0.55, slowdown);
    }
    else if (t >= c.startDelay) {
      var pace = 1 + 0.12 * Math.sin(t * 0.37 + c.paceSeed) + 0.07 * Math.sin(t * 0.93 + c.paceSeed2) + 0.05 * Math.sin(t * 0.21 + c.paceSeed3);
      if (c.rigged && config.RIG.paceDamp > 0) pace = 1 + (pace - 1) * (1 - config.RIG.paceDamp * math.clamp(c.s / raceLen, 0, 1));
      var rank = c.rank || 1, gap = Math.max(0, (Number.isFinite(race.leaderS) ? race.leaderS : c.s) - c.s);
      var gapBoost = math.clamp(gap / 900, 0, 1) * 0.45;
      if (rank < c.lastRank) c.settleTimer = 1.2; c.lastRank = rank;
      var boost = 0;
      if (rank > 5) {
        if (c.boostTimer > 0) c.boostTimer -= dt; c.boostCooldown -= dt;
        if (c.boostTimer <= 0 && c.boostCooldown <= 0) {
          if (rnd() < 0.7) { c.boostTimer = 1 + rnd() * 2.6; c.boostPower = 0.05 + rnd() * 0.09; }
          c.boostCooldown = 1.2 + rnd() * 3.6;
        }
        boost = c.boostTimer > 0 ? c.boostPower : 0;
        if (c.aheadGap < 90) boost *= math.clamp(c.aheadGap / 90, 0, 1);
      } else { c.boostTimer = 0; c.boostPower = 0; }
      if (c.settleTimer > 0) { c.settleTimer -= dt; boost *= math.clamp(c.settleTimer / 1.2, 0, 1); }
      var catchup = math.clamp(1 + gapBoost + boost, 0.85, 1.9);
      var finishRamp = math.clamp((c.s - (raceLen - 1800)) / 1800, 0, 1);
      if (finishRamp > 0) catchup = math.lerp(catchup, 1 + c.finishBias, finishRamp);
      c.catchup = math.damp(c.catchup, catchup, 3, dt);
      if (c.passTimer > 0) c.passTimer -= dt;
      var passBoost = c.passTimer > 0 ? c.passPower : 0;
      targetV = c.baseSpeed * pace * (1 + c.draft) * c.follow * (1 - 0.22 * c.blocked) * c.catchup * (1 + passBoost) * rigFactor(race, c, raceLen);
    }
    if (targetV > 0) c.v += (targetV - c.v) * (1 - Math.exp(-c.accel * dt)); else c.v = 0;
    c.s += c.v * dt;
    if (!c.finished && c.s >= raceLen) { c.finished = true; c.exitSpeed = Math.max(c.v, c.baseSpeed); var travelled = c.v * dt, frac = travelled > 1e-6 ? math.clamp((c.s - raceLen) / travelled, 0, 1) : 0; c.finishTime = t - dt * frac; }
    if (c.s > raceLen + 2800) c.gone = true;
    if (t >= c.passUntil) c.lane = math.damp(c.lane, c.baseLane, 0.18, dt);
    var wob = 7 * Math.sin(t * 0.62 + c.wobbleSeed * 2.1), target = math.clamp(c.lane + wob, -config.LANE_MAX, config.LANE_MAX);
    var dx = target - c.lateral, stepX = config.LANE_SPEED * dt, nl = Math.abs(dx) <= stepX ? target : c.lateral + (dx > 0 ? stepX : -stepX);
    var vn = (nl - c.lateral) / Math.max(dt, 1e-4); c.lateral = math.clamp(nl, -config.LANE_MAX, config.LANE_MAX);
    c.yaw = math.damp(c.yaw, math.clamp(Math.atan2(vn, Math.max(60, c.v)), -0.4, 0.4), 6, dt);
    c.progress = math.clamp(c.s / raceLen, 0, 1);
  }

  function computeRival(race) {
    var best = -Infinity;
    for (var i = 0; i < race.cars.length; i++) { var c = race.cars[i]; if (!c.gone && !(race.riggedId != null && c.p && c.p.id === race.riggedId) && c.s > best) best = c.s; }
    race.rival = best;
  }

  function separateOverlap(cars, dt, instant) {
    var idx = []; for (var q = 0; q < cars.length; q++) if (!cars[q].broken && !cars[q].gone && !cars[q].finished) idx.push(cars[q]);
    idx.sort(function (x, y) { return x.s - y.s; }); var fixed = 0;
    for (var i = 0; i < idx.length; i++) for (var j = i + 1; j < idx.length; j++) {
      var a = idx[i], b = idx[j], ads = b.s - a.s; if (ads >= config.CAR_LEN) break;
      var dl = a.lateral - b.lateral, adl = Math.abs(dl);
      if (adl >= config.CAR_W + 3) continue;
      var need = config.CAR_W * (1 - config.MAX_OVERLAP * config.CAR_LEN / (config.CAR_LEN - ads)) + 3;
      if (adl >= need) continue;
      var dir = dl >= 0 ? 1 : -1; if (adl < 0.01) dir = (i % 2 === 0) ? 1 : -1;
      if (instant) { var half = (need - adl) / 2; a.lateral = math.clamp(a.lateral + dir * half, -config.LANE_MAX, config.LANE_MAX); b.lateral = math.clamp(b.lateral - dir * half, -config.LANE_MAX, config.LANE_MAX); }
      else { var move = Math.min(need - adl, config.CAR_W) * math.clamp(dt * 7, 0, 1); a.lateral = math.clamp(a.lateral + dir * move, -config.LANE_MAX, config.LANE_MAX); b.lateral = math.clamp(b.lateral - dir * move, -config.LANE_MAX, config.LANE_MAX); if (b.v >= a.v * 0.98) { b.passTimer = 0.9; b.passPower = 0.20; } }
      fixed++;
    }
    return fixed;
  }

  function planOvertakes(race, cars) {
    if (race.elapsed < 0.7 || race.elapsed < (race.nextPassCheck || 0)) return;
    race.nextPassCheck = race.elapsed + 0.25;
    var rnd = race.rng;
    function freeLane(c, lane) {
      var lo = Math.min(c.lateral, lane) - config.CAR_W / 2;
      var hi = Math.max(c.lateral, lane) + config.CAR_W / 2;
      for (var k = 0; k < cars.length; k++) {
        var o = cars[k];
        if (o === c || o.broken || o.gone || o.finished || Math.abs(o.s - c.s) > 50) continue;
        if (Math.abs(o.lateral - lane) < config.CAR_W) return false;
        if (o.passUntil > race.elapsed && Math.abs(o.lane - lane) < config.CAR_W) return false;
        if (o.lateral > lo && o.lateral < hi) return false;
        if (o.passUntil > race.elapsed && o.lane > lo && o.lane < hi) return false;
      }
      return true;
    }
    for (var i = 0; i < cars.length; i++) {
      var c = cars[i];
      if (c.finished || c.broken || c.gone) continue;
      c.laneCooldown -= 0.25;
      if (race.elapsed < c.passUntil) continue;
      var front = null, nearest = 220;
      for (var j = 0; j < cars.length; j++) {
        var other = cars[j], gap = other.s - c.s;
        if (other === c || other.broken || other.gone || other.finished) continue;
        if (gap > 20 && gap < nearest && Math.abs(other.lateral - c.lateral) < 48) { front = other; nearest = gap; }
      }
      if (front && !(c.v < front.v - 15 && nearest > 120)) {
        var best = null, bestRoom = 0;
        for (var side = -1; side <= 1; side += 2) {
          var lane = c.lateral + side * config.LANE_STEP;
          if (Math.abs(lane) > config.LANE_MAX - 4) continue;
          var room = 250;
          for (var k2 = 0; k2 < cars.length; k2++) {
            var o2 = cars[k2], ds2 = o2.s - c.s;
            if (o2 === c || o2.broken || o2.gone || o2.finished || ds2 < -100 || ds2 > 220) continue;
            if (Math.abs(o2.lateral - lane) < 52 || (o2.passUntil > race.elapsed && Math.abs(o2.lane - lane) < 52)) room = Math.min(room, Math.abs(ds2));
          }
          if (room > 105 && room > bestRoom) { best = lane; bestRoom = room; }
        }
        if (best !== null && freeLane(c, best)) {
          c.lane = best; c.passUntil = race.elapsed + 1.8; c.passTimer = Math.max(c.passTimer, 0.9); c.passPower = 0.20; continue;
        }
      }
      if (c.laneCooldown <= 0) {
        var step = (rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * 3));
        var slot = math.clamp(Math.round(c.lateral / config.LANE_STEP) + step, -(config.LANES - 1) / 2, (config.LANES - 1) / 2);
        var target = slot * config.LANE_STEP;
        if (Math.abs(target - c.lateral) > 20 && freeLane(c, target)) {
          c.lane = target; c.baseLane = target; c.passUntil = race.elapsed + 1 + rnd(); c.laneCooldown = 1.2 + rnd() * 2;
        } else c.laneCooldown = 0.8;
      }
    }
  }

  function interact(race, dt) {
    if (!race || typeof race.rng !== 'function') throw new TypeError('interact requires race.rng');
    var cars = race.cars, rnd = race.rng;
    for (var q = 0; q < cars.length; q++) { cars[q].draft = 0; cars[q].follow = 1; cars[q].aheadGap = Infinity; cars[q].aheadV = 0; }
    planOvertakes(race, cars);
    if (race.elapsed >= 0.7 && race.elapsed >= (race.nextPassCheck || 0)) {
      race.nextPassCheck = race.elapsed + 0.25;
      for (var i = 0; i < cars.length; i++) {
        var c = cars[i]; if (c.finished || c.broken || c.gone || race.elapsed < c.passUntil) continue;
        c.laneCooldown -= 0.25;
        if (c.laneCooldown <= 0) {
          var step = (rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * 3));
          var slot = math.clamp(Math.round(c.lateral / config.LANE_STEP) + step, -(config.LANES - 1) / 2, (config.LANES - 1) / 2), target = slot * config.LANE_STEP;
          if (Math.abs(target - c.lateral) > 20) { c.lane = target; c.baseLane = target; c.passUntil = race.elapsed + 1 + rnd(); c.laneCooldown = 1.2 + rnd() * 2; } else c.laneCooldown = 0.8;
        }
      }
    }
    var sorted = cars.filter(function (c) { return !c.broken && !c.gone && !c.finished; }).sort(function (a, b) { return a.s - b.s; });
    for (var si = 0; si < sorted.length; si++) {
      var a = sorted[si];
      for (var sj = si + 1; sj < sorted.length; sj++) {
        var b = sorted[sj], ads = b.s - a.s; if (ads >= 230) break;
        var adl = Math.abs(a.lateral - b.lateral);
        if (ads > 20 && adl < 40 && ads < a.aheadGap) { a.aheadGap = ads; a.aheadV = b.v; }
        if (ads > 20 && ads < 120) { if (adl >= 26 && adl < 62) a.draft += 0.09; else if (adl < 26) a.draft -= 0.03; b.draft -= 0.04; }
        if (ads > 20 && ads < 130 && adl < config.CAR_W && a.v >= b.v * 1.02) { a.passTimer = 0.5; a.passPower = 0.20; }
      }
    }
    separateOverlap(cars, dt, false);
    for (var z = 0; z < cars.length; z++) { cars[z].draft = math.clamp(cars[z].draft, -0.09, 0.13); cars[z].follow = 1; }
  }

  function endRace(race) { race.ranked = rankCars(race.cars); race.results = race.ranked.map(function (c) { return { id: c.p && c.p.id, name: c.p && (c.p.name || c.p.id) || '', avatar: c.p && (c.p.avatarDataUrl || c.p.avatarDiscUrl || ''), finished: c.finished, finishTime: c.finishTime, progress: c.progress, stoppedAt: race.elapsed }; }); race.phase = 'ending'; race.endingElapsed = 0; }
  function waitingLimit(race) {
    // Long starting grids need additional travel time for their rear rows.
    var speed = race.track.raceLen / 21.5;
    return Math.max(6, trackApi.gridPlan(race.cars.length).depth / (speed * 0.85));
  }
  function step(race, dt) {
    race.elapsed += dt;
    // Once the result order is fixed, cars only need to coast out of view.
    if (race.phase === 'ending' || race.phase === 'results') {
      for (var endingIndex = 0; endingIndex < race.cars.length; endingIndex++) updateCar(race, race.cars[endingIndex], dt, race.elapsed, race.track.raceLen);
      return;
    }
    interact(race, dt); var lead0 = race.ranked && race.ranked[0]; race.leaderS = lead0 ? lead0.s : 0;
    for (var i = 0; i < race.cars.length; i++) updateCar(race, race.cars[i], dt, race.elapsed, race.track.raceLen);
    for (var rp = 0; rp < 2; rp++) if (!separateOverlap(race.cars, dt, true)) break;
    race.ranked = rankCars(race.cars); for (var r = 0; r < race.ranked.length; r++) race.ranked[r].rank = r + 1; computeRival(race);
    if (race.phase === 'racing') { if (race.ranked[0] && race.ranked[0].finished) { race.phase = 'waiting'; race.waitingElapsed = 0; race.leaderFinishAt = race.ranked[0].finishTime; } }
    else if (race.phase === 'waiting') { race.waitingElapsed += dt; var fin = 0, alive = 0; for (var k = 0; k < race.cars.length; k++) { if (race.cars[k].broken) continue; alive++; if (race.cars[k].finished) fin++; } if (fin >= alive || race.waitingElapsed >= waitingLimit(race)) endRace(race); }
  }
  function snapshotResults(race) {
    var source = race.results && race.results.length ? race.results : rankCars(race.cars || []);
    return source.map(function (entry) {
      var p = entry.p || null;
      return {
        id: entry.id != null ? entry.id : p && p.id,
        name: entry.name || (p && (p.name || p.id)) || '',
        avatar: entry.avatar || (p && (p.avatarDataUrl || p.avatarDiscUrl || '')) || '',
        finished: !!entry.finished,
        finishTime: entry.finishTime || 0,
        progress: entry.progress || 0,
        stoppedAt: entry.stoppedAt != null ? entry.stoppedAt : (race.elapsed || 0)
      };
    });
  }

  AvatarRace.physics = { createRaceState: createRaceState, createCars: createCars, rankCars: rankCars, step: step, snapshotResults: snapshotResults, waitingLimit: waitingLimit, computeRival: computeRival, updateCar: updateCar, interact: interact, separateOverlap: separateOverlap };
})(typeof window !== 'undefined' ? window : globalThis);
