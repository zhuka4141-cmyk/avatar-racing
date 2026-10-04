'use strict';
// UI 层验证：node --test qa_rig_ui.js
//
// 这个文件不切源码片段，而是用最小 DOM 桩按 index.html 的顺序加载外部脚本，
// 然后只通过真实入口（点击卡片上的按钮、点「开始比赛」）驱动，
// 并且真的把 requestAnimationFrame 主循环一帧帧推完。
// 验证的是「UI → 发车格 → 物理 → 结算」整条链路。
//
// 注意：内定状态 riggedId 是 IIFE 内部的局部变量，外部拿不到 —— 所以这里
// 一律只断言「可观测的东西」：按钮文案/高亮、赛车上的 rigged 标记、最终名次。
// 这样测试也顺带证明了状态确实反映到了界面上。

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const scripts = Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g), match => match[1]);
assert.ok(scripts.length > 0, '页面应加载外部应用脚本');

// ---------------- 最小 DOM 桩 ----------------
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.attrs = {};
    this._text = '';
    this._html = '';
    this.hidden = false;
    this.className = '';
    this.type = '';
    this.value = '';
    this.title = '';
    this.alt = '';
    this.src = '';
    this.scrollTop = 0;
    this.files = null;
    this.listeners = new Map();
    const cls = new Set();
    this.classList = {
      add: (...c) => c.forEach(x => cls.add(x)),
      remove: (...c) => c.forEach(x => cls.delete(x)),
      contains: c => cls.has(c),
      toggle: (c, force) => {
        const enabled = force === undefined ? !cls.has(c) : !!force;
        if (enabled) cls.add(c); else cls.delete(c);
        return enabled;
      }
    };
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); if (v === '') this.children.length = 0; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(t, f) { if (!this.listeners.has(t)) this.listeners.set(t, []); this.listeners.get(t).push(f); }
  dispatch(t) { for (const f of (this.listeners.get(t) || [])) f({ target: this }); }
  focus() {}
  getBoundingClientRect() { return { width: 1280, height: 800 }; }
  getContext() { return makeCtx2d(); }
  toDataURL() { return 'data:image/png;base64,AAAA'; }
}
function makeCtx2d() {
  let self;
  const noop = () => self;                 // 未知方法：可调用，返回值还能继续取属性
  self = new Proxy({}, {
    get(t, k) {
      if (typeof k === 'symbol') return undefined;
      if (k in t) return t[k];
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      return noop;
    },
    set(t, k, v) { t[k] = v; return true; }
  });
  return self;
}
function findAll(el, pred, out) {
  out = out || [];
  for (const c of el.children) { if (pred(c)) out.push(c); findAll(c, pred, out); }
  return out;
}
function byText(root, txt) { return findAll(root, e => e._text === txt)[0]; }

function boot(testMode = true) {
  const byId = new Map();
  const rafQueue = [];
  const errors = [];
  let vnow = 0;
  const document = {
    createElement: t => new El(t),
    getElementById: id => { if (!byId.has(id)) byId.set(id, new El('div')); return byId.get(id); },
    addEventListener() {},
    body: new El('body')
  };
  const ctx = vm.createContext({
    document, window: { document, location: { search: testMode ? '?test=1' : '' }, devicePixelRatio: 1, addEventListener() {} },
    requestAnimationFrame: fn => { rafQueue.push(fn); return rafQueue.length; },
    setTimeout: () => 0, clearTimeout() {},
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL() {} },
    FileReader: class { readAsText() {} },
    Image: class extends El { constructor() { super('img'); } },
    console: Object.assign({}, console, { error: (...args) => errors.push(args) })
  });
  for (const relativePath of scripts) {
    const filename = path.join(__dirname, relativePath);
    vm.runInContext(fs.readFileSync(filename, 'utf8'), ctx, { filename });
  }

  const participants = () => {
    const cards = document.getElementById('list').children;
    return ctx.window.__avatarRace.getParticipants().map((participant, index) => {
      const card = cards[index];
      return Object.assign(participant, {
        node: { card, rigBtn: findAll(card, e => /指定/.test(e.textContent))[0] }
      });
    });
  };
  const race = () => Object.assign(ctx.window.__avatarRace.getState(), { cars: ctx.window.__avatarRace.getCars() });
  // 界面上被标记为「已指定」的人数（0 或 1）
  const marked = () => participants().filter(p => p.node.rigBtn.classList.contains('rig-on')).length;
  const pump = (maxFrames = 12000) => {
    for (let i = 0; i < maxFrames; i++) {
      if (race().phase === 'results') return true;
      vnow += 16.7;
      const q = rafQueue.splice(0, rafQueue.length);
      for (const fn of q) fn(vnow);
    }
    return race().phase === 'results';
  };
  return { ctx, document, participants, race, marked, pump, errors };
}
const click = (el) => el.dispatch('click');

