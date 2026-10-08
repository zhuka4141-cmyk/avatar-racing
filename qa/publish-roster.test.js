const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

function harness(fail) {
  const context = {
    TextEncoder, Uint8Array, crypto: webcrypto,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    localStorage: { getItem: () => '{}', setItem: () => {} },
    AvatarRace: { roster: [['Old', 'old']] },
    fetch: async (url, options = {}) => {
      if (fail) return { ok: false, status: 403, text: async () => 'Forbidden' };
      let body = {};
      if (url.includes('/git/ref/heads/')) body = { object: { sha: 'base' } };
      else if (url.includes('/git/commits/base')) body = { tree: { sha: 'tree' } };
      else if (url.includes('/git/trees/tree')) body = { tree: [] };
      else if (url.endsWith('/git/blobs')) body = { sha: 'blob' };
      else if (url.endsWith('/git/trees')) body = { sha: 'new-tree' };
      else if (url.endsWith('/git/commits')) body = { sha: 'new-commit' };
      else if (url.includes('avatars/')) return { ok: false, status: 404 };
      return { ok: true, text: async () => JSON.stringify(body) };
    }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../js/publish.js'), 'utf8'), context);
  return context;
}

(async () => {
  const rows = Array.from({ length: 221 }, (_, i) => ({ name: 'Fan ' + i, username: 'fan_' + i, avatarUrl: '' }));
  const success = harness(false);
  const saving = success.AvatarRace.publish.publish('test', rows);
  rows[0].name = 'Changed during upload';
  await saving;
  assert.equal(success.AvatarRace.roster.length, 221);
  assert.equal(success.AvatarRace.roster[0][0], 'Fan 0');
  assert.equal(success.AvatarRace.roster[220][1], 'fan_220');
  const failure = harness(true);
  await assert.rejects(failure.AvatarRace.publish.publish('test', rows), /403/);
  assert.equal(failure.AvatarRace.roster.length, 1);
  assert.equal(failure.AvatarRace.roster[0][1], 'old');
  console.log('PASS: saved roster updates immediately; failed saves retain previous roster');
})().catch(error => { console.error(error); process.exitCode = 1; });
