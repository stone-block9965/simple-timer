// 終了音（Web Audio APIで生成するので音声ファイル不要）
let ctx = null;

function tone(time, freq, dur, vol = 0.28) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(vol, time + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(time);
  osc.stop(time + dur + 0.05);
}

function play() {
  stop();
  ctx = new AudioContext();
  ctx.resume();
  const t0 = ctx.currentTime + 0.05;
  // 「ピロリン ピロリン…」を4回繰り返す
  for (let i = 0; i < 4; i++) {
    const b = t0 + i * 1.5;
    tone(b, 880, 0.35);
    tone(b + 0.18, 1175, 0.35);
    tone(b + 0.36, 1568, 0.6);
  }
}

function stop() {
  if (ctx) { ctx.close().catch(() => {}); ctx = null; }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'play') play();
  if (msg.type === 'stop') stop();
});