// ---------------- 测试 ----------------

test('调试快照不会修改应用状态，生产模式没有测试命令', () => {
  const { ctx, document } = boot(false);
  const api = ctx.window.__avatarRace;
  assert.equal(api.race, undefined);
  assert.equal(api.participants, undefined);
  assert.equal(api.setCarSpeed, undefined);
  assert.equal(api.setPhase, undefined);
  const people = api.getParticipants();
  const originalName = people[0].name;
  people[0].name = 'changed snapshot';
  assert.equal(api.getParticipants()[0].name, originalName);
  ctx.window.AvatarRace.app.start();
  assert.equal(api.getParticipants().length, 2, '重复启动不应重复绑定或添加参赛者');
  click(document.getElementById('startBtn'));
  const state = api.getState();
  const cars = api.getCars();
  const track = api.getTrack();
  const originalS = cars[0].s;
  const originalX = track.pts[0].x;
  state.cam.s = 999999;
  cars[0].s = 999999;
  track.pts[0].x = 999999;
  assert.equal(api.getCars()[0].s, originalS);
  assert.equal(api.getState().cam.s, originalS);
  assert.equal(api.getTrack().pts[0].x, originalX);
});

test('普通模式出错后停止步进，返回设置并重开后恢复；测试模式重抛', () => {
  const { ctx, document, race, pump, errors } = boot(false);
  click(document.getElementById('startBtn'));
  pump(300);
  assert.equal(race().phase, 'racing');
  const elapsed = race().elapsed;
  ctx.window.AvatarRace.app.reportError(new Error('simulated renderer failure'), 'render');
  pump(120);
  assert.equal(race().elapsed, elapsed);
  assert.equal(errors.length, 1);
  assert.equal(document.getElementById('toast').hidden, false);
  click(document.getElementById('toSetupBtn'));
  click(document.getElementById('startBtn'));
  pump(300);
  assert.equal(race().phase, 'racing');
  assert.ok(race().elapsed > 0);
  const testBoot = boot();
  assert.throws(() => testBoot.ctx.window.AvatarRace.app.reportError(new Error('test failure'), 'render'), /test failure/);
});

test('加载完整脚本后，每位参赛者的卡片上都有「指定夺冠」按钮', () => {
  const { participants, marked } = boot();
  const P = participants();
  assert.equal(P.length, 2, '默认应有 2 位参赛者');
  for (const p of P) {
    assert.ok(p.node && p.node.rigBtn, '卡片上应存在指定按钮');
    assert.equal(p.node.rigBtn.textContent, '☆ 指定夺冠');
    assert.ok(!p.node.rigBtn.classList.contains('rig-on'));
  }
  assert.equal(marked(), 0, '初始不应有内定人选');
});

test('点击指定按钮可以内定，并且同时只能有一个人被内定', () => {
  const { participants, marked } = boot();
  const P = participants();

  click(P[1].node.rigBtn);
  assert.equal(P[1].node.rigBtn.textContent, '★ 已指定');
  assert.ok(P[1].node.rigBtn.classList.contains('rig-on'), '被内定的按钮应有高亮样式');
  assert.equal(P[0].node.rigBtn.textContent, '☆ 指定夺冠', '其他人不应被标记');
  assert.equal(marked(), 1, '同时只能有一个人被内定');

  click(P[0].node.rigBtn);
  assert.ok(P[0].node.rigBtn.classList.contains('rig-on'), '内定应转移到新的人');
  assert.ok(!P[1].node.rigBtn.classList.contains('rig-on'), '旧的人应被取消');
  assert.equal(P[1].node.rigBtn.textContent, '☆ 指定夺冠');
  assert.equal(marked(), 1, '转移之后仍然只有一个');

  click(P[0].node.rigBtn);
  assert.equal(P[0].node.rigBtn.textContent, '☆ 指定夺冠', '再点一次应取消内定');
  assert.equal(marked(), 0);
});

test('删除被内定的人之后，内定状态不会残留到下一局', () => {
  const { participants, document, race, pump } = boot();
  const P = participants();

  click(P[0].node.rigBtn);
  assert.ok(P[0].node.rigBtn.classList.contains('rig-on'));
  byText(P[0].node.card, '删除').dispatch('click');
  assert.equal(participants().length, 1, '被内定的人应该已被删除');

  // 行为验证：再开一局，不应该有任何车带内定标记
  click(document.getElementById('addBtn'));
  click(document.getElementById('startBtn'));
  assert.equal(race().phase, 'countdown');
  assert.equal(race().cars.length, 2);
  assert.ok(race().cars.every(c => !c.rigged), '删掉被内定的人之后，新一局不应残留内定车');
});

