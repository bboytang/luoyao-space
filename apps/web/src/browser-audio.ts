import type { AudioFrame } from "../../../runtimes/realtime-device/src/protocol";
import type { AudioFrameHandler, RealtimeAudioInput, RealtimeAudioOutput } from "../../../runtimes/realtime-device/src/audio-io";

export type AudioCapture = RealtimeAudioInput;
export type AudioPlayback = RealtimeAudioOutput;

export interface BrowserAudioOptions {
  sampleRate?: number;
  frameSamples?: number;
}

/** Browser microphone adapter. It emits provider-neutral mono PCM16 frames. */
export class BrowserPcmCapture implements RealtimeAudioInput {
  private readonly sampleRate: number;
  private readonly frameSamples: number;
  private stream?: MediaStream;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private processor?: ScriptProcessorNode;
  private sequence = 0;
  private pending: number[] = [];
  private onFrame?: (frame: AudioFrame) => void;

  constructor(options: BrowserAudioOptions = {}) {
    this.sampleRate = options.sampleRate ?? 24_000;
    this.frameSamples = options.frameSamples ?? 480;
  }

  async start(onFrame: AudioFrameHandler): Promise<void> {
    if (this.context) return;

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.context = new AudioContext({ sampleRate: this.sampleRate });
    await this.context.resume();

    this.onFrame = onFrame;
    this.source = this.context.createMediaStreamSource(this.stream);
    this.processor = this.context.createScriptProcessor(this.frameSamples, 1, 1);
    this.processor.onaudioprocess = (event) => this.handleInput(event.inputBuffer.getChannelData(0));
    this.source.connect(this.processor);
    this.processor.connect(this.context.destination);
  }

  private handleInput(samples: Float32Array): void {
    for (const sample of samples) this.pending.push(sample);

    while (this.pending.length >= this.frameSamples) {
      const chunk = this.pending.splice(0, this.frameSamples);
      const payload = new ArrayBuffer(chunk.length * 2);
      const view = new DataView(payload);
      for (let i = 0; i < chunk.length; i += 1) {
        const clamped = Math.max(-1, Math.min(1, chunk[i]));
        view.setInt16(i * 2, clamped < 0 ? clamped * 32768 : clamped * 32767, true);
      }

      this.onFrame?.({
        kind: "audio",
        codec: "pcm_s16le",
        sampleRate: this.sampleRate,
        channels: 1,
        sequence: this.sequence++,
        payload: new Uint8Array(payload),
      });
    }
  }

  async stop(): Promise<void> {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    await this.context?.close();
    this.processor = undefined;
    this.source = undefined;
    this.stream = undefined;
    this.context = undefined;
    this.pending = [];
    this.onFrame = undefined;
  }
}

/** Browser PCM16 player with sequential scheduling; compressed codecs stay outside this adapter. */
export class BrowserPcmPlayback implements RealtimeAudioOutput {
  private context?: AudioContext;
  private nextStartTime = 0;

  constructor(private readonly sampleRate = 24_000) {}

  async play(frame: AudioFrame): Promise<void> {
    if (frame.codec !== "pcm_s16le" || frame.channels !== 1) {
      throw new Error("BrowserPcmPlayback requires mono pcm_s16le frames");
    }

    this.context ??= new AudioContext({ sampleRate: this.sampleRate });
    await this.context.resume();

    const samples = new Float32Array(frame.payload.byteLength / 2);
    const view = new DataView(frame.payload.buffer, frame.payload.byteOffset, frame.payload.byteLength);
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] = view.getInt16(i * 2, true) / 32768;
    }

    const buffer = this.context.createBuffer(1, samples.length, frame.sampleRate);
    buffer.copyToChannel(samples, 0);

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);

    const now = this.context.currentTime;
    this.nextStartTime = Math.max(now, this.nextStartTime);
    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;
  }

  async stop(): Promise<void> {
    await this.context?.close();
    this.context = undefined;
    this.nextStartTime = 0;
  }
}
