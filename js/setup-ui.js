(function (global) {
  'use strict';

  var AvatarRace = global.AvatarRace = global.AvatarRace || {};
  var participants = AvatarRace.participants;

  function mount(options) {
    options = options || {};
    var state = options.state || {};
    var store = state.participants;
    if (!store) throw new Error('AvatarRace.setup.mount requires state.participants');
    var elements = options.elements || {};
    var toast = typeof options.onToast === 'function' ? options.onToast : function () {};

    function syncCard(participant) {
      var node = participant.node;
      if (!node) return;
      var source = participant.avatarDataUrl || participant.avatarDiscUrl || '';
      if (node.img.getAttribute('src') !== source) node.img.setAttribute('src', source);
      node.tag.textContent = participant.avatarSource === 'upload' ? '自定义头像'
        : (participant.avatarSource === 'remote' ? '名单头像' : '默认头像');
    }

    function syncRigButtons() {
      for (var i = 0; i < store.items.length; i++) {
        var participant = store.items[i];
        if (!participant.node || !participant.node.rigBtn) continue;
        var selected = store.riggedId === participant.id;
        participant.node.rigBtn.textContent = selected ? '★ 已指定' : '☆ 指定夺冠';
        participant.node.rigBtn.title = selected ? '取消指定' : '指定 TA 夺冠（比赛里不会出现任何标记）';
        participant.node.rigBtn.classList.toggle('rig-on', selected);
      }
    }

    function toggleRig(participant) {
      store.riggedId = store.riggedId === participant.id ? null : participant.id;
      syncRigButtons();
      toast(store.riggedId === null ? '已取消指定' : ('已指定 ' + participants.displayName(store, participant) + ' 夺冠（比赛里看不出来）'));
    }

    function updateCount() {
      if (elements.countBadge) elements.countBadge.textContent = '共 ' + store.items.length + ' 位参赛者';
    }

    function matchesSearch(participant, query) {
      if (!query) return true;
      if (participants.displayName(store, participant).toLowerCase().indexOf(query) >= 0) return true;
      return String(participant.username || '').toLowerCase().indexOf(query) >= 0;
    }

    function applySearch() {
      var query = String(store.searchQuery || '').trim().toLowerCase();
      var shown = 0;
      for (var i = 0; i < store.items.length; i++) {
        var participant = store.items[i];
        var visible = matchesSearch(participant, query);
        if (participant.node && participant.node.card) participant.node.card.hidden = !visible;
        if (visible) shown++;
      }
      if (elements.searchBar) elements.searchBar.hidden = store.items.length === 0;
      if (elements.searchClear) elements.searchClear.hidden = !query;
      if (elements.searchCount) elements.searchCount.textContent = query ? (shown + ' / ' + store.items.length) : '';
    }

    function buildCard(participant) {
      var card = document.createElement('div');
      card.className = 'card';
      var avatar = document.createElement('div');
      avatar.className = 'avatar';
      var image = document.createElement('img');
      image.alt = '';
      avatar.appendChild(image);
      var middle = document.createElement('div');
      middle.className = 'card-mid';
      var input = document.createElement('input');
      input.className = 'name-input';
      input.type = 'text';
      input.maxLength = 16;
      input.placeholder = '参赛者姓名';
      input.value = participant.name || '';
      input.addEventListener('input', function () {
        participant.name = input.value;
        participant._displayName = participant.name || participants.displayName(store, participant);
        if (participant.avatarSource !== 'upload' && participant.avatarSource !== 'remote') participants.setDefaultAvatar(participant);
        syncCard(participant);
      });
      var row = document.createElement('div');
      row.className = 'card-row';
      var uploadLabel = document.createElement('label');
      uploadLabel.className = 'btn small';
      uploadLabel.textContent = '上传头像';
      var fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.style.display = 'none';
      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (!file) return;
        participants.applyUpload(participant, file).then(function (ok) {
          syncCard(participant);
          toast(ok ? ('已设置头像：' + participants.displayName(store, participant)) : '无法读取该图片，已回退为默认头像');
        });
      });
      uploadLabel.appendChild(fileInput);
      var resetButton = document.createElement('button');
      resetButton.type = 'button';
      resetButton.className = 'btn small ghost';
      resetButton.textContent = '用默认头像';
      resetButton.addEventListener('click', function () {
        participant.avatarSource = null;
        participant.avatarDiscUrl = '';
        participants.setDefaultAvatar(participant);
        syncCard(participant);
        toast('已恢复默认头像：' + participants.displayName(store, participant));
      });
      row.appendChild(uploadLabel);
      row.appendChild(resetButton);
      var rigButton = document.createElement('button');
      rigButton.type = 'button';
      rigButton.className = 'btn small ghost';
      rigButton.addEventListener('click', function () { toggleRig(participant); });
      row.appendChild(rigButton);
      var tag = document.createElement('span');
      tag.className = 'st';
      tag.style.fontSize = '12px';
      tag.style.color = '#68727f';
      tag.style.alignSelf = 'center';
      row.appendChild(tag);
      middle.appendChild(input);
      middle.appendChild(row);
      var removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'btn small danger';
      removeButton.textContent = '删除';
      removeButton.addEventListener('click', function () {
        if (!participants.remove(store, participant)) return;
        if (participant.node && participant.node.card.parentNode) participant.node.card.parentNode.removeChild(participant.node.card);
        if (elements.empty) elements.empty.hidden = store.items.length > 0;
        updateCount();
        applySearch();
        syncRigButtons();
      });
      card.appendChild(avatar);
      card.appendChild(middle);
      card.appendChild(removeButton);
      participant.node = { card: card, img: image, inp: input, tag: tag, rigBtn: rigButton };
      syncCard(participant);
      syncRigButtons();
      return card;
    }

    function renderList() {
      if (!elements.list) return;
      elements.list.innerHTML = '';
      for (var i = 0; i < store.items.length; i++) {
        elements.list.appendChild(store.items[i].node ? store.items[i].node.card : buildCard(store.items[i]));
      }
      if (elements.empty) elements.empty.hidden = store.items.length > 0;
      updateCount();
      applySearch();
      syncRigButtons();
    }

    function loadAvatars(imported, done) {
      var pending = 0, finished = 0, failed = 0, firstError = '';
      for (var i = 0; i < imported.length; i++) {
        var participant = imported[i];
        var sources = participants.avatarSources(participant);
        if (!sources.length) continue;
        pending++;
        (function (item, sourceList) {
          participants.setAvatarFromSources(item, sourceList, function (ok, error) {
            finished++;
            if (!ok) { failed++; if (!firstError) firstError = error || '未知原因'; }
            syncCard(item);
            if (finished === pending && done) done({ pending: pending, failed: failed, firstError: firstError });
          });
        })(participant, sources);
      }
      if (!pending && done) done({ pending: 0, failed: 0, firstError: '' });
      return pending;
    }

    function addParticipant(name) {
      var participant = participants.add(store, name || '');
      if (elements.list) elements.list.appendChild(buildCard(participant));
      if (elements.empty) elements.empty.hidden = true;
      updateCount();
      applySearch();
      return participant;
    }

    function importRoster() {
      var roster = AvatarRace.roster || [];
      if (!roster.length) { toast('内置名单为空'); return; }
      participants.clear(store);
      var imported = [];
      for (var i = 0; i < roster.length; i++) {
        var pair = roster[i] || [];
        var participant = participants.add(store, pair[0] || pair[1] || '');
        participant.username = pair[1] || '';
        imported.push(participant);
      }
      renderList();
      var pending = loadAvatars(imported, function (summary) {
        if (elements.diag) elements.diag.textContent = summary.failed
          ? ('头像失败 ' + summary.failed + ' / ' + summary.pending + '（' + summary.firstError + '）')
          : ('头像 ' + summary.pending + ' 张全部就绪');
        toast('已载入 ' + imported.length + ' 位参赛者：头像成功 ' + (summary.pending - summary.failed) + ' 张' + (summary.failed ? '，失败 ' + summary.failed + ' 张' : ''));
      });
      toast('已载入 ' + imported.length + ' 位参赛者' + (pending ? '，正在取头像…' : ''));
    }

    function importCsvText(text) {
      var result = participants.importCsv(store, text);
      if (!result.ok) { toast(result.error); return; }
      renderList();
      var pending = loadAvatars(result.participants, function (summary) {
        toast('已导入 ' + result.added + ' 位参赛者：头像成功 ' + (summary.pending - summary.failed) + ' 张' + (summary.failed ? '，失败 ' + summary.failed + ' 张（用默认头像）' : ''));
      });
      toast(pending ? ('已导入 ' + result.added + ' 位参赛者，正在加载 ' + pending + ' 张头像…') : ('已导入 ' + result.added + ' 位参赛者'));
    }

    if (elements.searchInput) {
      elements.searchInput.addEventListener('input', function () { store.searchQuery = elements.searchInput.value; applySearch(); });
      elements.searchInput.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' || event.key === 'Esc') {
          elements.searchInput.value = '';
          store.searchQuery = '';
          applySearch();
        }
      });
    }
    if (elements.searchClear) elements.searchClear.addEventListener('click', function () {
      if (elements.searchInput) elements.searchInput.value = '';
      store.searchQuery = '';
      applySearch();
      if (elements.searchInput) elements.searchInput.focus();
    });
    if (elements.addButton) elements.addButton.addEventListener('click', function () {
      var participant = addParticipant('');
      if (participant.node) participant.node.inp.focus();
    });
    if (elements.rosterButton) elements.rosterButton.addEventListener('click', importRoster);
    if (elements.csvButton) elements.csvButton.addEventListener('click', function () { if (elements.csvInput) elements.csvInput.click(); });
    if (elements.csvInput) elements.csvInput.addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { try { importCsvText(reader.result); } catch (error) { toast('CSV 解析失败：' + error.message); } };
      reader.onerror = function () { toast('读不到这个文件'); };
      reader.readAsText(file, 'UTF-8');
    });
    if (elements.sampleButton) elements.sampleButton.addEventListener('click', function () {
      var names = ['阿波罗', '闪电', '赤兔', '疾风', '雷霆', '星尘'];
      var added = 0;
      for (var i = 0; i < names.length; i++) if (addParticipant(names[i])) added++;
      if (added) toast('已添加 ' + added + ' 位示例参赛者，可点击头像上传自定义图片');
    });
    if (elements.clearButton) elements.clearButton.addEventListener('click', function () {
      participants.clear(store);
      if (elements.list) elements.list.innerHTML = '';
      if (elements.empty) elements.empty.hidden = false;
      updateCount();
      applySearch();
      toast('已清空全部参赛者');
    });
    if (elements.shuffleButton) elements.shuffleButton.addEventListener('click', function () {
      if (!participants.shuffle(store, Math.random)) { toast('至少需要 2 位参赛者才能打乱顺序'); return; }
      renderList();
      toast('名单和发车位置都已打乱');
    });
    if (elements.startButton && typeof options.onStart === 'function') elements.startButton.addEventListener('click', options.onStart);

    if (!store.items.length) { addParticipant(''); addParticipant(''); }
    renderList();
    return { add: addParticipant, render: renderList, syncCard: syncCard, applySearch: applySearch };
  }

  AvatarRace.setup = { mount: mount };
})(window);
