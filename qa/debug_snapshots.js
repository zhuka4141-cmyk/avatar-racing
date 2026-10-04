'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({ window: { AvatarRace: {} } });
const filename = path.join(__dirname, '..', 'js', 'debug.js');
vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });

const participant = { id: 1, name: 'Driver', username: 'driver', avatarSource: 'upload', avatarDataUrl: 'data:image/png;base64,AA', node: {} };
const car = { p: participant, s: 25, baseSpeed: 400, catchup: 1.1, rigged: true };
const race = {
  phase: 'racing', seed: 1, cars: [car], ranked: [car], labelNames: ['Driver'],
  cam: { s: 25, x: 3, y: 4, ang: 0 },
  track: { seed: 1, raceLen: 100, minR: 500, turns: 2, pts: [{ x: 1, y: 2, s: 0, ang: 0, nx: 0, ny: 1 }] },
  results: [{ id: 1, name: 'Driver', finished: false, finishTime: 0, progress: 0.25 }]
};
const state = { race, participants: { items: [participant] } };
const install = context.window.AvatarRace.debug.install;
const api = install({ state });

assert.equal(Object.isFrozen(api), true);
assert.equal(api.race, undefined);
assert.equal(api.participants, undefined);
assert.equal(api.setCarSpeed, undefined);
assert.equal(api.setPhase, undefined);

const snapshot = api.getState();
snapshot.phase = 'setup';
snapshot.cam.s = 900;
snapshot.rankedIds[0] = 999;
snapshot.labelNames[0] = 'changed';
snapshot.results[0].name = 'changed';
api.getCars()[0].baseSpeed = 1;
api.getTrack().pts[0].x = 900;
const copiedParticipant = api.getParticipants()[0];
copiedParticipant.name = 'changed';
assert.equal(copiedParticipant.node, undefined);
assert.equal(race.phase, 'racing');
assert.equal(race.cam.s, 25);
assert.equal(race.ranked[0].p.id, 1);
assert.equal(race.labelNames[0], 'Driver');
assert.equal(race.results[0].name, 'Driver');
assert.equal(car.baseSpeed, 400);
assert.equal(race.track.pts[0].x, 1);
assert.equal(participant.name, 'Driver');

const testApi = install({ state, testMode: true });
testApi.setCarSpeed(0, 80);
testApi.setPhase('waiting');
assert.equal(car.baseSpeed, 80);
assert.equal(race.phase, 'waiting');
assert.throws(() => testApi.setCarSpeed(1, 80), { name: 'RangeError' });
console.log('debug snapshots and test-only commands ok');
