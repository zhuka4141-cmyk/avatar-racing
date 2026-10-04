'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const files = ['js/namespace.js','js/config.js','js/math.js','js/track.js','js/physics.js'];
function loadRuntime() {
  const context = vm.createContext({ console, setTimeout, clearTimeout });
  context.window = context;
  context.globalThis = context;
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  return context.AvatarRace;
}
module.exports = { loadRuntime };
