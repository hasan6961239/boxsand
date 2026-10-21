// Microphone recording to a small mono 16 kHz WAV (what speech-to-text needs).
// Uses Web Audio rather than MediaRecorder so the format is the same on every
// iPhone. Must be started from a tap: iOS only allows audio in a user gesture.
//
//   const rec = await startRecording({ onLevel: (0..1) => …, maxMs });
//   const { base64, ms } = await rec.stop();   // or rec.cancel()

const RATE = 16000;

export const canRecord = () => Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (window.AudioContext || window.webkitAudioContext));

export async function startRecording({ onLevel, onLimit, maxMs = 120000 } = {}) {
  // create and resume the context synchronously inside the tap, before any await
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const resumed = ctx.resume().catch(() => {});
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    ctx.close().catch(() => {});
    const err = new Error(e && e.name === 'NotAllowedError' ? 'denied' : 'unavailable');
    err.cause = e;
    throw err;
  }
  await resumed;

  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0; // the processor must reach the destination to run, but silently
  const chunks = [];
  let length = 0;
  const started = performance.now();
  let done = false;
  let limitTimer = null;

  proc.onaudioprocess = (e) => {
    if (done) return;
    const input = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
    length += input.length;
    if (onLevel) {
      let s = 0;
      for (let i = 0; i < input.length; i += 4) s += input[i] * input[i];
      onLevel(Math.min(1, Math.sqrt(s / (input.length / 4)) * 4));
    }
  };
  src.connect(proc);
  proc.connect(mute);
  mute.connect(ctx.destination);
  limitTimer = setTimeout(() => onLimit && onLimit(), maxMs);

  function teardown() {
    done = true;
    clearTimeout(limitTimer);
    try { src.disconnect(); proc.disconnect(); mute.disconnect(); } catch { /* already */ }
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
  }

  return {
    get ms() { return performance.now() - started; },
    async stop() {
      const rate = ctx.sampleRate;
      teardown();
      const all = new Float32Array(length);
      let o = 0;
      for (const c of chunks) { all.set(c, o); o += c.length; }
      const wav = encodeWav(downsample(all, rate, RATE), RATE);
      return { base64: await toBase64(wav), ms: (length / rate) * 1000 };
    },
    cancel: teardown,
  };
}

function downsample(buf, from, to) {
  if (from === to) return buf;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(buf.length / ratio));
  for (let i = 0; i < out.length; i++) {
    // average the source samples that fall into this output sample (simple low-pass)
    const a = Math.floor(i * ratio);
    const b = Math.min(buf.length, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b; j++) s += buf[j];
    out[i] = s / Math.max(1, b - a);
  }
  return out;
}

function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
