'use strict';
// UI 层验证：node --test qa_rig_ui.js
//
// 这个文件不切源码片段，而是用最小 DOM 桩把**完整的 index.html 脚本**跑起来，
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
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

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
      toggle: c => (cls.has(c) ? (cls.delete(c), false) : (cls.add(c), true))
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

function boot() {
  const byId = new Map();
  const rafQueue = [];
  let vnow = 0;
  const document = {
    createElement: t => new El(t),
    getElementById: id => { if (!byId.has(id)) byId.set(id, new El('div')); return byId.get(id); },
    addEventListener() {},
    body: new El('body')
  };
  const ctx = vm.createContext({
    document, window: { devicePixelRatio: 1, addEventListener() {} },
    requestAnimationFrame: fn => { rafQueue.push(fn); return rafQueue.length; },
    setTimeout: () => 0, clearTimeout() {},
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL() {} },
    FileReader: class { readAsText() {} },
    Image: class extends El { constructor() { super('img'); } },
    console
  });
  vm.runInContext(script, ctx, { filename: 'index.html<script>' });

  const participants = () => ctx.window.__avatarRace.participants;
  const race = () => ctx.window.__avatarRace.race;
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
  return { ctx, document, participants, race, marked, pump };
}
const click = (el) => el.dispatch('click');

// ---------------- 测试 ----------------

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
  click(document.getElementById('startBtn'));
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
  const targetCar = r.cars.find(c => c.p.id === target.id);
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
