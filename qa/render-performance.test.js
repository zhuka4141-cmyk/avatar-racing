'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

test('render caches labels and avatars and restores resolution for smaller races', () => {
  let textDraws = 0, avatarCopies = 0, width = 412;
  const source = {};
  function context() {
    return new Proxy({
      measureText: text => ({ width: text.length * 6 }),
      fillText: () => { textDraws++; },
      drawImage: image => { if (image === source) avatarCopies++; }
    }, { get: (target, key) => key in target ? target[key] : () => {} });
  }
  function canvas() { const ctx = context(); return { width: 0, height: 0, style: {}, getContext: () => ctx }; }
  const ctx = vm.createContext({ console, devicePixelRatio: 2, document: { createElement: canvas } });
  ctx.window = ctx;
  for (const name of ['namespace', 'config', 'math', 'track', 'physics', 'render']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', name + '.js'), 'utf8'), ctx);
  }
  const A = ctx.AvatarRace, people = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, name: 'Driver ' + i, avatarDisc: source }));
  const track = A.track.buildTrack(42, A.track.gridPlan(300).depth);
  const race = A.physics.createRaceState({ phase: 'racing', track, participants: people });
  race.cars = A.physics.createCars(track, people, race.rng);
  race.ranked = A.physics.rankCars(race.cars); race.ranked.forEach((car, i) => { car.rank = i + 1; });
  const p = A.track.sampleAt(track, -70); race.cam = { s: -70, x: p.x, y: p.y, ang: p.ang }; race.focusY = .62;
  const target = canvas(), renderer = A.render.create(target, { raceView: { getBoundingClientRect: () => ({ width, height: 840 }) } });
  renderer.resize(); renderer.render({ race }, 1 / 60);
  assert.equal(target.width, 412);
  assert.ok(textDraws > 0 && avatarCopies > 0);
  const textCount = textDraws, avatarCount = avatarCopies;
  renderer.render({ race }, 1 / 60);
  assert.equal(textDraws, textCount); assert.equal(avatarCopies, avatarCount);
  race.ranked[0].p.name = 'Renamed'; renderer.render({ race }, 1 / 60);
  assert.equal(textDraws, textCount + 1);
  width = 500; renderer.resize(); renderer.render({ race }, 1 / 60);
  assert.equal(target.width, 500); assert.ok(avatarCopies > avatarCount);
  race.cars = race.cars.slice(0, 15); race.ranked = A.physics.rankCars(race.cars);
  renderer.render({ race }, 1 / 60); assert.equal(target.width, 1000);
});
