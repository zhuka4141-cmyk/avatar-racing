'use strict';
const assert = require('node:assert/strict');
const { loadRuntime } = require('./qa/physics-runtime');
function play(seed, riggedId) {
  const AvatarRace = loadRuntime();
  const count = 12;
  const roster = Array.from({ length: count }, (_, i) => ({ id: i + 1, name: String(i + 1) }));
  const track = AvatarRace.track.buildTrack(seed, AvatarRace.track.gridPlan(count).depth);
  const race = AvatarRace.physics.createRaceState({ phase: 'racing', seed, track, participants: roster, riggedId });
  race.cars = AvatarRace.physics.createCars(track, roster, race.rng, null, riggedId);
  race.ranked = AvatarRace.physics.rankCars(race.cars);
  race.ranked.forEach((car, index) => { car.rank = index + 1; });
  for (let frame = 0; frame < 2400 && (race.phase === 'racing' || race.phase === 'waiting'); frame++) AvatarRace.physics.step(race, 1 / 60);
  return race;
}
for (const seed of [1, 42, 9876, 2026, 31415]) {
  const race = play(seed, 6);
  assert.equal(race.phase, 'ending');
  assert.equal(race.results[0].id, 6, `seed ${seed} did not honor rigged winner`);
  assert.equal(race.cars.filter((car) => car.broken).length, 0);
}
console.log('rig QA passed: designated participant wins across seeded races');
