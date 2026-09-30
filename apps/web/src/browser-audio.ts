import type { AudioFrame } from "../../../runtimes/realtime-device/src/protocol";
import type { AudioFrameHandler, RealtimeAudioInput, RealtimeAudioOutput } from "../../../runtimes/realtime-device/src/audio-io";
import { PcmLipSyncAnalyzer } from "../../../runtimes/realtime-device/src/lip-sync";
import { LipSyncPlaybackTimeline } from "../../../runtimes/realtime-device/src/lip-sync-playback-timeline";
import { PcmPlaybackTimeline } from "../../../runtimes/realtime-device/src/playback-timeline";

export type AudioCapture = RealtimeAudioInput;
export type AudioPlayback = RealtimeAudioOutput;

export interface BrowserAudioOptions {
  sampleRate?: number;
  frameSamples?: number;
}

/** Browser microphone adapter. Audio capture runs in an AudioWorklet and emits provider-neutral mono PCM16 frames. */
export class BrowserPcmCapture implements RealtimeAudioInput {
  private readonly sampleRate: number;
  private readonly frameSamples: number;
  private stream?: MediaStream;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private worklet?: AudioWorkletNode;
  private sequence = 0;
  private onFrame?: AudioFrameHandler;

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
    await this.context.audioWorklet.addModule(
      new URL("./pcm-capture-worklet.ts", import.meta.url),
    );

    this.source = this.context.createMediaStreamSource(this.stream);
    this.worklet = new AudioWorkletNode(this.context, "luoyao-pcm-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
      processorOptions: { frameSamples: this.frameSamples },
    });

    this.worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      this.handleFrame(event.data);
    };

    this.source.connect(this.worklet);
  }

  private handleFrame(buffer: ArrayBuffer): void {
    const samples = new Float32Array(buffer);
    const payload = new ArrayBuffer(samples.length * 2);
    const view = new DataView(payload);

    for (let i = 0; i < samples.length; i += 1) {
      const clamped = Math.max(-1, Math.min(1, samples[i]));
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

  async stop(): Promise<void> {
    this.worklet?.port.close();
    this.worklet?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    await this.context?.close();
    this.worklet = undefined;
    this.source = undefined;
    this.stream = undefined;
    this.context = undefined;
    this.onFrame = undefined;
  }
}

/** Browser PCM16 player with sequential scheduling; compressed codecs stay outside this adapter. */
export class BrowserPcmPlayback implements RealtimeAudioOutput {
  private context?: AudioContext;
  private readonly timeline = new PcmPlaybackTimeline();
  private readonly lipSyncAnalyzer = new PcmLipSyncAnalyzer();
  private readonly lipSyncTimeline = new LipSyncPlaybackTimeline();
  private playTail: Promise<void> = Promise.resolve();
  private playbackGeneration = 0;

  constructor(private readonly sampleRate = 24_000) {}

  play(frame: AudioFrame): Promise<void> {
    const generation = this.playbackGeneration;
    const operation = this.playTail.then(async () => {
      if (generation !== this.playbackGeneration) return;
      if (frame.codec !== "pcm_s16le" || frame.channels !== 1) {
        throw new Error("BrowserPcmPlayback requires mono pcm_s16le frames");
      }

      this.context ??= new AudioContext({ sampleRate: this.sampleRate });
      await this.context.resume();
      if (generation !== this.playbackGeneration) return;

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

      const schedule = this.timeline.schedule(frame, this.context.currentTime);
      const sample = this.lipSyncAnalyzer.analyze(frame);
      if (sample) this.lipSyncTimeline.add(sample, schedule);
      source.start(schedule.startTime);
    });

    this.playTail = operation.catch(() => undefined);
    return operation;
  }

  async waitForIdle(): Promise<void> {
    await this.playTail;
    const context = this.context;
    if (!context) return;
    const remainingMs = Math.max(0, (this.timeline.getEndTime() - context.currentTime) * 1000);
    if (remainingMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, remainingMs));
  }

  getPlaybackTime(): number {
    return this.context?.currentTime ?? 0;
  }

  getMouthOpenAt(timeSeconds: number): number {
    return this.lipSyncTimeline.sampleAt(timeSeconds);
  }

  async stop(): Promise<void> {
    this.playbackGeneration += 1;
    await this.playTail;
    await this.context?.close();
    this.context = undefined;
    this.timeline.reset();
    this.lipSyncTimeline.reset();
  }
}
