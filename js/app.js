(function(){
'use strict';

var AvatarRace = window.AvatarRace;

var setupView = document.getElementById('setupView');
var raceView = document.getElementById('raceView');
var listEl = document.getElementById('list');
var emptyEl = document.getElementById('empty');
var searchBarEl = document.getElementById('searchBar');
var searchInputEl = document.getElementById('searchInput');
var searchClearEl = document.getElementById('searchClear');
var searchCountEl = document.getElementById('searchCount');
var canvas = document.getElementById('game');
var hudStatus = document.getElementById('hudStatus');
var hudSub = document.getElementById('hudSub');
var countBadge = document.getElementById('countBadge');
var diagEl = document.getElementById('diag');
var countdownEl = document.getElementById('countdown');
var countdownText = document.getElementById('countdownText');
var startLights = [document.getElementById('startLight1'), document.getElementById('startLight2'), document.getElementById('startLight3')];
var litCount = -1, countdownStartedAt = 0, startAudio = null, startTones = [];
var liveRanking = document.getElementById('liveRanking');
var rankNodes = new Map();
var resultEl = document.getElementById('result');
var resultNote = document.getElementById('resultNote');
var boardEl = document.getElementById('board');
var toastEl = document.getElementById('toast');
var rankBtnEl = document.getElementById('rankBtn');

var testMode = /(?:^|[?&])test=1(?:&|$)/.test(window.location.search || '');
var loopFailed = false;
var toastTimer = 0;

/* ------------------------------------------------------------------ *
 * 参赛者与头像
 * ------------------------------------------------------------------ */

var participantStore = AvatarRace.participants.createStore();
var participants = participantStore.items;
var setupUi;
var trackApi = AvatarRace.track;
function displayName(p){ return AvatarRace.participants.displayName(participantStore, p); }
function applyDefaultNames(){
  AvatarRace.participants.applyDefaultNames(participantStore);
  for (var i = 0; i < participants.length; i++) {
    if (participants[i].node && participants[i].node.inp) participants[i].node.inp.value = participants[i].name;
    setupUi.syncCard(participants[i]);
  }
}
/* ------------------------------------------------------------------ *
 * 比赛状态机
 * ------------------------------------------------------------------ */

var race = AvatarRace.physics.createRaceState({ participants: participants });
race.focusY = 0.62;
race.cam = { s:0, x:0, y:0, ang:-Math.PI/2 };

var sampleAt = trackApi.sampleAt;

var rankCars = AvatarRace.physics.rankCars;
function computeRival(r){ AvatarRace.physics.computeRival(r); }
function updateRace(dt){
  AvatarRace.physics.step(race, dt);
  if (race.phase === 'ending'){
    race.endingElapsed = (race.endingElapsed || 0) + dt;
    var anyVisible = false;
    for (var i = 0; i < race.cars.length; i++) {
      if (!race.cars[i].gone && Math.abs(race.cars[i].s - race.cam.s) < 1200) { anyVisible = true; break; }
    }
    if (!anyVisible || race.endingElapsed >= 12) showResults();
  }
}
var renderer = AvatarRace.render.create(canvas, {
  raceView: raceView, hudStatus: hudStatus, hudSub: hudSub, rankBtn: rankBtnEl,
  displayName: displayName
});
function updateHud(dt) { renderer.updateHud({ race: race }, dt); updateLiveRanking(dt); }
function resetLiveRanking(){
  liveRanking.innerHTML = ''; rankNodes.clear(); liveRanking.hidden = true;
}
function updateLiveRanking(dt){
  if (race.phase === 'setup' || race.phase === 'countdown' || race.phase === 'results') { liveRanking.hidden = true; return; }
  liveRanking.hidden = false;
  var leaders = race.ranked.slice(0, 15), active = new Set();
  for (var i = 0; i < leaders.length; i++) {
    var participant = leaders[i].p, entry = rankNodes.get(participant.id); active.add(participant.id);
    if (!entry) {
      var node = document.createElement('div'), number = document.createElement('span'), image = document.createElement('img');
      node.className = 'live-rank'; node.setAttribute('role', 'listitem'); node.setAttribute('data-id', String(participant.id)); image.alt = ''; image.referrerPolicy = 'no-referrer';
      node.appendChild(number); node.appendChild(image); liveRanking.appendChild(node);
      entry = { node: node, number: number, image: image, source: null }; rankNodes.set(participant.id, entry);
    }
    var source = participant.avatarDisc || participant.avatarDataUrl || participant.avatarDiscUrl;
    if (entry.source !== source) {
      entry.source = source;
      try { entry.image.src = participant.avatarDisc ? participant.avatarDisc.toDataURL() : (participant.avatarDataUrl || participant.avatarDiscUrl || ''); } catch (error) { entry.image.src = participant.avatarDataUrl || participant.avatarDiscUrl || ''; }
    }
    if (entry.rank !== i + 1) {
      entry.rank = i + 1; entry.number.textContent = String(i + 1); entry.node.setAttribute('aria-label', 'Position ' + (i + 1));
      entry.node.style.setProperty('--rank-index', String(i));
      entry.node.style.zIndex = String(15 - i);
    }
  }
  rankNodes.forEach(function(entry, id){ if (!active.has(id)) { liveRanking.removeChild(entry.node); rankNodes.delete(id); } });
}
function render(dt) { renderer.render({ race: race }, dt); }
function resize() { renderer.resize(); }
function showResults() {
  race.results = AvatarRace.physics.snapshotResults(race);
  AvatarRace.results.show(race.results, { result: resultEl, resultNote: resultNote, board: boardEl });
  race.phase = 'results';
}
function setStartLights(count){
  if (count === litCount) return;
  litCount = count;
  for (var i = 0; i < startLights.length; i++) startLights[i].classList.toggle('lit', i < count);
  countdownEl.setAttribute('data-lit', String(count));
  countdownText.textContent = count ? count + ' red lights' : 'Lights out';
}
function stopStartSounds(){
  for (var i = 0; i < startTones.length; i++) { try { startTones[i].stop(); } catch (error) {} }
  startTones = [];
}
function playStartSounds(){
  stopStartSounds();
  try {
    var AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!startAudio) startAudio = new AudioContext();
    if (startAudio.state === 'suspended') startAudio.resume().catch(function(){});
    var at = startAudio.currentTime;
    for (var i = 0; i < 4; i++) {
      var oscillator = startAudio.createOscillator(), gain = startAudio.createGain();
      var time = at + i, duration = i === 3 ? 0.32 : 0.12;
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(i === 3 ? 1046 : 523, time);
      gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(0.16, time + 0.008); gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
      oscillator.connect(gain); gain.connect(startAudio.destination);
      oscillator.onended = (function(o, g){ return function(){ o.disconnect(); g.disconnect(); }; })(oscillator, gain);
      oscillator.start(time); oscillator.stop(time + duration + 0.01); startTones.push(oscillator);
    }
  } catch (error) { /* Race starts normally when audio is unavailable. */ }
}
function toast(msg){
  toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ toastEl.hidden = true; }, 2600);
}
/* ------------------------------------------------------------------ *
 * 启动 / 主循环
 * ------------------------------------------------------------------ */

