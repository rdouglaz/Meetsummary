/**
 * Client-side audio extraction and resampling.
 * Accepts any browser-decodable audio/video file, mixes to mono, resamples to 16 kHz,
 * and returns raw Int16 PCM — the format Deepgram REST expects for linear16.
 *
 * Peak memory: ~3× the decoded float32 size (decode → mono mix → resample).
 * After this function returns the caller holds only the compact Int16 buffer.
 * Tested up to ~200 MB source files; larger files may exhaust browser heap.
 */

export interface AudioProcessResult {
  pcm: ArrayBuffer;       // Int16 LE, 16 kHz, mono
  sampleRate: 16000;
  channels: 1;
  duration: number;       // seconds (from source file)
  originalSize: number;   // bytes (source file)
  processedSize: number;  // bytes (Int16 PCM)
}

const TARGET_SAMPLE_RATE = 16000;

export async function extractAndResampleAudio(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<AudioProcessResult> {
  // ── 1. Read file as ArrayBuffer ──────────────────────────────────────────────
  onProgress?.(4);
  const ab = await file.arrayBuffer();
  onProgress?.(14);

  // ── 2. Decode audio (browser handles MP4, MP3, M4A, OGG, WebM, WAV, FLAC…) ─
  let decoded: AudioBuffer;
  {
    const ctx = new AudioContext();
    try {
      decoded = await ctx.decodeAudioData(ab);
    } catch (err) {
      throw new Error(
        `Could not decode audio from "${file.name}". ` +
        `The file may be corrupted, DRM-protected, or in an unsupported format. ` +
        `(${err instanceof Error ? err.message : String(err)})`,
      );
    } finally {
      ctx.close(); // release audio hardware ASAP
    }
  }
  onProgress?.(35);

  // ── 3. Mix all channels to mono in JS ────────────────────────────────────────
  const srcLen = decoded.length;
  const nCh    = decoded.numberOfChannels;
  const mono   = new Float32Array(srcLen);
  for (let ch = 0; ch < nCh; ch++) {
    const chData = decoded.getChannelData(ch);
    for (let i = 0; i < srcLen; i++) {
      mono[i] += chData[i] / nCh;
    }
  }
  onProgress?.(50);

  // ── 4. Resample to 16 kHz via OfflineAudioContext ────────────────────────────
  // OfflineAudioContext renders at TARGET_SAMPLE_RATE and resamples the source buffer
  // (which carries decoded.sampleRate as its own rate) automatically.
  const targetLen = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
  const offCtx    = new OfflineAudioContext(1, targetLen, TARGET_SAMPLE_RATE);

  // Wrap mono float32 in a buffer at the *source* sample rate so the engine resamples
  const srcBuf = offCtx.createBuffer(1, srcLen, decoded.sampleRate);
  srcBuf.getChannelData(0).set(mono);

  const srcNode = offCtx.createBufferSource();
  srcNode.buffer = srcBuf;
  srcNode.connect(offCtx.destination);
  srcNode.start(0);

  const rendered = await offCtx.startRendering();
  onProgress?.(73);

  // ── 5. Float32 → Int16 PCM ───────────────────────────────────────────────────
  const f32    = rendered.getChannelData(0);
  const pcm16  = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s    = Math.max(-1, Math.min(1, f32[i]));
    pcm16[i]   = Math.round(s * (s < 0 ? 32768 : 32767));
  }
  onProgress?.(90);

  return {
    pcm:           pcm16.buffer,
    sampleRate:    TARGET_SAMPLE_RATE,
    channels:      1,
    duration:      decoded.duration,
    originalSize:  file.size,
    processedSize: pcm16.byteLength,
  };
}
