(function (global) {
  'use strict';
  var AvatarRace = global.AvatarRace = global.AvatarRace || {};
  var config = AvatarRace.config, math = AvatarRace.math, trackApi = AvatarRace.track;

  function create(canvas, elements) {
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    var viewW = 1, viewH = 1, dpr = 1;
    var camMat = { a: 1, b: 0, c: 0, d: -1, e: 0, f: 0, scale: 1 };
    var hudCache = { s: '', sub: '' }, hudTimer = 0;
    var carSprite = null, shadowSprite = null;
    var labelFont = '600 10px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';

    function resize() {
      var rect = elements.raceView.getBoundingClientRect();
      viewW = Math.max(1, Math.round(rect.width)); viewH = Math.max(1, Math.round(rect.height));
      dpr = Math.min(global.devicePixelRatio || 1, 2);
      canvas.width = Math.round(viewW * dpr); canvas.height = Math.round(viewH * dpr);
      canvas.style.width = viewW + 'px'; canvas.style.height = viewH + 'px';
    }
    function updateCamera(race, dt) {
      var racing = race.phase === 'racing' || race.phase === 'countdown' || race.phase === 'setup';
      var targetS, targetFocus;
      if (racing) {
        var lead = race.ranked && race.ranked[0];
        targetS = lead ? lead.s : 0;
        targetFocus = 0.62;
      } else {
        targetS = race.track.raceLen - 40;
        targetFocus = 0.56;
      }
      var lam = race.phase === 'racing' ? 4.2 : 3.0;
      race.cam.s = math.damp(race.cam.s, targetS, lam, dt);
      var sample = trackApi.sampleAt(race.track, race.cam.s);
      race.cam.x = sample.x; race.cam.y = sample.y;
      var ahead = trackApi.sampleAt(race.track, race.cam.s + 330);
      var lookAng = Math.atan2(ahead.y - sample.y, ahead.x - sample.x);
      race.cam.ang = math.dampAngle(race.cam.ang, lookAng, race.phase === 'racing' ? 3.5 : 3.0, dt);
      race.focusY = math.damp(race.focusY, targetFocus, 3.0, dt);
    }
    function worldToScreen(x, y) { return { x: camMat.a * x + camMat.c * y + camMat.e, y: camMat.b * x + camMat.d * y + camMat.f }; }
    function carWorld(track, car) { var p = trackApi.sampleAt(track, car.s); return { x: p.x + p.nx * car.lateral, y: p.y + p.ny * car.lateral, ang: p.ang + car.yaw }; }
    function strokePts(g, pts, first, last, offset, width, color) {
      if (last <= first) return;
      g.beginPath();
      for (var i = first; i <= last; i++) { var p = pts[i], x = offset ? p.x + p.nx * offset : p.x, y = offset ? p.y + p.ny * offset : p.y; if (i === first) g.moveTo(x, y); else g.lineTo(x, y); }
      g.lineWidth = width; g.strokeStyle = color; g.stroke();
    }
    function drawGround(g, cam, halfDiag) {
      var step = 150, x0 = Math.floor((cam.x - halfDiag) / step) * step, x1 = cam.x + halfDiag, y0 = Math.floor((cam.y - halfDiag) / step) * step, y1 = cam.y + halfDiag;
      g.fillStyle = 'rgba(122,134,148,0.20)';
      for (var y = y0; y <= y1; y += step) for (var x = x0; x <= x1; x += step) g.fillRect(x - 3, y - 3, 6, 6);
    }
    function drawKerbs(g, track, minS, maxS, offset, parity) {
      var width = 18, segment = 34, inner = offset - width / 2, outer = offset + width / 2;
      g.fillStyle = '#f3f5f8';
      for (var k = Math.ceil(minS / segment); k <= Math.floor(maxS / segment); k++) {
        if ((((k % 2) + 2) % 2) !== parity) continue;
        var a = trackApi.sampleAt(track, k * segment), m = trackApi.sampleAt(track, k * segment + segment / 2), b = trackApi.sampleAt(track, (k + 1) * segment);
        g.beginPath(); g.moveTo(a.x + a.nx * inner, a.y + a.ny * inner); g.lineTo(m.x + m.nx * inner, m.y + m.ny * inner); g.lineTo(b.x + b.nx * inner, b.y + b.ny * inner); g.lineTo(b.x + b.nx * outer, b.y + b.ny * outer); g.lineTo(m.x + m.nx * outer, m.y + m.ny * outer); g.lineTo(a.x + a.nx * outer, a.y + a.ny * outer); g.closePath(); g.fill();
      }
    }
    function drawChecker(g, track, s) {
      var rows = 2, cols = 16, depth = 46, p = trackApi.sampleAt(track, s), tx = Math.cos(p.ang), ty = Math.sin(p.ang), cell = (2 * config.HALF_W) / cols;
      for (var row = 0; row < rows; row++) for (var col = 0; col < cols; col++) {
        var lateral = -config.HALF_W + (col + 0.5) * cell, forward = (row - rows / 2 + 0.5) * depth / rows, x = p.x + p.nx * lateral + tx * forward, y = p.y + p.ny * lateral + ty * forward;
        g.fillStyle = ((row + col) % 2) ? '#fff' : '#23272e'; g.save(); g.translate(x, y); g.rotate(p.ang); g.fillRect(-cell / 2, -depth / (2 * rows), cell, depth / rows); g.restore();
      }
    }
    function carBodyPath(g) { math.rrect(g, -19, -41, 38, 78, 9); }
    function wheel(g, x, y) { math.rrect(g, x - 4.6, y - 5.6, 9.2, 11.2, 2.6); g.fill(); g.stroke(); }
    function drawCar(g) {
      g.lineJoin = 'round'; g.fillStyle = '#e8ecf0'; g.strokeStyle = '#b4bcc6'; g.lineWidth = 1.4;
      wheel(g, -18.5, -13); wheel(g, 18.5, -13); wheel(g, -18, 17); wheel(g, 18, 17);
      g.fillStyle = '#fff'; g.strokeStyle = '#c2c9d2'; g.lineWidth = 1.8;
      math.rrect(g, -9, -31, 18, 58, 5); g.fill(); g.stroke(); math.rrect(g, -17.5, -16, 10.5, 26, 4.5); g.fill(); g.stroke(); math.rrect(g, 7, -16, 10.5, 26, 4.5); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(-7.5, 10); g.lineTo(-4.2, 31); g.lineTo(4.2, 31); g.lineTo(7.5, 10); g.closePath(); g.fill(); g.stroke();
      math.rrect(g, -18.5, 26, 37, 8.5, 3); g.fill(); g.stroke(); math.rrect(g, -20, 25, 4, 11, 1.6); g.fill(); g.stroke(); math.rrect(g, 16, 25, 4, 11, 1.6); g.fill(); g.stroke();
      math.rrect(g, -17, -41, 34, 8, 2.5); g.fill(); g.stroke(); math.rrect(g, -19, -42, 4, 11, 1.6); g.fill(); g.stroke(); math.rrect(g, 15, -42, 4, 11, 1.6); g.fill(); g.stroke(); math.rrect(g, -2.6, -33, 5.2, 9, 1); g.fill(); g.stroke();
      g.beginPath(); g.arc(0, 1, 13.2, 0, config.TAU); g.fillStyle = '#f7f9fb'; g.fill(); g.stroke();
    }
    function buildSprites() {
      function make(draw) { var image = global.document.createElement('canvas'); image.width = 175; image.height = 298; var g = image.getContext('2d'); g.setTransform(3.5, 0, 0, 3.5, 87.5, 161); g.lineCap = 'round'; draw(g); return { canvas: image, x: -25, y: -46, w: 50, h: 85 }; }
      carSprite = make(drawCar); shadowSprite = make(function (g) { g.fillStyle = 'rgba(18,26,38,0.16)'; carBodyPath(g); g.fill(); });
    }
    function drawAvatar(g, x, y, radius, participant) { if (!participant.avatarDisc || radius < 3) return; try { g.drawImage(participant.avatarDisc, x - radius, y - radius, radius * 2, radius * 2); } catch (error) { /* avatar is optional */ } }
    function drawLabel(g, x, y, width, text) { g.fillStyle = 'rgba(26,33,44,0.5)'; math.rrect(g, x - width / 2, y - 9, width, 18, 9); g.fill(); g.fillStyle = 'rgba(255,255,255,0.92)'; g.fillText(text, x, y + 0.5); }
    function setText(node, key, value) { if (hudCache[key] !== value) { hudCache[key] = value; node.textContent = value; } }
    function updateHud(state, dt) {
      var race = state.race; hudTimer += dt || 0; if (hudTimer < 0.1 && race.phase !== 'results') return; hudTimer = 0;
      var lead = race.ranked && race.ranked[0], finished = 0; for (var i = 0; i < race.cars.length; i++) if (race.cars[i].finished) finished++;
      var status = 'Ready', sub = '';
      if (race.phase === 'countdown') { status = 'Get ready'; sub = 'Engines starting'; }
      else if (race.phase === 'racing') { status = 'Racing'; sub = 'Leader: ' + (lead ? (elements.displayName ? elements.displayName(lead.p) : (lead.p.name || lead.p.id)) : 'Racing') + ' · elapsed ' + math.fmtTime(race.elapsed); }
      else if (race.phase === 'waiting') { status = 'Waiting for the rest'; sub = 'Finished ' + finished + '/' + race.cars.length + ' · ' + Math.max(0, 5 - race.waitingElapsed).toFixed(1) + 's left'; }
      else if (race.phase === 'ending') { status = 'Race over'; sub = 'Cars leaving the track · finished ' + finished + '/' + race.cars.length; }
      else if (race.phase === 'results') { status = 'Race over'; sub = race.results && race.results[0] ? 'Winner: ' + race.results[0].name + ' · full standings available' : 'Full standings available'; }
      setText(elements.hudStatus, 's', status); setText(elements.hudSub, 'sub', sub); elements.rankBtn.hidden = race.phase !== 'ending';
    }
    function render(state, dt) {
      var race = state.race, W = viewW, H = viewH; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#e9edf1'; ctx.fillRect(0, 0, W, H); if (race.phase === 'setup' || !race.track) return; if (!carSprite) buildSprites();
      updateCamera(race, dt);
      var scale = Math.min(H / config.VIEW_H, W / config.MIN_VIEW_W); if (!(scale > 0)) return; var cam = race.cam, alpha = cam.ang - Math.PI / 2, ca = Math.cos(alpha), sa = Math.sin(alpha), ma = scale * ca, mb = scale * sa, mc = scale * sa, md = -scale * ca, me = W / 2 - scale * (ca * cam.x + sa * cam.y), mf = H * race.focusY - scale * (sa * cam.x - ca * cam.y);
      camMat = { a: ma, b: mb, c: mc, d: md, e: me, f: mf, scale: scale }; ctx.setTransform(dpr * ma, dpr * mb, dpr * mc, dpr * md, dpr * me, dpr * mf); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      var halfDiag = Math.sqrt(W * W + H * H) / (2 * scale), pts = race.track.pts, first = trackApi.indexAtS(race.track, cam.s - halfDiag - 160), last = trackApi.indexAtS(race.track, cam.s + halfDiag + 160);
      drawGround(ctx, cam, halfDiag); strokePts(ctx, pts, first, last, 0, 2 * config.HALF_W, '#8d9298'); strokePts(ctx, pts, first, last, config.HALF_W - 5, 5, 'rgba(255,255,255,0.5)'); strokePts(ctx, pts, first, last, -(config.HALF_W - 5), 5, 'rgba(255,255,255,0.5)'); strokePts(ctx, pts, first, last, config.HALF_W + 9, 18, '#d24a4a'); strokePts(ctx, pts, first, last, -(config.HALF_W + 9), 18, '#d24a4a');
      drawKerbs(ctx, race.track, cam.s - halfDiag - 60, cam.s + halfDiag + 60, config.HALF_W + 9, 0); drawKerbs(ctx, race.track, cam.s - halfDiag - 60, cam.s + halfDiag + 60, -(config.HALF_W + 9), 0);
      var low = cam.s - halfDiag - 120, high = cam.s + halfDiag + 120; if (0 > low && 0 < high) drawChecker(ctx, race.track, 0); if (race.track.raceLen > low && race.track.raceLen < high) drawChecker(ctx, race.track, race.track.raceLen);
      var list = race.ranked.length ? race.ranked : race.cars, withShadow = list.length <= 60;
      for (var j = 0; j < list.length; j++) { var car = list[j]; if (car.broken || car.gone || car.s < cam.s - halfDiag - 220 || car.s > cam.s + halfDiag + 220) continue; var world = carWorld(race.track, car), theta = world.ang - Math.PI / 2, ct = Math.cos(theta), st = Math.sin(theta); ctx.setTransform(dpr * (ma * ct + mc * st), dpr * (mb * ct + md * st), dpr * (-ma * st + mc * ct), dpr * (-mb * st + md * ct), dpr * (ma * world.x + mc * world.y + me), dpr * (mb * world.x + md * world.y + mf)); if (withShadow) ctx.drawImage(shadowSprite.canvas, shadowSprite.x + 6, shadowSprite.y - 6, shadowSprite.w, shadowSprite.h); ctx.drawImage(carSprite.canvas, carSprite.x, carSprite.y, carSprite.w, carSprite.h); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.font = labelFont; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; var labels = [], finishedCount = 0; for (var f = 0; f < list.length; f++) if (list[f].finished) finishedCount++;
      for (var m = 0; m < list.length; m++) { var current = list[m]; if (current.broken) continue; var currentWorld = carWorld(race.track, current), screen = worldToScreen(currentWorld.x, currentWorld.y); if (screen.x < -80 || screen.x > W + 80 || screen.y < -80 || screen.y > H + 80) { current.labelAlpha = math.damp(current.labelAlpha || 0, 0, 15, dt); continue; } var radius = 11 * scale, cockpit = worldToScreen(currentWorld.x + Math.cos(currentWorld.ang) * 1.5, currentWorld.y + Math.sin(currentWorld.ang) * 1.5); drawAvatar(ctx, cockpit.x, cockpit.y, radius, current.p); var aliveRank = current.finished ? 1e9 : ((current.rank || 1) - finishedCount); if (aliveRank <= 30) current.labelOn = true; else if (aliveRank > 32) current.labelOn = false; current.labelAlpha = math.damp(current.labelAlpha || 0, current.labelOn ? 1 : 0, 15, dt); if (current.labelAlpha > 0.01) { var text = elements.displayName ? elements.displayName(current.p) : (current.p.name || current.p.id); current.labelW = current.labelWName === text ? current.labelW : (ctx.measureText(text).width + 12); current.labelWName = text; labels.push({ x: screen.x, y: screen.y - radius - 12, width: current.labelW, text: text, alpha: current.labelAlpha, id: current.p.id }); } }
      labels.sort(function (a, b) { return a.id - b.id; }); race.labelNames = []; for (var q = 0; q < labels.length; q++) { var label = labels[q], x = Math.min(Math.max(label.x, label.width / 2 + 4), W - label.width / 2 - 4), y = Math.min(Math.max(label.y, 22), H - 22); race.labelNames.push(label.text); ctx.globalAlpha = label.alpha; drawLabel(ctx, x, y, label.width, label.text); ctx.globalAlpha = 1; }
    }
    return { resize: resize, render: render, updateHud: updateHud };
  }
  AvatarRace.render = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