function reportError(error, context){
  if (globalThis.console && console.error) console.error('[AvatarRace] ' + context, error);
  if (testMode) throw error;
  if (loopFailed) return;
  loopFailed = true;
  toast('比赛暂时无法继续，请返回设置');
}
function startRace(){
  if (participants.length < 2){
    toast('至少需要 2 位参赛者才能开始比赛');
    return;
  }
  applyDefaultNames();
  resetLiveRanking();
  race.seed = (Math.random()*4294967295) >>> 0;
  race.track = AvatarRace.track.buildTrack(race.seed, AvatarRace.track.gridPlan(participants.length).depth);
  race.elapsed = 0; race.waitingElapsed = 0; race.endingElapsed = 0; race.leaderFinishAt = 0;
  race.nextPassCheck = 0;
  race.results = [];
  race.focusY = 0.62;
  race.rng = AvatarRace.math.mulberry32((race.seed ^ 0x9e3779b9) >>> 0);
  race.riggedId = participantStore.riggedId;
  race.participants = participants;
  race.cars = AvatarRace.physics.createCars(race.track, participants, race.rng, participantStore.gridOrder, participantStore.riggedId);
  race.ranked = rankCars(race.cars);
  for (var r=0;r<race.ranked.length;r++) race.ranked[r].rank = r + 1;
  computeRival(race);
  race.phase = 'countdown';
  race.countdown = 3;
  var startS = race.cars.length ? race.cars[0].s : 0;
  var sp = sampleAt(race.track, startS);
  race.cam = { s: startS, x: sp.x, y: sp.y, ang: sp.ang };
  raceView.hidden = false;
  setupView.hidden = true;
  resultEl.hidden = true;
  countdownEl.hidden = false;
  countdownStartedAt = performance.now();
  setStartLights(1);
  playStartSounds();
  loopFailed = false;
  resize();
  updateHud(0.11);
}
function backToSetup(){
  resetLiveRanking();
  stopStartSounds(); setStartLights(0); countdownEl.hidden = true;
  race.phase = 'setup';
  race.cars = [];
  race.ranked = [];
  race.results = [];
  resultEl.hidden = true;
  raceView.hidden = true;
  setupView.hidden = false;
}
var last = 0;
function frame(now){
  requestAnimationFrame(frame);
  if (loopFailed) return;
  var dt = (now - last) / 1000;
  last = now;
  if (!isFinite(dt) || dt < 0) dt = 0;
  dt = Math.min(dt, 1/30);
  try {
    if (race.phase === 'countdown'){
      race.countdown = Math.max(0, 3 - (now - countdownStartedAt) / 1000);
      if (race.countdown <= 0){
        race.phase = 'racing';
        race.elapsed = 0;
        setStartLights(0);
        countdownEl.hidden = true;
      } else {
        setStartLights(Math.min(3, 1 + Math.floor(3 - race.countdown)));
      }
    } else if (race.phase === 'racing' || race.phase === 'waiting' || race.phase === 'ending' || race.phase === 'results'){
      updateRace(dt);
    }
    render(dt);
    updateHud(dt);
  } catch (error) {
    reportError(error, 'frame');
  }
}

