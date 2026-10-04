'use strict';

var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var test = require('node:test');
var vm = require('node:vm');

var root = path.resolve(__dirname, '..');
var context = vm.createContext({ window: {}, Math: Math, console: console, Promise: Promise });
['js/namespace.js', 'js/config.js', 'js/math.js', 'js/participants.js'].forEach(function (relativePath) {
  var filename = path.join(root, relativePath);
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename: filename });
});
var participants = context.window.AvatarRace.participants;
function nativeRows(rows) { return JSON.parse(JSON.stringify(rows)); }

test('removes BOM and keeps quoted commas', function () {
  assert.deepEqual(nativeRows(participants.parseCsv('\uFEFFFullname,Username,Avatar URL\n"Doe, Jane",jane,https://example.test/a')), [
    ['Fullname', 'Username', 'Avatar URL'],
    ['Doe, Jane', 'jane', 'https://example.test/a']
  ]);
});

test('keeps quoted newlines and escaped quotes', function () {
  assert.deepEqual(nativeRows(participants.parseCsv('Fullname,Username,Avatar URL\n"Line 1\nLine 2","say ""hi""",x')), [
    ['Fullname', 'Username', 'Avatar URL'],
    ['Line 1\nLine 2', 'say "hi"', 'x']
  ]);
});

test('uses Username when Fullname is blank', function () {
  var store = participants.createStore();
  var result = participants.importCsv(store, 'Fullname,Username,Avatar URL\n,alice,');
  assert.equal(result.ok, true);
  assert.equal(result.added, 1);
  assert.equal(store.items[0].name, 'alice');
});

test('skips blank rows during import', function () {
  var store = participants.createStore();
  var result = participants.importCsv(store, 'Fullname,Username,Avatar URL\n\n"",,,\nBob,bob,');
  assert.equal(result.ok, true);
  assert.equal(result.added, 1);
  assert.equal(store.items[0].name, 'Bob');
});

test('assigns unique fallback display names to blank participants', function () {
  var store = participants.createStore();
  var first = participants.add(store, '');
  var second = participants.add(store, '');
  assert.equal(first._displayName, '赛车手 1');
  assert.equal(second._displayName, '赛车手 2');
  assert.equal(participants.displayName(store, first), '赛车手 1');
  assert.equal(participants.displayName(store, second), '赛车手 2');
});

test('clears roster and race choices while preserving the active search query', function () {
  var store = participants.createStore();
  var first = participants.add(store, 'Alice');
  participants.add(store, 'Bob');
  store.riggedId = first.id;
  store.gridOrder = [1, 0];
  store.searchQuery = 'alice';

  participants.clear(store);

  assert.equal(store.items.length, 0);
  assert.equal(store.riggedId, null);
  assert.equal(store.gridOrder, null);
  assert.equal(store.searchQuery, 'alice');
});

['upload', 'remote'].forEach(function (source) {
  [
    { name: 'is not an image', file: { type: 'text/plain', size: 12 } },
    { name: 'is missing', file: undefined }
  ].forEach(function (invalidUpload) {
    test('preserves ' + source + ' avatar when upload file ' + invalidUpload.name, async function () {
      var participant = participants.add(participants.createStore(), 'Alice');
      var disc = { width: 192, height: 192 };
      var dataUrl = source === 'upload' ? 'data:image/png;base64,existing-avatar' : '';
      var discUrl = source === 'remote' ? 'https://example.test/alice.jpg' : '';
      participant.avatarSource = source;
      participant.avatarDisc = disc;
      participant.avatarDataUrl = dataUrl;
      participant.avatarDiscUrl = discUrl;

      assert.equal(await participants.applyUpload(participant, invalidUpload.file), false);
      assert.equal(participant.avatarSource, source);
      assert.equal(participant.avatarDisc, disc);
      assert.equal(participant.avatarDataUrl, dataUrl);
      assert.equal(participant.avatarDiscUrl, discUrl);
    });
  });
});
