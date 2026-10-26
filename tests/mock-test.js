// Firefox API をモックした動作テスト（実機Firefoxではない）。
// `chrome` を未定義にして、browser.* のみで動くことも検証する。
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = process.argv[2] || path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
// vm内で生成したオブジェクトはprototypeが別Realmのため、JSON正規化して構造のみ比較する
const deq = (a, b) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { pass++; console.log('PASS ' + name); })
  .catch((e) => { fail++; console.log('FAIL ' + name + '\n     ' + e.message); });
const tick = () => new Promise((r) => setImmediate(r));
const flush = async () => { for (let i = 0; i < 10; i++) await tick(); };

/* ---------- 共通モック ---------- */
function makeBrowser(clock) {
  const store = {}; const log = { badge: [], badgeColor: [], alarms: [], cleared: [], sets: [] };
  const storageListeners = [];
  const b = {
    log, store,
    storage: {
      local: {
        get: async (k) => (typeof k === 'string' ? (k in store ? { [k]: store[k] } : {}) : { ...store }),
        set: async (o) => { Object.assign(store, JSON.parse(JSON.stringify(o))); log.sets.push(o);
          for (const l of storageListeners) l(Object.fromEntries(Object.keys(o).map(k => [k, { newValue: o[k] }])), 'local'); }
      },
      onChanged: { addListener: (l) => storageListeners.push(l) }
    },
    alarms: {
      create: (name, info) => { log.alarms.push({ name, ...info }); },
      clear: (name) => { log.cleared.push(name); return Promise.resolve(true); },
      onAlarm: { listeners: [], addListener(l) { this.listeners.push(l); } }
    },
    action: {
      setBadgeText: (o) => { log.badge.push(o.text); },
      setBadgeBackgroundColor: (o) => { log.badgeColor.push(o.color); }
    },
    runtime: {
      onMessage: { listeners: [], addListener(l) { this.listeners.push(l); } },
      onStartup: { listeners: [], addListener(l) { this.listeners.push(l); } },
      sendMessage: async (m) => { b.runtime.sent.push(m); return { ok: true }; },
      sent: []
    }
  };
  return b;
}
function makeClock(t0) {
  const c = { now: t0, timers: new Map(), next: 1 };
  c.setTimeout = (fn, ms) => { const id = c.next++; c.timers.set(id, { fn, at: c.now + ms }); return id; };
  c.clearTimeout = (id) => c.timers.delete(id);
  return c;
}
class FakeCtx {
  constructor() { FakeCtx.instances.push(this); this.currentTime = 0; this.oscs = 0; this.closed = false; this.resumed = false;
    this.destination = {}; }
  resume() { this.resumed = true; return Promise.resolve(); }
  close() { this.closed = true; return Promise.resolve(); }
  createGain() { const p = { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} };
    const g = { gain: p, connect: (d) => d }; return g; }
  createOscillator() { const self = this; const o = { frequency: {}, connect: (g) => g, start() { self.oscs++; }, stop() {} }; return o; }
}
FakeCtx.instances = [];

/* ---------- background テスト ---------- */
function loadBackground() {
  const clock = makeClock(1_000_000); FakeCtx.instances = [];
  const browser = makeBrowser(clock);
  const sandbox = { browser, AudioContext: FakeCtx, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    Date: { now: () => clock.now }, console, Promise };
  // chrome は意図的に未定義 → 参照が残っていれば ReferenceError で落ちる
  vm.createContext(sandbox);
  const manifest = JSON.parse(read('manifest.json'));
  for (const f of manifest.background.scripts) vm.runInContext(read(f), sandbox, { filename: f });
  const send = (msg) => new Promise((res) => {
    const r = browser.runtime.onMessage.listeners[0](msg, {}, res);
    assert.strictEqual(r, true, 'onMessage は非同期応答のため true を返す必要がある');
  });
  const fireAlarm = (name = 'simple-timer-end') => browser.alarms.onAlarm.listeners.forEach(l => l({ name }));
  return { browser, clock, send, fireAlarm, sandbox };
}

