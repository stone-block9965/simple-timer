// Simple Timer - background (Firefox: イベントページ)
// タイマーの状態管理・終了検知・終了音の再生を担当します。
// Chrome版(service worker)からの変更点:
//  - chrome.* → browser.*（FirefoxのPromise版API）
//  - offscreen document の生成/メッセージ送信を廃止し、audio.js を直接呼び出す

const ALARM = 'simple-timer-end';
let endTimeout = null;

async function getState() {
  const { timer } = await browser.storage.local.get('timer');
  return timer || { status: 'idle', duration: 0, endTime: 0 };
}
const setState = (timer) => browser.storage.local.set({ timer });

function schedule(endTime) {
  clearTimeout(endTimeout);
  browser.alarms.create(ALARM, { when: endTime });
  // 短いタイマー用の保険（アラームの最短間隔対策）
  endTimeout = setTimeout(finish, Math.max(0, endTime - Date.now()));
}

function cancelSchedule() {
  clearTimeout(endTimeout);
  browser.alarms.clear(ALARM);
}

// Firefoxにはoffscreen APIが無い。イベントページ自体がAudioContextを使えるため直接再生する。
function playSound() { startEndSound(); }
function stopSound() { stopEndSound(); }

async function finish() {
  const s = await getState();
  if (s.status !== 'running' || Date.now() < s.endTime - 500) return;
  cancelSchedule();
  await setState({ ...s, status: 'finished' });
  browser.action.setBadgeBackgroundColor({ color: '#ff3b30' });
  browser.action.setBadgeText({ text: 'END' });
  playSound();
}

async function start(duration) {
  stopSound();
  browser.action.setBadgeText({ text: '' });
  const endTime = Date.now() + duration * 1000;
  await setState({ status: 'running', duration, endTime });
  schedule(endTime);
}

async function reset() {
  cancelSchedule();
  stopSound();
  browser.action.setBadgeText({ text: '' });
  const s = await getState();
  await setState({ status: 'idle', duration: s.duration, endTime: 0 });
}

browser.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) finish(); });

browser.runtime.onStartup.addListener(async () => {
  const s = await getState();
  if (s.status === 'running') {
    if (s.endTime <= Date.now()) finish(); else schedule(s.endTime);
  }
});

browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'start') await start(msg.duration);
    else if (msg.type === 'reset') await reset();
    else if (msg.type === 'timerEnded') await finish();
    sendResponse({ ok: true });
  })();
  return true;
});
