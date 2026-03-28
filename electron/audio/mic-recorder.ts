/**
 * Main-process microphone recorder.
 *
 * Uses a hidden BrowserWindow to capture audio via getUserMedia.
 * The main process has proper macOS TCC permissions, so the hidden window's
 * getUserMedia works even when the main renderer's doesn't (dev mode).
 *
 * Communication uses executeJavaScript() for reliability — no IPC messaging.
 */

import { BrowserWindow, type IpcMain } from 'electron';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let recorderWindow: BrowserWindow | null = null;
let isRecording = false;

function getRecorderHtmlPath(): string {
  // Always rewrite the HTML to ensure it's up-to-date with the current code
  const dir = join(tmpdir(), 'legion-interlink-mic');
  mkdirSync(dir, { recursive: true });
  const htmlPath = join(dir, 'recorder.html');
  writeFileSync(htmlPath, RECORDER_HTML, 'utf-8');
  return htmlPath;
}

const RECORDER_HTML = `<!DOCTYPE html>
<html><head><title>Mic Recorder</title></head>
<body><script>
window._mic = {
  recorder: null,
  chunks: [],
  stream: null,

  async listDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices
        .filter(d => d.kind === 'audioinput')
        .map(d => ({ deviceId: d.deviceId, label: d.label || 'Unknown device', groupId: d.groupId }));
      console.log('[MicRecorder] Audio input devices:', JSON.stringify(inputs));
      return inputs;
    } catch (err) {
      console.error('[MicRecorder] enumerateDevices failed:', err);
      return [];
    }
  },

  async start(deviceId) {
    try {
      console.log('[MicRecorder] getUserMedia, deviceId=' + (deviceId || 'default'));
      const constraints = {
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        }
      };
      if (deviceId) {
        constraints.audio.deviceId = { exact: deviceId };
      }
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      const tracks = this.stream.getAudioTracks();
      const settings = tracks[0]?.getSettings?.() || {};
      console.log('[MicRecorder] Track: ' + tracks[0]?.label + ' sampleRate=' + settings.sampleRate + ' channelCount=' + settings.channelCount);

      // Level check — 500ms sample
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(this.stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      src.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      await new Promise(r => setTimeout(r, 500));
      analyser.getFloatTimeDomainData(buf);
      let max = 0;
      for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > max) max = a; }
      src.disconnect();
      await ctx.close();
      const silent = max < 0.001;
      console.log('[MicRecorder] Level: max=' + max.toFixed(6) + (silent ? ' ⚠️ SILENT' : ' ✓ has audio'));

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';
      this.recorder = new MediaRecorder(this.stream, { mimeType });
      this.chunks = [];
      this.recorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };
      this.recorder.start(1000);
      console.log('[MicRecorder] Recording (' + mimeType + '), silent=' + silent);
      return { ok: true, silent: silent };
    } catch (err) {
      console.error('[MicRecorder] Start failed:', err);
      return { error: err.message };
    }
  },

  async stop() {
    if (!this.recorder || this.recorder.state === 'inactive') {
      return { error: 'Not recording' };
    }
    const recorder = this.recorder;
    const chunks = this.chunks;
    return new Promise((resolve) => {
      recorder.onstop = async () => {
        console.log('[MicRecorder] Stopped, chunks=' + chunks.length);
        if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
        this.recorder = null;
        if (chunks.length === 0) { resolve({ error: 'No audio chunks recorded' }); return; }

        const rawBlob = new Blob(chunks, { type: recorder.mimeType });
        this.chunks = [];
        console.log('[MicRecorder] Raw blob: ' + rawBlob.size + ' bytes (' + recorder.mimeType + ')');

        try {
          const ab = await rawBlob.arrayBuffer();
          const actx = new AudioContext();
          const audio = await actx.decodeAudioData(ab);
          console.log('[MicRecorder] Decoded: ' + audio.length + ' samples, ' + audio.sampleRate + 'Hz, ' + audio.duration.toFixed(2) + 's');

          const raw = audio.getChannelData(0);
          let maxA = 0;
          for (let i = 0; i < raw.length; i++) { const a = Math.abs(raw[i]); if (a > maxA) maxA = a; }
          console.log('[MicRecorder] Amplitude: ' + maxA.toFixed(6) + (maxA < 0.001 ? ' ⚠️ SILENT!' : ' ✓ has audio'));

          await actx.close();

          const rate = 16000;
          const offCtx = new OfflineAudioContext(1, Math.ceil(audio.duration * rate), rate);
          const s = offCtx.createBufferSource();
          s.buffer = audio;
          s.connect(offCtx.destination);
          s.start(0);
          const re = await offCtx.startRendering();
          const samples = re.getChannelData(0);
          const n = samples.length;
          const ds = n * 2;
          const wav = new ArrayBuffer(44 + ds);
          const v = new DataView(wav);
          function w(o, s) { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
          w(0,'RIFF'); v.setUint32(4,36+ds,true); w(8,'WAVE');
          w(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true);
          v.setUint32(24,rate,true); v.setUint32(28,rate*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true);
          w(36,'data'); v.setUint32(40,ds,true);
          let o = 44;
          for (let i = 0; i < n; i++) {
            const x = Math.max(-1, Math.min(1, samples[i]));
            v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7FFF, true);
            o += 2;
          }
          const bytes = new Uint8Array(wav);
          let bin = '';
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
          const b64 = btoa(bin);
          console.log('[MicRecorder] WAV: ' + wav.byteLength + 'b -> ' + b64.length + ' b64');
          resolve({
            wavBase64: b64,
            durationSec: audio.duration,
            maxAmplitude: maxA,
          });
        } catch (err) {
          console.error('[MicRecorder] Encode error:', err);
          resolve({ error: 'Encode failed: ' + err.message });
        }
      };
      recorder.stop();
    });
  },

  cancel() {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.onstop = () => {};
      this.recorder.stop();
    }
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    this.recorder = null;
    this.chunks = [];
  },

  // Multi-device level monitoring for device picker UI
  _monitors: {}, // keyed by deviceId (or 'default')

  async startMonitorAll(deviceIds) {
    this.stopMonitorAll();
    const results = {};
    for (const id of deviceIds) {
      try {
        const constraints = { audio: { channelCount: 1 } };
        if (id && id !== 'default') constraints.audio.deviceId = { exact: id };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        this._monitors[id] = { stream, ctx, source, analyser };
        results[id] = { ok: true };
      } catch (err) {
        results[id] = { error: err.message };
      }
    }
    return results;
  },

  getAllLevels() {
    const levels = {};
    const buf = new Float32Array(256);
    for (const [id, mon] of Object.entries(this._monitors)) {
      if (!mon || !mon.analyser) { levels[id] = 0; continue; }
      mon.analyser.getFloatTimeDomainData(buf);
      let max = 0;
      for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > max) max = a; }
      levels[id] = max;
    }
    return levels;
  },

  // Live PCM streaming for Speech SDK (sends PCM16 chunks to main process via IPC)
  _liveCtx: null,
  _liveSource: null,
  _liveProcessor: null,
  _liveStream: null,

  async startLiveStream(deviceId) {
    this.stopLiveStream();
    try {
      const constraints = { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } };
      if (deviceId) constraints.audio.deviceId = { exact: deviceId };
      this._liveStream = await navigator.mediaDevices.getUserMedia(constraints);

      // Create AudioContext at 16kHz for direct PCM output (SDK expects 16kHz)
      this._liveCtx = new AudioContext({ sampleRate: 16000 });
      this._liveSource = this._liveCtx.createMediaStreamSource(this._liveStream);
      const bufferSize = 4096;
      this._liveProcessor = this._liveCtx.createScriptProcessor(bufferSize, 1, 1);

      this._liveProcessor.onaudioprocess = (e) => {
        const float32 = e.inputBuffer.getChannelData(0);
        // Convert Float32 to PCM16
        const pcm = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        // Send to main process as base64
        const bytes = new Uint8Array(pcm.buffer);
        let bin = '';
        for (let j = 0; j < bytes.length; j++) bin += String.fromCharCode(bytes[j]);
        const b64 = btoa(bin);
        // Use require('electron').ipcRenderer since we have nodeIntegration:false
        // Actually we don't have ipcRenderer here — we need a different way to send to main
        // We'll store chunks and let main poll them
        if (!this._liveChunks) this._liveChunks = [];
        this._liveChunks.push(b64);
      };

      this._liveSource.connect(this._liveProcessor);
      this._liveProcessor.connect(this._liveCtx.destination);
      this._liveChunks = [];
      console.log('[MicRecorder] Live stream started (16kHz PCM)');
      return { ok: true };
    } catch (err) {
      return { error: err.message };
    }
  },

  _liveChunks: [],

  drainLiveChunks() {
    const chunks = this._liveChunks || [];
    this._liveChunks = [];
    return chunks;
  },

  stopLiveStream() {
    if (this._liveProcessor) { try { this._liveProcessor.disconnect(); } catch {} this._liveProcessor = null; }
    if (this._liveSource) { try { this._liveSource.disconnect(); } catch {} this._liveSource = null; }
    if (this._liveCtx) { try { this._liveCtx.close(); } catch {} this._liveCtx = null; }
    if (this._liveStream) { this._liveStream.getTracks().forEach(t => t.stop()); this._liveStream = null; }
    this._liveChunks = [];
    console.log('[MicRecorder] Live stream stopped');
  },

  stopMonitorAll() {
    for (const mon of Object.values(this._monitors)) {
      if (!mon) continue;
      try { mon.source.disconnect(); } catch {}
      try { mon.ctx.close(); } catch {}
      mon.stream.getTracks().forEach(t => t.stop());
    }
    this._monitors = {};
  }
};
console.log('[MicRecorder] Ready, secure=' + window.isSecureContext + ', getUserMedia=' + !!navigator.mediaDevices?.getUserMedia);
</script></body></html>`;

