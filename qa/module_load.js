'use strict';

var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');

var root = path.resolve(__dirname, '..');
var context = vm.createContext({
  window: {},
  Math: Math,
  console: console
});

['js/namespace.js', 'js/config.js', 'js/math.js'].forEach(function (relativePath) {
  var filename = path.join(root, relativePath);
  var source = fs.readFileSync(filename, 'utf8');
  vm.runInContext(source, context, { filename: filename });
});

var api = context.window.AvatarRace;
assert.ok(api, 'AvatarRace namespace should be created');
assert.ok(api.config, 'AvatarRace.config should be present');
assert.ok(api.config.RIG && typeof api.config.RIG === 'object', 'RIG config should be present');

[
  'CAR_W', 'CAR_LEN', 'LANES', 'LANE_STEP', 'LANE_MAX', 'HALF_W',
  'RACE_DIST', 'FWD_RUNOFF', 'VIEW_H', 'MIN_VIEW_W', 'PALETTE', 'RIG'
].forEach(function (name) {
  assert.ok(Object.prototype.hasOwnProperty.call(api.config, name), 'missing config: ' + name);
});

[
  'clamp', 'lerp', 'damp', 'dampAngle', 'mulberry32', 'hashStr',
  'rrect', 'fmtTime', 'dist'
].forEach(function (name) {
  assert.equal(typeof api.math[name], 'function', 'missing math helper: ' + name);
});

assert.equal(api.math.clamp(5, 0, 3), 3);
assert.equal(api.math.lerp(0, 10, 0.25), 2.5);
assert.equal(api.math.fmtTime(1.25), '1.250s');
assert.equal(api.math.dist({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
console.log('module load ok');
