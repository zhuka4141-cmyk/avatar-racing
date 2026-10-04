'use strict';
const assert = require('node:assert/strict');
const { loadRuntime } = require('./qa/physics-runtime');

const SEEDS = [1, 42, 9876, 2026, 31415, 2718, 8080, 9001];

function makeRace(seed, riggedId) {
  const AvatarRace = loadRuntime();
  const count = 12;
  const participants = Array.from({ length: count }, (_, i) => ({ id: i + 1, name: String(i + 1) }));
  const track = AvatarRace.track.buildTrack(seed, AvatarRace.track.gridPlan(count).depth);
  const race = AvatarRace.physics.createRaceState({ phase: 'racing', seed, track, participants, riggedId });
  race.cars = AvatarRace.physics.createCars(track, participants, race.rng, null, riggedId);
  race.ranked = AvatarRace.physics.rankCars(race.cars);
  race.ranked.forEach((car, index) => { car.rank = index + 1; });
  return { AvatarRace, race, participants, track };
}

function run(seed, riggedId) {
  const ctx = makeRace(seed, riggedId);
  const { AvatarRace, race } = ctx;
  const watched = riggedId == null ? null : race.cars.find(car => car.p.id === riggedId);
  const plan = AvatarRace.track.gridPlan(race.cars.length);
  const startRow = watched ? Math.round((-70 - watched.s) / plan.spacing) : null;
  const startCol = watched ? Math.round(watched.lateral / AvatarRace.config.LANE_STEP + (plan.cols - 1) / 2) : null;
  let maxLead = 0;
  let top3Frames = 0;
  let raceFrames = 0;
  let wasLeader = false;
  let lostLead = 0;
  while (race.phase === 'racing' || race.phase === 'waiting') {
    AvatarRace.physics.step(race, 1 / 60);
    assert.ok(race.elapsed < 35, 'race never finishes');
    for (const car of race.cars) {
      assert.equal(car.broken, false, 'car broke');
      assert.ok(Number.isFinite(car.s), 'non-finite car position');
    }
    if (watched && race.phase === 'racing' && race.elapsed > 2) {
      const rival = race.cars.filter(car => car !== watched).reduce((best, car) => Math.max(best, car.s), -Infinity);
      maxLead = Math.max(maxLead, watched.s - rival);
      top3Frames += watched.rank <= 3 ? 1 : 0;
      const leader = race.ranked[0] === watched;
      if (wasLeader && !leader) lostLead++;
      wasLeader = leader;
      raceFrames++;
    }
  }
  return { ...ctx, watched, plan, startRow, startCol, maxLead, top3Share: raceFrames ? top3Frames / raceFrames : 0, lostLead };
}

for (const seed of SEEDS) {
  const result = run(seed, 6);
  assert.equal(result.race.phase, 'ending');
  assert.equal(result.race.results[0].id, 6, `seed ${seed} did not honor the rigged winner`);
  assert.equal(result.startRow, 0, `seed ${seed} rigged car did not start in the first row`);
}

const columns = new Set(SEEDS.map(seed => run(seed, 6).startCol));
assert.ok(columns.size >= 4, `rigged grid slot did not vary enough: ${columns.size}`);
const visibility = SEEDS.map(seed => run(seed, 6));
assert.ok(visibility.some(result => result.lostLead > 0), 'rigged car was never overtaken');
assert.ok(visibility.every(result => result.maxLead < 1800), 'rigged car leads too visibly');
assert.ok(visibility.some(result => result.top3Share < 1), 'rigged car never leaves the top three');

for (const seed of SEEDS) {
  const natural = run(seed, null);
  assert.equal(natural.race.phase, 'ending');
  assert.equal(natural.race.cars.filter(car => car.finished).length, natural.race.cars.length);
}

console.log('rig QA passed: designated winner, varied first-row slots, visible overtakes, natural races');
