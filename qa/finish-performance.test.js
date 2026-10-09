'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadRuntime } = require('./physics-runtime');

test('settled races coast without changing standings or planning overtakes', () => {
  for (const phase of ['ending', 'results']) {
    const api = loadRuntime();
    const participants = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, name: String(i + 1) }));
    const track = api.track.buildTrack(42, api.track.gridPlan(participants.length).depth);
    const race = api.physics.createRaceState({ phase, track, participants });
    race.cars = api.physics.createCars(track, participants, race.rng);
    race.cars.forEach((car, i) => {
      car.s = track.raceLen + i; car.finished = true; car.finishTime = 20 + i / 1000;
      car.v = car.baseSpeed; car.progress = 1; car.rank = i + 1;
    });
    race.ranked = api.physics.rankCars(race.cars);
    race.results = api.physics.snapshotResults(race);
    const ranked = race.ranked, results = JSON.stringify(race.results);
    const positions = race.cars.map(car => car.s);
    race.rng = () => { throw new Error('settled cars must not plan random overtakes'); };
    for (let i = 0; i < 60; i++) api.physics.step(race, 1 / 60);
    assert.equal(race.ranked, ranked);
    assert.equal(JSON.stringify(race.results), results);
    assert.equal(race.nextPassCheck, 0);
    assert.ok(race.cars.every((car, i) => car.s > positions[i] && car.finishTime === 20 + i / 1000));
    assert.equal(race.phase, phase);
  }
});
