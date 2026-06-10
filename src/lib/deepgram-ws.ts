export interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: number;
}

export interface DeepgramAlternative {
  transcript: string;
  confidence: number;
  words: DeepgramWord[];
}

export interface DeepgramResult {
  is_final: boolean;
  speech_final: boolean;
  channel: { alternatives: DeepgramAlternative[] };
  metadata?: { request_id: string };
}

export interface DeepgramUtterance {
  speaker: number;
  transcript: string;
  start: number;
  end: number;
  words: DeepgramWord[];
  is_final: boolean;
}

interface DeepgramWSOptions {
  apiKey: string;
  onTranscript: (result: DeepgramResult, elapsed: number) => void;
  onUtterance: (utterance: DeepgramUtterance) => void;
  onOpen: () => void;
  onClose: () => void;
  onError: (err: Event) => void;
}

// Nova-3 params — no encoding/sample_rate/channels:
// MediaRecorder sends WebM/Opus; Deepgram auto-detects from the container header.
// Specifying encoding=linear16 while sending WebM causes zero transcription.
const DEEPGRAM_PARAMS = new URLSearchParams({
  model: 'nova-3',
  diarize: 'true',
  smart_format: 'true',
  punctuate: 'true',
  interim_results: 'true',
  utterances: 'true',
  words: 'true',
});

const DEEPGRAM_WS_URL = `wss://api.deepgram.com/v1/listen?${DEEPGRAM_PARAMS}`;

// 32 kbps Opus — good speech quality, low bandwidth
const AUDIO_BITS_PER_SECOND = 32_000;

export class DeepgramStreamClient {
  private ws: WebSocket | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private startTime = 0;
  private opts: DeepgramWSOptions;
  private isClosed = false;
  private audioChunks: Blob[] = [];

  constructor(opts: DeepgramWSOptions) {
    this.opts = opts;
  }

  async start(micStream: MediaStream) {
    if (!this.opts.apiKey) {
      throw new Error('Deepgram API key not configured. Go to Settings → AI Services to add your key.');
    }
    this.stream = micStream;
    this.isClosed = false;
    this.startTime = Date.now();
    this.connect();
  }

  private connect() {
    // Browser auth: Deepgram accepts API key via subprotocol for browser clients
    this.ws = new WebSocket(DEEPGRAM_WS_URL, ['token', this.opts.apiKey]);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.opts.onOpen();
      this.startRecording();
    };

    this.ws.onmessage = event => {
      try {
        const data = JSON.parse(event.data as string);
        if (data.type === 'Results') {
          const elapsed = (Date.now() - this.startTime) / 1000;
          this.opts.onTranscript(data as DeepgramResult, elapsed);
        } else if (data.type === 'Utterance') {
          this.opts.onUtterance(data as DeepgramUtterance);
        }
        // 'Error' frames from Deepgram: surface via onError
        if (data.type === 'Error') {
          const syntheticErr = new Event('error');
          this.opts.onError(syntheticErr);
        }
      } catch {
        // Non-JSON binary frame — ignore
      }
    };

    this.ws.onerror = err => this.opts.onError(err);

    this.ws.onclose = event => {
      this.stopRecording();
      if (!this.isClosed) {
        if (event.code !== 1000) {
          // Abnormal close (auth failure, quota, network drop)
          const syntheticErr = new Event('error');
          this.opts.onError(syntheticErr);
        }
        this.opts.onClose();
      }
    };
  }

  getAudioBlob(): Blob | null {
    if (this.audioChunks.length === 0) return null;
    const mimeType = this.mediaRecorder?.mimeType ?? 'audio/webm';
    return new Blob(this.audioChunks, { type: mimeType });
  }

  private startRecording() {
    if (!this.stream || !this.ws) return;
    this.audioChunks = [];

    // Prefer Opus; fall back to plain WebM. Do NOT use linear16/wav here —
    // that would require specifying encoding params and Deepgram expects raw PCM.
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : '';

    const recorderOptions: MediaRecorderOptions = {
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    };
    if (mimeType) recorderOptions.mimeType = mimeType;

    this.mediaRecorder = new MediaRecorder(this.stream, recorderOptions);

    this.mediaRecorder.ondataavailable = event => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(event.data);
        }
      }
    };

    // 250ms chunks — lower latency than 500ms for interim results
    this.mediaRecorder.start(250);
  }

  private stopRecording() {
    if (this.mediaRecorder?.state !== 'inactive') {
      this.mediaRecorder?.stop();
    }
    this.mediaRecorder = null;
  }

  pause() {
    this.mediaRecorder?.pause();
  }

  resume() {
    this.mediaRecorder?.resume();
  }

  stop() {
    this.isClosed = true;
    this.stopRecording();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'CloseStream' }));
      this.ws.close(1000);
    }
    this.stream?.getTracks().forEach(t => t.stop());
  }
}
