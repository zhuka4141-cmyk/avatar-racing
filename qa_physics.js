'use strict';
const assert = require('node:assert/strict');
const { loadRuntime } = require('./qa/physics-runtime');
function people(count) { return Array.from({ length: count }, (_, i) => ({ id: i + 1, name: String(i + 1) })); }
function run(seed, count = 15, riggedId = null) {
  const AvatarRace = loadRuntime();
  const roster = people(count);
  const track = AvatarRace.track.buildTrack(seed, AvatarRace.track.gridPlan(count).depth);
  const race = AvatarRace.physics.createRaceState({ phase: 'racing', seed, track, participants: roster, riggedId });
  race.cars = AvatarRace.physics.createCars(track, roster, race.rng, null, riggedId);
  race.ranked = AvatarRace.physics.rankCars(race.cars);
  race.ranked.forEach((car, index) => { car.rank = index + 1; });
  for (let frame = 0; frame < 2400 && (race.phase === 'racing' || race.phase === 'waiting'); frame++) AvatarRace.physics.step(race, 1 / 60);
  assert.equal(race.phase, 'ending');
  assert.equal(race.cars.filter((car) => car.broken).length, 0);
  return { AvatarRace, race };
}
function summary(result) { return result.race.results.map((x) => ({ id: x.id, finished: x.finished, time: Number(x.finishTime.toFixed(3)) })); }
for (const count of [2, 8, 15, 120]) {
  const result = run(42, count);
  assert.equal(result.race.cars.length, count);
  result.race.cars.forEach((car) => { assert.ok(Number.isFinite(car.s)); assert.ok(Math.abs(car.lateral) <= 14 * 70 + 1e-6); });
}
const first = run(42), second = run(42);
assert.deepEqual(summary(first), summary(second));
assert.equal(first.race.results.length, 15);
assert.ok(first.race.results.every((x) => x.finished && x.finishTime > 0));
const rigged = run(7, 12, 1);
assert.equal(rigged.race.results[0].id, 1);
console.log('physics QA passed: grid, finite cars, finishers, rigged winner, deterministic seed');
