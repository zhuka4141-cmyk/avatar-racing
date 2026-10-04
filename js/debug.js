(function (global) {
  'use strict';
  var AvatarRace = global.AvatarRace = global.AvatarRace || {};
  function copyCar(car) {
    return { id: car.p && car.p.id, name: car.p && car.p.name, s: car.s, v: car.v, lateral: car.lateral, progress: car.progress, finished: !!car.finished, finishTime: car.finishTime, broken: !!car.broken, rank: car.rank, baseSpeed: car.baseSpeed, catchup: car.catchup, rigged: !!car.rigged };
  }
  function copyTrack(track) {
    if (!track) return null;
    return { seed: track.seed, raceLen: track.raceLen, minR: track.minR, turns: track.turns, pts: track.pts.map(function (p) { return { x: p.x, y: p.y, s: p.s, ang: p.ang, nx: p.nx, ny: p.ny }; }) };
  }
  function install(options) {
    options = options || {};
    var race = options.state.race;
    var api = {
      getState: function () { return { phase: race.phase, seed: race.seed, elapsed: race.elapsed, waitingElapsed: race.waitingElapsed, endingElapsed: race.endingElapsed, cam: race.cam ? { s: race.cam.s, x: race.cam.x, y: race.cam.y, ang: race.cam.ang } : null, raceLen: race.track && race.track.raceLen, rankedIds: (race.ranked || []).map(function (c) { return c.p && c.p.id; }), labelNames: (race.labelNames || []).slice(), results: (race.results || []).map(function (x) { return { id: x.id, name: x.name, finished: !!x.finished, finishTime: x.finishTime, progress: x.progress }; }) }; },
      getCars: function () { return (race.cars || []).map(copyCar); },
      getParticipants: function () { return (options.state.participants.items || []).map(function (p) { return { id: p.id, name: p.name, username: p.username, avatarSource: p.avatarSource, avatarDataUrl: p.avatarDataUrl }; }); },
      getTrack: function () { return copyTrack(race.track); },
      buildTrack: function (seed, runoff) { return AvatarRace.track.buildTrack(seed, runoff); }
    };
    if (options.testMode) {
      api.setCarSpeed = function (index, speed) { if (!race.cars[index]) throw new RangeError('car index out of range'); race.cars[index].baseSpeed = Number(speed); };
      api.setPhase = function (phase) { race.phase = String(phase); };
    }
    global.__avatarRace = Object.freeze(api);
    return api;
  }
  AvatarRace.debug = { install: install };
})(typeof window !== 'undefined' ? window : globalThis);