async function ensureRecorderWindow(): Promise<BrowserWindow> {
  if (recorderWindow && !recorderWindow.isDestroyed()) {
    return recorderWindow;
  }

  const htmlPath = getRecorderHtmlPath();
  console.log('[MicRecorder] Creating hidden window, loading:', htmlPath);

  recorderWindow = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: false,
      webSecurity: false, // Allow getUserMedia from file:// URLs
    },
  });

  recorderWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['media', 'microphone', 'audioCapture'].includes(permission));
  });
  recorderWindow.webContents.session.setPermissionCheckHandler((_wc, permission) => {
    return ['media', 'microphone', 'audioCapture'].includes(permission);
  });

  await recorderWindow.loadFile(htmlPath);

  // Forward hidden window console messages to main process console
  recorderWindow.webContents.on('console-message', (event) => {
    const { level, message } = event as unknown as { level: number; message: string };
    const prefix = '[MicRecorder:window]';
    if (level <= 1) console.log(prefix, message);
    else if (level === 2) console.warn(prefix, message);
    else console.error(prefix, message);
  });

  console.log('[MicRecorder] Hidden window loaded');

  return recorderWindow;
}

export function registerMicRecorderHandlers(ipc: IpcMain): void {
  // List available audio input devices
  ipc.handle('stt:list-devices', async () => {
    try {
      const win = await ensureRecorderWindow();
      return await win.webContents.executeJavaScript('window._mic.listDevices()');
    } catch (err) {
      console.error('[MicRecorder] list-devices error:', err);
      return [];
    }
  });

  ipc.handle('stt:start-recording', async (_event, deviceId?: string) => {
    console.log('[MicRecorder] stt:start-recording, deviceId=%s', deviceId ?? 'default');
    if (isRecording) return { error: 'Already recording' };

    try {
      const win = await ensureRecorderWindow();
      const escapedId = deviceId ? JSON.stringify(deviceId) : 'null';
      const result = await win.webContents.executeJavaScript(`window._mic.start(${escapedId})`);
      console.log('[MicRecorder] start result:', JSON.stringify(result));
      if (result.ok) isRecording = true;
      return result;
    } catch (err) {
      console.error('[MicRecorder] start error:', err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipc.handle('stt:stop-recording', async () => {
    console.log('[MicRecorder] stt:stop-recording');
    if (!isRecording) return { error: 'Not recording' };

    try {
      const win = await ensureRecorderWindow();
      isRecording = false;
      const result = await win.webContents.executeJavaScript('window._mic.stop()') as {
        wavBase64?: string;
        durationSec?: number;
        maxAmplitude?: number;
        error?: string;
      };

      if (result.error) {
        console.error('[MicRecorder] stop error:', result.error);
      } else if (result.wavBase64) {
        console.log('[MicRecorder] stop: %d b64 chars, %.2fs, amplitude=%.6f',
          result.wavBase64.length, result.durationSec ?? 0, result.maxAmplitude ?? 0);
      }

      return result;
    } catch (err) {
      isRecording = false;
      console.error('[MicRecorder] stop error:', err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipc.handle('stt:cancel-recording', async () => {
    console.log('[MicRecorder] stt:cancel-recording');
    isRecording = false;
    try {
      const win = await ensureRecorderWindow();
      await win.webContents.executeJavaScript('window._mic.cancel()');
    } catch { /* ignore */ }
    return { ok: true };
  });

  // Multi-device level monitoring for device picker
  ipc.handle('stt:start-monitor', async (_event, deviceIds?: string[]) => {
    try {
      const win = await ensureRecorderWindow();
      const escaped = JSON.stringify(deviceIds ?? ['default']);
      return await win.webContents.executeJavaScript(`window._mic.startMonitorAll(${escaped})`);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipc.handle('stt:get-level', async () => {
    try {
      if (!recorderWindow || recorderWindow.isDestroyed()) return {};
      return await recorderWindow.webContents.executeJavaScript('window._mic.getAllLevels()');
    } catch {
      return {};
    }
  });

  ipc.handle('stt:stop-monitor', async () => {
    try {
      if (recorderWindow && !recorderWindow.isDestroyed()) {
        await recorderWindow.webContents.executeJavaScript('window._mic.stopMonitorAll()');
      }
    } catch { /* ignore */ }
    return { ok: true };
  });

  // Live PCM streaming for Speech SDK
  ipc.handle('stt:live-mic-start', async (_event, deviceId?: string) => {
    try {
      const win = await ensureRecorderWindow();
      const escaped = deviceId ? JSON.stringify(deviceId) : 'null';
      return await win.webContents.executeJavaScript(`window._mic.startLiveStream(${escaped})`);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipc.handle('stt:live-mic-drain', async () => {
    try {
      if (!recorderWindow || recorderWindow.isDestroyed()) return [];
      return await recorderWindow.webContents.executeJavaScript('window._mic.drainLiveChunks()');
    } catch {
      return [];
    }
  });

  ipc.handle('stt:live-mic-stop', async () => {
    try {
      if (recorderWindow && !recorderWindow.isDestroyed()) {
        await recorderWindow.webContents.executeJavaScript('window._mic.stopLiveStream()');
      }
    } catch { /* ignore */ }
    return { ok: true };
  });
}

export function cleanupMicRecorder(): void {
  if (recorderWindow && !recorderWindow.isDestroyed()) {
    recorderWindow.close();
  }
  recorderWindow = null;
}
