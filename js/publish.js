(function (global) {
  'use strict';
  var AvatarRace = global.AvatarRace = global.AvatarRace || {};
  var OWNER = 'zhuka4141-cmyk';
  var REPO = 'avatar-racing';
  var BRANCH = 'main';
  var TOKEN_KEY = 'avatarRace.token';
  var URLS_KEY = 'avatarRace.avatarUrls';
  var ROSTER_PATH = 'data/roster.js';
  var USER_RE = /^[A-Za-z0-9._-]{1,40}$/;
  var FETCH_WORKERS = 10;
  var UPLOAD_WORKERS = 10;

  function esc(value) {
    var text = String(value == null ? '' : value).replace(/[\r\n]+/g, ' ');
    var out = '"';
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch === '"') out += '\\"';
      else if (ch === '\\') out += '\\\\';
      else out += ch;
    }
    return out + '"';
  }

  function rosterText(rows) {
    var lines = [
      '(function (global) {',
      '  global.AvatarRace = global.AvatarRace || {};',
      '  global.AvatarRace.roster = ['
    ];
    for (var i = 0; i < rows.length; i++) {
      lines.push('  [' + esc(rows[i].name) + ', ' + esc(rows[i].username) + ']' + (i < rows.length - 1 ? ',' : ''));
    }
    lines.push('];', '})(window);');
    return lines.join('\r\n') + '\r\n';
  }

  function parseRows(text) {
    var rows = AvatarRace.participants.parseCsv(text);
    if (rows.length < 2) return [];
    var header = rows[0].map(function (v) { return String(v).trim().toLowerCase(); });
    var nameIndex = header.indexOf('fullname');
    if (nameIndex < 0) nameIndex = header.indexOf('full name');
    if (nameIndex < 0) nameIndex = header.indexOf('name');
    var userIndex = header.indexOf('username');
    var avatarIndex = -1;
    for (var a = 0; a < header.length; a++) {
      if (/^(avatar(\s*(url|pic|image|link))?|头像)$/.test(header[a])) { avatarIndex = a; break; }
    }
    if (userIndex < 0) return [];
    var out = [];
    for (var r = 1; r < rows.length; r++) {
      var cur = rows[r];
      if (!cur) continue;
      var username = String(cur[userIndex] || '').trim();
      if (!USER_RE.test(username)) continue;
      var name = nameIndex >= 0 ? String(cur[nameIndex] || '').trim() : '';
      var avatarUrl = avatarIndex >= 0 ? String(cur[avatarIndex] || '').trim() : '';
      out.push({ name: name || username, username: username, avatarUrl: avatarUrl });
    }
    return out;
  }

  function proxyUrl(url) {
    var bare = String(url == null ? '' : url).replace(/^https?:\/\//i, '');
    if (!bare) return '';
    return 'https://images.weserv.nl/?url=' + encodeURIComponent(bare) + '&w=192&h=192&fit=cover&output=jpg';
  }

  function sourcesFor(row) {
    var list = [];
    var remote = String(row && row.avatarUrl || '').trim();
    if (/^https?:\/\//i.test(remote)) {
      list.push(remote);
      var proxied = proxyUrl(remote);
      if (proxied) list.push(proxied);
    }
    if (row && USER_RE.test(String(row.username || '').trim())) list.push('avatars/' + row.username + '.jpg');
    return list;
  }

  function bytesToBase64(bytes) {
    var chunk = 0x8000;
    var parts = [];
    for (var i = 0; i < bytes.length; i += chunk) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
    }
    return btoa(parts.join(''));
  }

  function base64Utf8(text) {
    return bytesToBase64(new TextEncoder().encode(text));
  }

  function gitBlobSha(bytes) {
    var header = new TextEncoder().encode('blob ' + bytes.byteLength + '\u0000');
    var all = new Uint8Array(header.length + bytes.byteLength);
    all.set(header, 0);
    all.set(bytes, header.length);
    return crypto.subtle.digest('SHA-1', all).then(function (hash) {
      var view = new Uint8Array(hash);
      var hex = '';
      for (var i = 0; i < view.length; i++) hex += ('0' + view[i].toString(16)).slice(-2);
      return hex;
    });
  }

  function fetchAvatar(row) {
    var list = sourcesFor(row);
    var index = 0;
    function next() {
      if (index >= list.length) return Promise.resolve(null);
      var url = list[index++];
      return fetch(url, { cache: 'no-store' }).then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        var type = response.headers.get('content-type') || '';
        return response.arrayBuffer().then(function (buffer) {
          if (buffer.byteLength < 400) throw new Error('too small');
          if (type && type.indexOf('image/') !== 0 && type.indexOf('application/octet') !== 0) throw new Error('not image: ' + type);
          var bytes = new Uint8Array(buffer);
          return { path: 'avatars/' + row.username + '.jpg', bytes: bytes, base64: bytesToBase64(bytes), source: url };
        });
      }).catch(function () { return next(); });
    }
    return next();
  }

  function pool(items, limit, worker) {
    return new Promise(function (resolve, reject) {
      if (!items.length) { resolve(); return; }
      var index = 0, done = 0, failed = false;
      function finish() {
        done++;
        if (done === items.length) resolve(); else run();
      }
      function run() {
        if (failed) return;
        if (index >= items.length) return;
        var item = items[index++];
        Promise.resolve().then(function () { return worker(item); }).then(finish, function (error) {
          if (!failed) { failed = true; reject(error); }
        });
      }
      for (var i = 0; i < Math.min(limit, items.length); i++) run();
    });
  }

  function api(token, path, options) {
    var init = options || {};
    init.headers = {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    };
    if (init.body && typeof init.body !== 'string') init.body = JSON.stringify(init.body);
    return fetch('https://api.github.com/repos/' + OWNER + '/' + REPO + path, init).then(function (response) {
      return response.text().then(function (text) {
        if (!response.ok) {
          var error = new Error('GitHub ' + response.status + '：' + text.slice(0, 180));
          error.status = response.status;
          throw error;
        }
        return text ? JSON.parse(text) : {};
      });
    });
  }

  function loadUrlCache() {
    try { return JSON.parse(global.localStorage.getItem(URLS_KEY) || '{}') || {}; } catch (error) { return {}; }
  }

  function saveUrlCache(cache) {
    try { global.localStorage.setItem(URLS_KEY, JSON.stringify(cache)); } catch (error) { /* 忽略 */ }
  }

  function publish(token, rows, onProgress) {
    rows = rows.map(function (row) {
      return { name: row.name, username: row.username, avatarUrl: row.avatarUrl };
    });
    var report = onProgress || function () {};
    var baseSha = '', baseTree = '';
    var existing = {};
    var files = [];
    var skipped = 0;
    var missing = [];
    var urlCache = loadUrlCache();
    var rosterBase64 = base64Utf8(rosterText(rows));
    var newCache = {};
    var started = Date.now();

    function elapsed() { return ((Date.now() - started) / 1000).toFixed(1) + 's'; }

    return api(token, '/git/ref/heads/' + BRANCH).then(function (ref) {
      baseSha = ref.object.sha;
      return api(token, '/git/commits/' + baseSha);
    }).then(function (commit) {
      baseTree = commit.tree.sha;
      report({ phase: '树', text: '读取仓库文件列表…' });
      return api(token, '/git/trees/' + baseTree + '?recursive=1');
    }).then(function (tree) {
      (tree.tree || []).forEach(function (entry) { if (entry.type === 'blob') existing[entry.path] = entry.sha; });
      var total = rows.length;
      var fetched = 0;
      report({ phase: '取头像', text: '取头像 0 / ' + total });
      return pool(rows, FETCH_WORKERS, function (row) {
        var path = 'avatars/' + row.username + '.jpg';
        var known = existing[path];
        if (known && urlCache[row.username] && urlCache[row.username] === row.avatarUrl) {
          fetched++;
          skipped++;
          newCache[row.username] = row.avatarUrl;
          if (fetched % 10 === 0 || fetched === total) report({ phase: '取头像', text: '取头像 ' + fetched + ' / ' + total + '（跳过未变化 ' + skipped + '）' });
          return Promise.resolve();
        }
        return fetchAvatar(row).then(function (file) {
          fetched++;
          if (!file) {
            missing.push(row.username);
            if (known) newCache[row.username] = urlCache[row.username] || '';
          } else {
            newCache[row.username] = row.avatarUrl;
            return gitBlobSha(file.bytes).then(function (sha) {
              if (known && known === sha) skipped++;
              else files.push(file);
            });
          }
        }).then(function () {
          if (fetched % 10 === 0 || fetched === total) report({ phase: '取头像', text: '取头像 ' + fetched + ' / ' + total + '（跳过未变化 ' + skipped + '）' });
        });
      });
    }).then(function () {
      var rosterSha = existing[ROSTER_PATH];
      return gitBlobSha(new TextEncoder().encode(rosterText(rows))).then(function (sha) {
        var rosterChanged = rosterSha !== sha;
        if (rosterChanged) files.push({ path: ROSTER_PATH, base64: rosterBase64 });
        if (!files.length) {
          report({ phase: '完成', text: '没有变化（名单与头像都是最新的），' + elapsed() });
          saveUrlCache(Object.assign({}, urlCache, newCache));
          return '';
        }
        var total = files.length;
        var done = 0;
        report({ phase: '上传', text: '上传 0 / ' + total + '（跳过未变化 ' + skipped + '）' });
        return pool(files, UPLOAD_WORKERS, function (file) {
          return api(token, '/git/blobs', { method: 'POST', body: { content: file.base64, encoding: 'base64' } }).then(function (blob) {
            file.sha = blob.sha;
            done++;
            if (done % 5 === 0 || done === total) report({ phase: '上传', text: '上传 ' + done + ' / ' + total });
          });
        }).then(function () {
          var tree = files.map(function (file) { return { path: file.path, mode: '100644', type: 'blob', sha: file.sha }; });
          report({ phase: '提交', text: '提交中…' });
          return api(token, '/git/trees', { method: 'POST', body: { base_tree: baseTree, tree: tree } });
        }).then(function (created) {
          return api(token, '/git/commits', { method: 'POST', body: { message: 'sync followers from web: ' + rows.length + ' 位', tree: created.sha, parents: [baseSha] } });
        }).then(function (commit) {
          return api(token, '/git/refs/heads/' + BRANCH, { method: 'PATCH', body: { sha: commit.sha } }).then(function () {
            saveUrlCache(Object.assign({}, urlCache, newCache));
            return commit.sha;
          });
        });
      });
    }).then(function (sha) {
      AvatarRace.roster = rows.map(function (row) { return [row.name, row.username]; });
      report({
        phase: '完成',
        sha: sha,
        skipped: skipped,
        missing: missing,
        count: rows.length,
        text: (sha ? '已提交 ' + sha.slice(0, 7) : '已是最新') + '：名单 ' + rows.length + ' 位、本次更新 ' + (rows.length - missing.length - skipped) + ' 张、跳过未变化 ' + skipped + ' 张'
          + (missing.length ? '、取不到 ' + missing.length + ' 张（保留原图）' : '') + '，用时 ' + elapsed()
      });
      return sha;
    });
  }

  AvatarRace.publish = {
    rosterText: rosterText,
    parseRows: parseRows,
    sourcesFor: sourcesFor,
    proxyUrl: proxyUrl,
    fetchAvatar: fetchAvatar,
    gitBlobSha: gitBlobSha,
    publish: publish,
    owner: OWNER,
    repo: REPO,
    branch: BRANCH,
    tokenKey: TOKEN_KEY,
    urlsKey: URLS_KEY,
    rosterPath: ROSTER_PATH
  };

  if (typeof document === 'undefined') return;

  function install() {
    if (document.getElementById('publishBtn')) return;
    var input = document.getElementById('csvInput');
    if (!input || !input.parentNode) return;
    var style = document.createElement('style');
    style.textContent = '.publish-row{display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap}'
      + '.publish-status{font-size:12px;opacity:.75;line-height:1.5}';
    document.head.appendChild(style);
    var row = document.createElement('div');
    row.className = 'publish-row';
    row.innerHTML = '<button id="publishBtn" class="btn ghost" type="button">保存到仓库（同步头像）</button>'
      + '<span id="publishStatus" class="publish-status">导入 CSV 后可一键写入仓库</span>';
    input.parentNode.insertBefore(row, input.nextSibling);
    var button = document.getElementById('publishBtn');
    var status = document.getElementById('publishStatus');
    var rows = [];
    var busy = false;

    function say(text) { if (status) status.textContent = text; }

    input.addEventListener('change', function (event) {
      var file = event.target && event.target.files && event.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        rows = parseRows(reader.result);
        say(rows.length ? ('已读取 ' + rows.length + ' 位，可点「保存到仓库」') : '这个文件里没读到粉丝（需要 Username 和 Avatar 列）');
      };
      reader.readAsText(file, 'UTF-8');
    }, true);

    button.addEventListener('click', function () {
      if (busy) return;
      if (!rows.length) { say('先点「导入 CSV 名单」选一个 CSV 文件'); return; }
      var token = '';
      try { token = global.localStorage.getItem(TOKEN_KEY) || ''; } catch (error) { token = ''; }
      if (!token) {
        token = (global.prompt('粘贴 GitHub Token（只需一次，存在本机浏览器里）\n权限：该仓库的 Contents 读写') || '').trim();
        if (!token) { say('已取消'); return; }
        try { global.localStorage.setItem(TOKEN_KEY, token); } catch (error) { /* 忽略 */ }
      }
      busy = true;
      button.disabled = true;
      say('开始同步…');
      publish(token, rows, function (progress) { say(progress.text); }).catch(function (error) {
        var message = String(error && error.message || error);
        if (error && (error.status === 401 || error.status === 403)) {
          try { global.localStorage.removeItem(TOKEN_KEY); } catch (ignore) { /* 忽略 */ }
          say('Token 无效或权限不足，已清除，请重新点一次再粘贴。' + message);
        } else say('失败：' + message);
      }).then(function () {
        busy = false;
        button.disabled = false;
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})(window);
