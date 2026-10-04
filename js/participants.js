(function (global) {
  'use strict';

  var AvatarRace = global.AvatarRace = global.AvatarRace || {};
  var config = AvatarRace.config;
  var math = AvatarRace.math;

  function createStore() {
    return { items: [], nextId: 1, gridOrder: null, riggedId: null, searchQuery: '' };
  }

  function displayName(store, participant) {
    var name = String(participant && participant.name || '').trim();
    if (name) return name;
    var items = store && store.items || [];
    var index = items.indexOf(participant);
    return '赛车手 ' + (index >= 0 ? index + 1 : 1);
  }

  function initialOf(name) {
    var text = String(name || '').trim();
    return text ? text.charAt(0).toUpperCase() : '?';
  }

  function makeDefaultAvatar(name) {
    if (typeof document === 'undefined') return null;
    var size = 192;
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var context = canvas.getContext('2d');
    if (!context) return null;
    var palette = config.PALETTE;
    var color = palette[math.hashStr(name || 'racer') % palette.length];
    context.fillStyle = color;
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2, 0, config.TAU);
    context.fill();
    context.fillStyle = 'rgba(255,255,255,0.92)';
    context.font = 'bold ' + Math.round(size * 0.46) + 'px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(initialOf(name), size / 2, size / 2 + size * 0.03);
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2 - 4, 0, config.TAU);
    context.lineWidth = 6;
    context.strokeStyle = 'rgba(20,22,26,0.9)';
    context.stroke();
    return canvas;
  }

  function setDefaultAvatar(participant) {
    var name = participant && (participant._displayName || participant.name);
    var canvas = makeDefaultAvatar(name);
    participant.avatarDisc = canvas;
    participant.avatarDataUrl = canvas && canvas.toDataURL ? canvas.toDataURL('image/png') : '';
    participant.avatarDiscUrl = '';
    participant.avatarSource = null;
    return participant;
  }

  function createParticipant(store, name, username, avatarUrl) {
    var participant = {
      id: store.nextId++,
      name: name || '',
      username: username || '',
      avatarUrl: avatarUrl || '',
      avatarSource: null,
      avatar: null,
      avatarDisc: null,
      avatarDataUrl: '',
      avatarDiscUrl: ''
    };
    store.items.push(participant);
    participant._displayName = displayName(store, participant);
    setDefaultAvatar(participant);
    return participant;
  }

  function add(store, name) {
    return createParticipant(store, name || '', '', '');
  }

  function remove(store, participant) {
    var index = store.items.indexOf(participant);
    if (index < 0) return false;
    store.items.splice(index, 1);
    if (store.riggedId === participant.id) store.riggedId = null;
    return true;
  }

  function clear(store) {
    store.items.length = 0;
    store.gridOrder = null;
    store.riggedId = null;
    store.searchQuery = '';
  }

  function shuffle(store, random) {
    if (store.items.length < 2) return false;
    var rnd = typeof random === 'function' ? random : Math.random;
    for (var i = store.items.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var item = store.items[i];
      store.items[i] = store.items[j];
      store.items[j] = item;
    }
    store.gridOrder = [];
    for (var k = 0; k < store.items.length; k++) store.gridOrder.push(k);
    for (var m = store.gridOrder.length - 1; m > 0; m--) {
      var q = Math.floor(rnd() * (m + 1));
      var slot = store.gridOrder[m];
      store.gridOrder[m] = store.gridOrder[q];
      store.gridOrder[q] = slot;
    }
    return true;
  }

  function parseCsv(text) {
    var source = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    var rows = [], row = [], field = '', inQuote = false;
    for (var i = 0; i < source.length; i++) {
      var ch = source.charAt(i);
      if (inQuote) {
        if (ch === '"') {
          if (source.charAt(i + 1) === '"') { field += '"'; i++; }
          else inQuote = false;
        } else field += ch;
      } else if (ch === '"') inQuote = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch !== '\r') field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function importCsv(store, text) {
    var rows = parseCsv(text);
    if (rows.length < 2) return { ok: false, error: '这个 CSV 里没有数据行', added: 0, participants: [] };
    var header = rows[0].map(function (value) { return String(value).trim().toLowerCase(); });
    var nameIndex = header.indexOf('fullname');
    var userIndex = header.indexOf('username');
    var avatarIndex = header.indexOf('avatar url');
    if (avatarIndex < 0) avatarIndex = header.indexOf('avatar');
    if (nameIndex < 0 && userIndex < 0) return { ok: false, error: '表头里找不到 Fullname / Username 列', added: 0, participants: [] };
    if (avatarIndex < 0) return { ok: false, error: '表头里找不到 Avatar URL 列', added: 0, participants: [] };
    clear(store);
    var added = 0;
    var imported = [];
    for (var r = 1; r < rows.length; r++) {
      var current = rows[r];
      if (!current || current.join('').replace(/[\s,]/g, '') === '') continue;
      var username = userIndex >= 0 ? String(current[userIndex] || '').trim() : '';
      var name = nameIndex >= 0 ? String(current[nameIndex] || '').trim() : '';
      name = name || username || ('赛车手 ' + (added + 1));
      var avatarUrl = avatarIndex >= 0 ? String(current[avatarIndex] || '').trim() : '';
      var participant = createParticipant(store, name, username, avatarUrl);
      imported.push(participant);
      added++;
    }
    return { ok: true, error: '', added: added, participants: imported };
  }

  function loadImageFallback(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode-failed')); };
      image.src = url;
    });
  }

  function loadBitmap(file) {
    return new Promise(function (resolve, reject) {
      if (typeof createImageBitmap === 'function') {
        var finished = false;
        createImageBitmap(file).then(function (bitmap) {
          if (!finished) { finished = true; resolve(bitmap); }
        }, function () {
          loadImageFallback(file).then(function (image) {
            if (!finished) { finished = true; resolve(image); }
          }, reject);
        });
      } else loadImageFallback(file).then(resolve, reject);
    });
  }

  function makeDisc(source, width, height) {
    var size = 192;
    var disc = document.createElement('canvas');
    disc.width = disc.height = size;
    var context = disc.getContext('2d');
    if (!context) throw new Error('no-2d-context');
    var min = Math.min(width, height);
    if (!(min > 0)) throw new Error('bad-size');
    context.save();
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2 - 1, 0, config.TAU);
    context.clip();
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size, size);
    context.drawImage(source, (width - min) / 2, (height - min) / 2, min, min, 0, 0, size, size);
    context.restore();
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2 - 4, 0, config.TAU);
    context.lineWidth = 6;
    context.strokeStyle = 'rgba(20,22,26,0.9)';
    context.stroke();
    return disc;
  }

  function setRemoteAvatar(participant, url, done) {
    var image = new Image();
    image.referrerPolicy = 'no-referrer';
    image.onload = function () {
      try {
        participant.avatarDisc = makeDisc(image, image.naturalWidth || 150, image.naturalHeight || 150);
        participant.avatarDiscUrl = url;
        participant.avatarDataUrl = '';
        participant.avatarSource = 'remote';
        if (done) done(true);
      } catch (error) {
        if (global.console) console.warn('头像绘制失败', url, error);
        if (done) done(false, '绘制失败：' + (error && error.message ? error.message : error));
      }
    };
    image.onerror = function () {
      if (global.console) console.warn('头像加载失败', url);
      if (done) done(false, '加载失败：' + url);
    };
    image.src = url;
  }

  function setAvatarFromSources(participant, sources, done) {
    var index = 0;
    var lastError = '';
    function next() {
      if (index >= sources.length) { if (done) done(false, lastError); return; }
      var url = sources[index++];
      setRemoteAvatar(participant, url, function (ok, error) {
        if (ok) { if (done) done(true); return; }
        if (error) lastError = error;
        next();
      });
    }
    next();
  }

  function avatarSources(participant) {
    var sources = [];
    var username = String(participant && participant.username || '').trim();
    var remote = String(participant && participant.avatarUrl || '').trim();
    if (/^[A-Za-z0-9._-]{1,40}$/.test(username)) sources.push('avatars/' + username + '.jpg');
    if (/^https?:\/\//i.test(remote)) sources.push(remote);
    return sources;
  }

  function applyUpload(participant, file) {
    if (!file || !/^image\//i.test(file.type || '') || file.size > 15 * 1024 * 1024) {
      setDefaultAvatar(participant);
      return Promise.resolve(false);
    }
    return loadBitmap(file).then(function (source) {
      try {
        var size = 192;
        var width = source.width || source.naturalWidth || size;
        var height = source.height || source.naturalHeight || size;
        participant.avatarDisc = makeDisc(source, width, height);
        participant.avatarDataUrl = participant.avatarDisc.toDataURL('image/png');
        participant.avatarDiscUrl = '';
        participant.avatarSource = 'upload';
        if (source.close) source.close();
        return true;
      } catch (error) {
        setDefaultAvatar(participant);
        return false;
      }
    }, function () {
      setDefaultAvatar(participant);
      return false;
    });
  }

  function applyDefaultNames(store) {
    for (var i = 0; i < store.items.length; i++) {
      var participant = store.items[i];
      if (!String(participant.name || '').trim()) {
        participant.name = '赛车手 ' + (i + 1);
        participant._displayName = participant.name;
        if (participant.avatarSource !== 'upload') setDefaultAvatar(participant);
      }
    }
  }

  AvatarRace.participants = {
    createStore: createStore,
    add: add,
    remove: remove,
    clear: clear,
    shuffle: shuffle,
    displayName: displayName,
    parseCsv: parseCsv,
    importCsv: importCsv,
    setDefaultAvatar: setDefaultAvatar,
    applyUpload: applyUpload,
    applyDefaultNames: applyDefaultNames,
    avatarSources: avatarSources,
    setAvatarFromSources: setAvatarFromSources
  };
})(window);