var started = false;
function start(){
  if (started) return;
  started = true;
  setupUi = AvatarRace.setup.mount({
    state: { participants: participantStore },
    elements: {
      list: listEl,
      empty: emptyEl,
      searchBar: searchBarEl,
      searchInput: searchInputEl,
      searchClear: searchClearEl,
      searchCount: searchCountEl,
      countBadge: countBadge,
      diag: diagEl,
      addButton: document.getElementById('addBtn'),
      rosterButton: document.getElementById('rosterBtn'),
      csvButton: document.getElementById('csvBtn'),
      csvInput: document.getElementById('csvInput'),
      sampleButton: document.getElementById('sampleBtn'),
      clearButton: document.getElementById('clearBtn'),
      shuffleButton: document.getElementById('shuffleBtn'),
      startButton: document.getElementById('startBtn')
    },
    onStart: startRace,
    onToast: toast
  });
  // 返回设置：改成按 Esc（不再放按钮，也不加图标）
  document.addEventListener('keydown', function(e){
    if ((e.key === 'Escape' || e.key === 'Esc') && race.phase !== 'setup') backToSetup();
  });
  document.getElementById('toSetupBtn').addEventListener('click', backToSetup);
  document.getElementById('againBtn').addEventListener('click', function(){ startRace(); });
  rankBtnEl.addEventListener('click', function(){ if (race.phase === 'ending') showResults(); });
  window.addEventListener('resize', function(){ resize(); });
  window.addEventListener('orientationchange', function(){ setTimeout(resize, 200); });
  AvatarRace.debug.install({
    state: { race: race, participants: participantStore },
    testMode: testMode
  });
  resize();
  requestAnimationFrame(function(t){ last = t; requestAnimationFrame(frame); });
}
AvatarRace.app = { start: start, reportError: reportError };
start();
})();
