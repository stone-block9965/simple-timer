const $ = (id) => document.getElementById(id);
const CIRC = 2 * Math.PI * 94;
const MAX = { h: 99, m: 59, s: 59 };

const el = {
  disc: $('disc'), bar: $('bar'), remain: $('remain'),
  setter: $('setter'), actions: $('actions'), error: $('error'),
  seg: { h: $('seg-h'), m: $('seg-m'), s: $('seg-s') }
};

let state = { status: 'idle', duration: 0, endTime: 0 };
let endedSent = false;
let errorTimer = null;

const pad = (n) => String(n).padStart(2, '0');
const split = (t) => ({ h: Math.floor(t / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 });
const fmt = (t) => { const x = split(t); return `${pad(x.h)}:${pad(x.m)}:${pad(x.s)}`; };
const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => {});

/* ---------- 描画 ---------- */
function remainingMs() {
  if (state.status === 'running') return Math.max(0, state.endTime - Date.now());
  if (state.status === 'finished') return 0;
  return state.duration * 1000;
}

function renderTime() {
  const ms = remainingMs();
  const total = state.duration * 1000;
  let frac = total > 0 ? ms / total : 0;
  if (state.status === 'finished') frac = 0;
  el.bar.style.strokeDasharray = CIRC;
  el.bar.style.strokeDashoffset = CIRC * (1 - frac);
  el.remain.textContent = fmt(Math.ceil(ms / 1000));

  if (state.status === 'running' && ms <= 0 && !endedSent) {
    endedSent = true;
    send({ type: 'timerEnded' });
  }
}

function renderStatic() {
  const x = split(state.duration);
  el.seg.h.textContent = pad(x.h);
  el.seg.m.textContent = pad(x.m);
  el.seg.s.textContent = pad(x.s);
  el.setter.classList.toggle('locked', state.status !== 'idle');
  el.disc.classList.toggle('finished', state.status === 'finished');

  el.actions.innerHTML = '';
  if (state.status === 'idle') {
    el.actions.append(button('スタート', onStart));
  } else if (state.status === 'running') {
    el.actions.append(button('ストップ', onStop));
  } else {
    el.actions.append(button('終了', onStop, 'danger'), button('リスタート', onRestart));
  }
  renderTime();
}

function button(label, handler, cls = '') {
  const b = document.createElement('button');
  b.className = `btn ${cls}`.trim();
  b.textContent = label;
  b.addEventListener('click', handler);
  return b;
}

function loop() {
  if (state.status === 'running') renderTime();
  requestAnimationFrame(loop);
}

/* ---------- 操作 ---------- */
function showError() {
  el.error.textContent = '時間を設定してください';
  el.error.classList.add('show');
  el.setter.classList.remove('shake');
  void el.setter.offsetWidth;
  el.setter.classList.add('shake');
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => el.error.classList.remove('show'), 2600);
}

async function onStart() {
  if (state.duration <= 0) return showError();
  el.error.classList.remove('show');
  endedSent = false;
  await send({ type: 'start', duration: state.duration });
}
const onStop = () => send({ type: 'reset' });
const onRestart = () => { endedSent = false; return send({ type: 'start', duration: state.duration }); };

function changeUnit(unit, step) {
  if (state.status !== 'idle') return;
  const x = split(state.duration);
  const range = MAX[unit] + 1;
  x[unit] = (x[unit] + step + range) % range;
  state = { status: 'idle', duration: x.h * 3600 + x.m * 60 + x.s, endTime: 0 };
  chrome.storage.local.set({ timer: state });
  el.error.classList.remove('show');
  renderStatic();
}

for (const unit of ['h', 'm', 's']) {
  const seg = el.seg[unit];
  seg.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY === 0) return;
    changeUnit(unit, e.deltaY < 0 ? 1 : -1); // 1スクロール = 1（上で増加・下で減少）
  }, { passive: false });
  seg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); changeUnit(unit, 1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); changeUnit(unit, -1); }
  });
}

/* ---------- 初期化 ---------- */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.timer?.newValue) {
    state = changes.timer.newValue;
    if (state.status !== 'running') endedSent = false;
    renderStatic();
  }
});

(async () => {
  const { timer } = await chrome.storage.local.get('timer');
  if (timer) state = timer;
  chrome.action.setBadgeText({ text: '' });
  renderStatic();
  requestAnimationFrame(loop);
})();
