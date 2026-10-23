// Microphone recording for the assistant. Must be started from a tap: iOS only
// allows audio in a user gesture.
//
//   const rec = await startRecording({ onLevel: (0..1) => …, onLimit, maxMs });
//   const out = await rec.stop();   // or rec.cancel()
//   out = { compressed: { base64, mime } | null, pcm: Float32Array, rate, ms }
//
// Two copies are kept while recording:
// - a compressed one from MediaRecorder (AAC on iPhone, Opus elsewhere) — small,
//   so a long message fits in one speech-to-text request;
// - the raw samples, so that if the compressed one is refused or too big we can
//   still send plain 16 kHz WAV cut into short pieces at pauses (splitAtPauses,
//   wavBase64) — each request through the AI gateway must stay small.

const RATE = 16000;
const MIMES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

export const canRecord = () => Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (window.AudioContext || window.webkitAudioContext));

function pickMime() {
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return null;
  return MIMES.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || null;
}

export async function startRecording({ onLevel, onLimit, maxMs = 100000 } = {}) {
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

  // compressed copy
  let mr = null;
  const parts = [];
  const mime = pickMime();
  if (mime) {
    try {
      mr = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 });
      mr.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
      mr.start(1000);
    } catch {
      mr = null;
    }
  }

  // raw copy + level meter
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0; // the processor must reach the destination to run, but silently
  const chunks = [];
  let length = 0;
  const started = performance.now();
  let done = false;

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
  const limitTimer = setTimeout(() => onLimit && onLimit(), maxMs);

  function teardown() {
    done = true;
    clearTimeout(limitTimer);
    try { src.disconnect(); proc.disconnect(); mute.disconnect(); } catch { /* already */ }
    if (mr && mr.state !== 'inactive') try { mr.stop(); } catch { /* already */ }
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
  }

  const stopRecorder = () => new Promise((resolve) => {
    if (!mr || mr.state === 'inactive') return resolve();
    mr.onstop = () => resolve();
    try { mr.stop(); } catch { resolve(); }
    setTimeout(resolve, 1500); // never hang on a recorder that doesn't fire onstop
  });

  return {
    get ms() { return performance.now() - started; },
    async stop() {
      const rate = ctx.sampleRate;
      await stopRecorder();
      teardown();
      const all = new Float32Array(length);
      let o = 0;
      for (const c of chunks) { all.set(c, o); o += c.length; }
      const pcm = downsample(all, rate, RATE);
      let compressed = null;
      if (parts.length) {
        const blob = new Blob(parts, { type: parts[0].type || mime });
        compressed = { base64: await toBase64(blob), mime: (blob.type || mime).split(';')[0] };
      }
      return { compressed, pcm, rate: RATE, ms: (length / rate) * 1000 };
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

/** Cut into pieces of at most `maxSec`, each ending at the quietest moment of its last few seconds. */
export function splitAtPauses(pcm, rate, maxSec) {
  const max = Math.floor(maxSec * rate);
  if (pcm.length <= max) return [pcm];
  const win = Math.floor(rate * 0.25);
  const out = [];
  let start = 0;
  while (pcm.length - start > max) {
    const from = start + Math.floor(max * 0.6);
    const to = start + max - win;
    let best = to;
    let bestE = Infinity;
    for (let p = from; p <= to; p += Math.floor(win / 2)) {
      let e = 0;
      for (let i = p; i < p + win; i++) e += pcm[i] * pcm[i];
      if (e < bestE) { bestE = e; best = p + Math.floor(win / 2); }
    }
    out.push(pcm.subarray(start, best));
    start = best;
  }
  out.push(pcm.subarray(start));
  return out;
}

export const wavBase64 = (samples, rate) => toBase64(encodeWav(samples, rate));

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