test('清空全部之后，内定状态不会残留到下一局', () => {
  const { participants, document, race } = boot();
  click(participants()[1].node.rigBtn);
  assert.equal(participants().filter(p => p.node.rigBtn.classList.contains('rig-on')).length, 1);

  click(document.getElementById('clearBtn'));
  assert.equal(participants().length, 0);

  click(document.getElementById('sampleBtn'));       // 重新加入 6 位
  click(document.getElementById('startBtn'));
  assert.ok(race().cars.every(c => !c.rigged), '清空全部之后，新一局不应残留内定车');
  assert.ok(race().cars.length > 0);
});

test('端到端：内定的人从第一排发车，跑完整局后拿到第一', () => {
  const { document, participants, race, pump } = boot();
  const boardEl = document.getElementById('board');

  click(document.getElementById('clearBtn'));
  click(document.getElementById('sampleBtn'));                  // 加入 6 位示例参赛者
  const P = participants();
  assert.equal(P.length, 6);

  const target = P[3];                                          // 内定第 4 位
  click(target.node.rigBtn);
  assert.equal(target.node.rigBtn.textContent, '★ 已指定', '按钮应确认已指定');

  click(document.getElementById('startBtn'));
  const r = race();
  assert.equal(r.phase, 'countdown', '点开始后应进入倒计时');

  // 发车格：第一排的 s == -70（s = -70 - row*spacing）
  assert.equal(r.cars.length, 6);
  const targetCar = r.cars.find(c => c.id === target.id);
  assert.ok(targetCar, '内定的人应该在赛道上');
  assert.equal(targetCar.s, -70, '内定的人必须从第一排发车');
  assert.equal(targetCar.rigged, true, '赛车里应带上内定标记');
  assert.equal(r.cars.filter(c => c.rigged).length, 1, '只能有一台内定车');

  const t0 = Date.now();
  assert.ok(pump(), '比赛应在帧数上限内跑完（卡在阶段=' + race().phase + '）');
  const frames = Date.now() - t0;

  const results = race().results;
  assert.equal(results.length, 6, '结算应有全部 6 位的成绩');
  assert.equal(results[0].name, target.name, '内定的人应拿到第一（实际第一：' + results[0].name + '）');
  console.log('    端到端：主循环跑完用了 ' + frames + 'ms，第一名 = ' + results[0].name);

  // 结算面板真的被写进了 DOM
  const rows = findAll(boardEl, e => /^row\b/.test(String(e.className)));
  assert.equal(rows.length, 6, '结算面板应渲染 6 行');
});

test('不指定任何人时，比赛照常结束（内定未开启不应影响流程）', () => {
  const { document, race, pump } = boot();
  click(document.getElementById('clearBtn'));
  click(document.getElementById('sampleBtn'));
  click(document.getElementById('startBtn'));
  assert.ok(race().cars.every(c => !c.rigged), '没有内定时不应有车带内定标记');
  assert.ok(pump());
  assert.equal(race().results.length, 6);
});

test('内定的人每局都从第一排出发，但位置会变（不会每次都停在同一格）', () => {
  const { document, participants, race } = boot();
  click(document.getElementById('clearBtn'));
  click(document.getElementById('sampleBtn'));                 // 6 位 → 第一排 6 个格子
  const P = participants();
  const target = P[2];
  click(target.node.rigBtn);

  const seen = new Set();
  const ROUNDS = 60;                                           // 每局 startRace 都会换一个新种子
  for (let i = 0; i < ROUNDS; i++) {
    click(document.getElementById('startBtn'));
    const r = race();
    const car = r.cars.find(c => c.id === target.id);
    assert.equal(car.s, -70, '第 ' + (i + 1) + ' 局没有从第一排发车');
    assert.equal(r.cars.filter(c => c.rigged).length, 1, '第 ' + (i + 1) + ' 局内定车数量不对');
    seen.add(Math.round(car.lateral));
  }
  assert.ok(seen.size >= 4,
    '第一排只出现过 ' + seen.size + ' 个不同位置，说明位置没在变：' + [...seen].join(','));
  console.log('    第一排位置随机化：' + ROUNDS + ' 局出现 ' + seen.size + '/6 个不同格子');
});