(async () => {
  console.log('--- background / audio ---');
  await ok('manifest の scripts 順に読み込めて、リスナーが同期登録される', () => {
    const t = loadBackground();
    assert.strictEqual(t.browser.alarms.onAlarm.listeners.length, 1);
    assert.strictEqual(t.browser.runtime.onStartup.listeners.length, 1);
    assert.strictEqual(t.browser.runtime.onMessage.listeners.length, 1);
  });

  await ok('start: running状態を保存・アラーム作成・バッジ消去・応答', async () => {
    const t = loadBackground();
    const r = await t.send({ type: 'start', duration: 10 });
    deq(r, { ok: true });
    deq(t.browser.store.timer, { status: 'running', duration: 10, endTime: 1_010_000 });
    deq(t.browser.log.alarms, [{ name: 'simple-timer-end', when: 1_010_000 }]);
    assert.strictEqual(t.browser.log.badge.at(-1), '');
    assert.strictEqual(t.clock.timers.size, 1, 'setTimeout の保険が1件登録される');
  });

  await ok('アラーム発火(終了時刻到達): finished・バッジEND赤・終了音(4回×3音)再生', async () => {
    const t = loadBackground();
    await t.send({ type: 'start', duration: 10 });
    t.clock.now += 10_000; t.fireAlarm(); await flush();
    assert.strictEqual(t.browser.store.timer.status, 'finished');
    deq(t.browser.log.badgeColor, ['#ff3b30']);
    assert.strictEqual(t.browser.log.badge.at(-1), 'END');
    assert.strictEqual(FakeCtx.instances.length, 1);
    assert.strictEqual(FakeCtx.instances[0].resumed, true);
    assert.strictEqual(FakeCtx.instances[0].oscs, 12);
    assert.ok(t.browser.log.cleared.includes('simple-timer-end'), '終了時にアラームを解除');
    assert.strictEqual(t.clock.timers.size, 0, '保険のsetTimeoutも解除');
  });

  await ok('早すぎるアラーム(終了500ms以上前)・別名アラームは無視される', async () => {
    const t = loadBackground();
    await t.send({ type: 'start', duration: 10 });
    t.clock.now += 5_000; t.fireAlarm(); await flush();
    assert.strictEqual(t.browser.store.timer.status, 'running');
    t.clock.now += 5_000; t.fireAlarm('other'); await flush();
    assert.strictEqual(t.browser.store.timer.status, 'running');
    assert.strictEqual(FakeCtx.instances.length, 0);
  });

  await ok('setTimeout保険経由でも終了する（アラームが来ない場合）', async () => {
    const t = loadBackground();
    await t.send({ type: 'start', duration: 3 });
    t.clock.now += 3_000;
    const [{ fn }] = [...t.clock.timers.values()]; fn(); await flush();
    assert.strictEqual(t.browser.store.timer.status, 'finished');
    assert.strictEqual(FakeCtx.instances.length, 1);
  });

  await ok('popup からの timerEnded でも終了処理される / 二重再生しても前の音は停止', async () => {
    const t = loadBackground();
    await t.send({ type: 'start', duration: 2 });
    t.clock.now += 2_000;
    await t.send({ type: 'timerEnded' });
    assert.strictEqual(t.browser.store.timer.status, 'finished');
    assert.strictEqual(FakeCtx.instances.length, 1);
    await t.send({ type: 'timerEnded' }); // finished 状態では何もしない
    assert.strictEqual(FakeCtx.instances.length, 1);
  });

  await ok('reset(終了ボタン): 音停止(AudioContext.close)・バッジ消去・idleでduration保持', async () => {
    const t = loadBackground();
    await t.send({ type: 'start', duration: 10 });
    t.clock.now += 10_000; t.fireAlarm(); await flush();
    await t.send({ type: 'reset' });
    assert.strictEqual(FakeCtx.instances[0].closed, true);
    assert.strictEqual(t.browser.log.badge.at(-1), '');
    deq(t.browser.store.timer, { status: 'idle', duration: 10, endTime: 0 });
  });

  await ok('リスタート(finished中にstart): 前の音を止めて新たにrunning', async () => {
    const t = loadBackground();
    await t.send({ type: 'start', duration: 10 });
    t.clock.now += 10_000; t.fireAlarm(); await flush();
    await t.send({ type: 'start', duration: 10 });
    assert.strictEqual(FakeCtx.instances[0].closed, true);
    assert.strictEqual(t.browser.store.timer.status, 'running');
    assert.strictEqual(t.browser.log.badge.at(-1), '');
  });

  await ok('onStartup: 実行中で未到達 → アラーム再設定 / 到達済み → 終了処理', async () => {
    let t = loadBackground();
    t.browser.store.timer = { status: 'running', duration: 60, endTime: t.clock.now + 30_000 };
    await t.browser.runtime.onStartup.listeners[0](); await flush();
    deq(t.browser.log.alarms, [{ name: 'simple-timer-end', when: 1_030_000 }]);
    t = loadBackground();
    t.browser.store.timer = { status: 'running', duration: 60, endTime: t.clock.now - 1 };
    await t.browser.runtime.onStartup.listeners[0](); await flush();
    assert.strictEqual(t.browser.store.timer.status, 'finished');
    assert.strictEqual(FakeCtx.instances.length, 1);
  });

  /* ---------- popup テスト（最小の偽DOM） ---------- */
  console.log('--- popup ---');
  function makeEl() {
    const el = { children: [], listeners: {}, style: {}, textContent: '', className: '', _cls: new Set(),
      classList: { add: (c) => el._cls.add(c), remove: (c) => el._cls.delete(c),
        toggle: (c, f) => { (f === undefined ? !el._cls.has(c) : f) ? el._cls.add(c) : el._cls.delete(c); },
        contains: (c) => el._cls.has(c) },
      append(...n) { el.children.push(...n); },
      addEventListener(t, h) { (el.listeners[t] ||= []).push(h); },
      get offsetWidth() { return 0; } };
    Object.defineProperty(el, 'innerHTML', { get: () => '', set: () => { el.children = []; } });
    return el;
  }
  function loadPopup(initial) {
    const clock = makeClock(5_000_000);
    const browser = makeBrowser(clock); if (initial) browser.store.timer = initial;
    const els = {}; const document = { getElementById: (id) => (els[id] ||= makeEl()), createElement: () => makeEl() };
    const sandbox = { browser, document, requestAnimationFrame: () => 0, setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout, Date: { now: () => clock.now }, Math, String, console, Promise };
    vm.createContext(sandbox); vm.runInContext(read('popup.js'), sandbox, { filename: 'popup.js' });
    return { browser, els, clock };
  }
  const labels = (els) => els['actions'].children.map((c) => c.textContent);

  await ok('初期表示(idle,0): スタートボタン / 00:00:00', async () => {
    const p = loadPopup(); await flush();
    deq(labels(p.els), ['スタート']);
    assert.strictEqual(p.els['remain'].textContent, '00:00:00');
    assert.strictEqual(p.browser.log.badge.at(-1), '', '開いたらバッジを消す');
  });

  await ok('時間0でスタート → エラー表示・メッセージ送信なし', async () => {
    const p = loadPopup(); await flush();
    p.els['actions'].children[0].listeners.click[0](); await flush();
    assert.strictEqual(p.els['error'].textContent, '時間を設定してください');
    assert.ok(p.els['error'].classList.contains('show'));
    assert.strictEqual(p.browser.runtime.sent.length, 0);
  });

  await ok('ホイール(上)で分+1 → 保存・表示更新、スタートで start メッセージ送信', async () => {
    const p = loadPopup(); await flush();
    let prevented = false;
    p.els['seg-m'].listeners.wheel[0]({ deltaY: -100, preventDefault: () => { prevented = true; } }); await flush();
    assert.ok(prevented);
    assert.strictEqual(p.els['seg-m'].textContent, '01');
    deq(p.browser.store.timer, { status: 'idle', duration: 60, endTime: 0 });
    assert.strictEqual(p.els['remain'].textContent, '00:01:00');
    p.els['actions'].children[0].listeners.click[0](); await flush();
    deq(p.browser.runtime.sent, [{ type: 'start', duration: 60 }]);
  });

  await ok('矢印キー(下)で秒が 00→59 に回り込む', async () => {
    const p = loadPopup(); await flush();
    p.els['seg-s'].listeners.keydown[0]({ key: 'ArrowDown', preventDefault() {} }); await flush();
    assert.strictEqual(p.els['seg-s'].textContent, '59');
  });

  await ok('storage変更の反映: running→ストップ / finished→終了・リスタート', async () => {
    const p = loadPopup({ status: 'idle', duration: 90, endTime: 0 }); await flush();
    await p.browser.storage.local.set({ timer: { status: 'running', duration: 90, endTime: p.clock.now + 90_000 } });
    deq(labels(p.els), ['ストップ']);
    assert.strictEqual(p.els['remain'].textContent, '00:01:30');
    await p.browser.storage.local.set({ timer: { status: 'finished', duration: 90, endTime: p.clock.now - 1 } });
    deq(labels(p.els), ['終了', 'リスタート']);
    assert.ok(p.els['disc'].classList.contains('finished'));
    p.els['actions'].children[0].listeners.click[0](); await flush();
    deq(p.browser.runtime.sent.at(-1), { type: 'reset' });
  });

  await ok('実行中に残り0到達 → timerEnded を1回だけ送る', async () => {
    const p = loadPopup(); await flush();
    await p.browser.storage.local.set({ timer: { status: 'running', duration: 5, endTime: p.clock.now - 10 } });
    const ended = p.browser.runtime.sent.filter((m) => m.type === 'timerEnded');
    assert.strictEqual(ended.length, 1);
  });

  console.log(`\n結果: ${pass} 件成功 / ${fail} 件失敗`);
  process.exit(fail ? 1 : 0);
})();
