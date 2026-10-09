'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadRuntime } = require('./physics-runtime');
function setup(count, seed = 42) {
  const api = loadRuntime(), participants = Array.from({ length: count }, (_, i) => ({ id: i + 1, name: String(i + 1) }));
  const track = api.track.buildTrack(seed, api.track.gridPlan(count).depth);
  const race = api.physics.createRaceState({ phase: 'racing', seed, track, participants });
  race.cars = api.physics.createCars(track, participants, race.rng);
  race.ranked = api.physics.rankCars(race.cars); race.ranked.forEach((c, i) => { c.rank = i + 1; });
  return { api, race };
}
test('finishers clear the line at crossing speed before slowing down', () => {
  const { api, race } = setup(2), car = race.cars[0];
  Object.assign(car, { s: race.track.raceLen + 1, finished: true, finishTime: 20, exitSpeed: 450, v: 450, baseSpeed: 400 });
  for (let i = 0; i < 60; i++) api.physics.updateCar(race, car, 1 / 60, 20 + i / 60, race.track.raceLen);
  assert.equal(car.v, 450); assert.ok(car.s > race.track.raceLen + 450); assert.equal(car.finishTime, 20);
  car.s = race.track.raceLen + 1300;
  for (let i = 0; i < 120; i++) api.physics.updateCar(race, car, 1 / 60, 21 + i / 60, race.track.raceLen);
  assert.ok(car.v < 240, 'cars must slow down after clearing the finish');
});
test('finished cars no longer reserve lanes or push unfinished cars sideways', () => {
  const { api, race } = setup(2), [front, rear] = race.cars;
  race.elapsed = 2;
  Object.assign(front, { s: race.track.raceLen + 10, finished: true, lateral: 0, lane: 0, v: 220 });
  Object.assign(rear, { s: race.track.raceLen - 25, lateral: 0, lane: 0, baseLane: 0, laneCooldown: 10, v: 430 });
  api.physics.interact(race, 1 / 60);
  assert.equal(rear.aheadGap, Infinity); assert.equal(rear.lane, 0); assert.equal(rear.lateral, 0);
  assert.equal(api.physics.separateOverlap(race.cars, 1 / 60, true), 0);
});
for (const count of [120, 300, 600]) test(`${count} cars finish before settling`, () => {
  const { api, race } = setup(count);
  while (race.phase === 'racing' || race.phase === 'waiting') {
    api.physics.step(race, 1 / 60); assert.ok(race.elapsed < 40);
  }
  assert.equal(race.results.length, count);
  assert.ok(race.results.every(c => c.finished && Number.isFinite(c.finishTime) && c.finishTime > 0));
  assert.ok(race.cars.every(c => Number.isFinite(c.s) && Math.abs(c.lateral) <= api.config.LANE_MAX));
  console.log(`PACK ${count}: ${race.waitingElapsed.toFixed(2)}s wait, all finished`);
});
test('small races keep the six-second timeout', () => {
  const { api, race } = setup(12); assert.equal(api.physics.waitingLimit(race), 6);
});
