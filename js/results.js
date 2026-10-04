(function (global) {
  'use strict';
  var AvatarRace = global.AvatarRace = global.AvatarRace || {};

  function show(snapshot, elements) {
    var list = snapshot || [];
    var board = elements.board, result = elements.result, note = elements.resultNote;
    if (!board || !result) return;
    board.innerHTML = '';
    for (var i = 0; i < list.length; i++) {
      if (i === 5) {
        var separator = document.createElement('div');
        separator.className = 'board-sep';
        separator.textContent = '6th place and below (scroll down)';
        board.appendChild(separator);
      }
      var entry = list[i] || {};
      var row = document.createElement('div');
      row.className = 'row' + (i === 0 ? ' top1' : (i === 1 ? ' top2' : (i === 2 ? ' top3' : '')))
        + (i > 4 ? ' minor' : '') + (i === list.length - 1 && list.length > 5 ? ' sticky-last' : '');
      var rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = String(i + 1);
      var img = document.createElement('img'); img.alt = ''; img.referrerPolicy = 'no-referrer'; img.src = entry.avatar || '';
      var name = document.createElement('span'); name.className = 'nm'; name.textContent = entry.name || entry.id || '';
      var time = document.createElement('span'); time.className = 'st';
      time.textContent = (i === list.length - 1 && list.length > 5 ? 'LAST · ' : '')
        + (entry.finished ? AvatarRace.math.fmtTime(entry.finishTime) : '—');
      row.appendChild(rank); row.appendChild(img); row.appendChild(name); row.appendChild(time); board.appendChild(row);
    }
    board.scrollTop = 0;
    note.textContent = list.length > 5 ? ('Top 5 shown — scroll for all ' + list.length + ' participants') : (list.length + ' participants');
    result.hidden = false;
  }

  AvatarRace.results = { show: show };
})(typeof window !== 'undefined' ? window : globalThis);