test('搜索框能按姓名和 IG 用户名筛选名单，且不影响实际参赛人数', () => {
  const { document, participants, race } = boot();
  const input = document.getElementById('searchInput');
  const bar = document.getElementById('searchBar');
  const countEl = document.getElementById('searchCount');
  const clearEl = document.getElementById('searchClear');

  click(document.getElementById('rosterBtn'));                 // 载入内置粉丝名单
  const P = participants();
  const TOTAL = P.length;                                      // 名单人数会随同步变化，测试不写死
  assert.ok(TOTAL > 100, '内置名单应该有很多人，实际 ' + TOTAL);
  assert.ok(!bar.hidden, '有参赛者时搜索栏应可见');

  const visible = () => P.filter(p => !p.node.card.hidden);
  const type = v => { input.value = v; input.dispatch('input'); };
  // 独立参照：自己按同样的规则算一遍应该命中多少
  const expectCount = q => {
    q = q.trim().toLowerCase();
    if (!q) return TOTAL;
    return P.filter(p => (p.name || '').toLowerCase().includes(q) ||
                         (p.username || '').toLowerCase().includes(q)).length;
  };

  assert.equal(visible().length, TOTAL);
  assert.equal(countEl.textContent, '', '没搜索时不该显示计数');

  // 按 IG 用户名搜，并且大小写不敏感
  const tgt = P.find(p => p.username && p.username.length >= 6);
  assert.ok(tgt, '名单里应该有人带 IG 用户名');
  type(tgt.username.toUpperCase());
  assert.equal(visible().length, expectCount(tgt.username), '按用户名筛选结果与参照不一致');
  assert.ok(visible().some(p => p.username === tgt.username), '目标本人应该在结果里');
  assert.equal(countEl.textContent, visible().length + ' / ' + TOTAL);

  // 按姓名片段搜
  const other = P.find(p => p.username !== tgt.username && (p.name || '').length >= 3);
  type(other.name.slice(0, 3));
  const q = other.name.slice(0, 3).trim().toLowerCase();
  assert.equal(visible().length, expectCount(q), '按姓名筛选结果与参照不一致');
  assert.ok(visible().length >= 1);

  // 搜不到时应该是 0，而不是「全部显示」
  type('zzz__no_such_person__zzz');
  assert.equal(visible().length, 0);
  assert.equal(countEl.textContent, '0 / ' + TOTAL);

  // 清除按钮
  assert.ok(!clearEl.hidden, '有搜索词时清除按钮应出现');
  click(clearEl);
  assert.equal(input.value, '');
  assert.equal(visible().length, TOTAL, '清除后应恢复全部');
  assert.ok(clearEl.hidden);

  // 关键：过滤只是显示层 —— 开始比赛时仍然全部人上场
  type(tgt.username);
  assert.ok(visible().length < TOTAL, '过滤后应该少显示一些');
  click(document.getElementById('startBtn'));
  assert.equal(race().cars.length, TOTAL, '过滤不应该减少实际参赛人数');
});

test('清空全部之后搜索栏隐藏，重新加人后又能正常搜索', () => {
  const { document, participants } = boot();
  const input = document.getElementById('searchInput');
  const bar = document.getElementById('searchBar');

  click(document.getElementById('clearBtn'));
  assert.ok(bar.hidden, '没有参赛者时搜索栏应隐藏');

  click(document.getElementById('sampleBtn'));
  assert.ok(!bar.hidden, '重新加人后搜索栏应回来');
  input.value = '疾风'; input.dispatch('input');
  const visible = participants().filter(p => !p.node.card.hidden);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].name, '疾风');
});

test('结算时每个人都拿到真实成绩，不再共享同一个「冻结时刻」', () => {
  const { document, participants, race, pump } = boot();
  click(document.getElementById('clearBtn'));
  // 12 位 > 旧规则的「第 10 台就收工」，所以旧代码下必然有 2 人拿不到成绩
  for (let i = 0; i < 12; i++) click(document.getElementById('addBtn'));
  assert.equal(participants().length, 12);

  click(document.getElementById('startBtn'));
  assert.ok(pump(), '比赛应在帧数上限内跑完（阶段=' + race().phase + '）');

  const results = race().results;
  assert.equal(results.length, 12);
  assert.equal(results.filter(r => !r.finished).length, 0,
    '所有人都应该冲线，而不是只有前 10 个');
  const shown = results.map(r => r.finishTime.toFixed(3));
  assert.equal(new Set(shown).size, 12, '12 个人应该有 12 个不同的成绩，而不是一串相同的数');
  assert.ok(results.every(r => Number.isFinite(r.finishTime) && r.finishTime > 0));

  // 榜单上不该出现「—」（所有人都冲线了）
  const board = document.getElementById('board');
  const stTexts = findAll(board, e => e.className === 'st').map(e => e.textContent);
  assert.equal(stTexts.length, 12, '榜单应有 12 行状态');
  assert.ok(stTexts.every(t => t.indexOf('—') < 0), '有人冲线了就不该显示「—」：' + stTexts.join(' | '));

  console.log('    结算成绩：' + shown[0] + 's ~ ' + shown[11] + 's，12 个互不相同');
});
