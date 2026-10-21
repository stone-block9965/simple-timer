// Simple Timer - service worker
// タイマーの状態管理・終了検知・終了音の再生を担当します。

const ALARM = 'simple-timer-end';
let endTimeout = null;

async function getState() {
  const { timer } = await chrome.storage.local.get('timer');
  return timer || { status: 'idle', duration: 0, endTime: 0 };
}
const setState = (timer) => chrome.storage.local.set({ timer });

function schedule(endTime) {
  clearTimeout(endTimeout);
  chrome.alarms.create(ALARM, { when: endTime });
  // 短いタイマー用の保険（アラームの最短間隔対策）
  endTimeout = setTimeout(finish, Math.max(0, endTime - Date.now()));
}

function cancelSchedule() {
  clearTimeout(endTimeout);
  chrome.alarms.clear(ALARM);
}

async function hasOffscreen() {
  const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return ctx.length > 0;
}

async function playSound() {
  if (!(await hasOffscreen())) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'タイマー終了音を再生するため'
    });
  }
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'play' }).catch(() => {});
}

async function stopSound() {
  if (await hasOffscreen()) {
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' }).catch(() => {});
    chrome.offscreen.closeDocument().catch(() => {});
  }
}

async function finish() {
  const s = await getState();
  if (s.status !== 'running' || Date.now() < s.endTime - 500) return;
  cancelSchedule();
  await setState({ ...s, status: 'finished' });
  chrome.action.setBadgeBackgroundColor({ color: '#ff3b30' });
  chrome.action.setBadgeText({ text: 'END' });
  await playSound();
}

async function start(duration) {
  await stopSound();
  chrome.action.setBadgeText({ text: '' });
  const endTime = Date.now() + duration * 1000;
  await setState({ status: 'running', duration, endTime });
  schedule(endTime);
}

async function reset() {
  cancelSchedule();
  await stopSound();
  chrome.action.setBadgeText({ text: '' });
  const s = await getState();
  await setState({ status: 'idle', duration: s.duration, endTime: 0 });
}

chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) finish(); });

chrome.runtime.onStartup.addListener(async () => {
  const s = await getState();
  if (s.status === 'running') {
    if (s.endTime <= Date.now()) finish(); else schedule(s.endTime);
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target === 'offscreen') return;
  (async () => {
    if (msg.type === 'start') await start(msg.duration);
    else if (msg.type === 'reset') await reset();
    else if (msg.type === 'timerEnded') await finish();
    sendResponse({ ok: true });
  })();
  return true;
});
