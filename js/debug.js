(function (global) {
  'use strict';
  var AvatarRace = global.AvatarRace = global.AvatarRace || {};
  function copyCar(car) {
    return { id: car.p && car.p.id, name: car.p && car.p.name, s: car.s, v: car.v, lateral: car.lateral, progress: car.progress, finished: !!car.finished, finishTime: car.finishTime, broken: !!car.broken, rank: car.rank };
  }
  function install(options) {
    options = options || {};
    var race = options.state.race;
    var api = {
      getState: function () { return { phase: race.phase, seed: race.seed, elapsed: race.elapsed, waitingElapsed: race.waitingElapsed, results: (race.results || []).map(function (x) { return { id: x.id, name: x.name, finished: !!x.finished, finishTime: x.finishTime, progress: x.progress }; }) }; },
      getCars: function () { return (race.cars || []).map(copyCar); },
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
